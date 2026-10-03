const test = require("node:test");
const assert = require("node:assert/strict");
const { install, reply, env, run } = require("./_mock");
const withdraw = require("../api/wallet-withdraw");
const initialize = require("../api/paystack-initialize");
const has = (u, s) => u.includes(s);
const meRoute = (email = "p233552148347@phone.baidx.invalid") => [(u) => has(u, "/auth/v1/user"), reply(200, { id: "u-1", email })];
const rl = (ok = true) => [(u) => has(u, "rl_hit"), reply(200, { allowed: ok, count: 1, retry_after_s: 60 })];
const grant = (ok = true) => [(u) => has(u, "grant_type=password"), ok ? reply(200, { access_token: "a", refresh_token: "r" }) : reply(400, { error_code: "invalid_credentials" })];
const rpcWd = (res) => [(u) => has(u, "request_withdrawal"), res];
const aud = [(u) => has(u, "audit_logs"), reply(201)];
const body = (over = {}) => ({ amount: 800, network: "MTN MoMo", account: "0241238347", name: "Kwame Mensah", password: "Aadmin123.com", ...over });
const post = (b, headers = { authorization: "Bearer tok" }) => run(withdraw, { method: "POST", headers, body: b });

test("withdraw: method/auth/validation are enforced before anything else happens", async () => {
  env(); let calls = install([[() => true, reply(200, {})]]);
  assert.equal((await run(withdraw, { method: "GET", headers: {} })).status, 405);
  assert.equal((await post(body(), {})).status, 401);
  for (const bad of [{ amount: 0 }, { amount: -5 }, { amount: "abc" }, { amount: 2e6 }, { password: "" }, { password: undefined }, { password: "x".repeat(300) }]) assert.equal((await post(body(bad))).status, 400, JSON.stringify(bad));
  assert.equal(calls.length, 0, "no network call for any of those");
});
test("withdraw: the password must be right (own email grant) or no withdrawal is requested", async () => {
  env(); const calls = install([meRoute(), rl(), grant(false), rpcWd(reply(200, "BXD-WD-1")), aud]);
  const r = await post(body()); assert.equal(r.status, 401); assert.ok(!calls.some((c) => has(c.url, "request_withdrawal")));
  assert.ok(!JSON.stringify(r.json).includes("Aadmin"));
});
test("withdraw: right password -> the RPC is called AS THE USER (their token), reference returned, audit has masked number and no password", async () => {
  env(); const calls = install([meRoute(), rl(), grant(), rpcWd(reply(200, "BXD-WD-7K2Q9XLM")), aud]);
  const r = await post(body()); assert.equal(r.status, 200); assert.equal(r.json.reference, "BXD-WD-7K2Q9XLM");
  const rp = calls.find((c) => has(c.url, "request_withdrawal")); assert.equal(rp.headers.authorization, "Bearer tok"); assert.deepEqual(rp.body, { p_amount: 800, p_network: "MTN MoMo", p_account: "0241238347", p_name: "Kwame Mensah" });
  assert.equal(calls.find((c) => has(c.url, "grant_type")).body.password, "Aadmin123.com");   // only ever sent to the auth server
  const a = JSON.stringify(calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body)); assert.ok(a.includes("wallet.withdraw_requested") && !a.includes("Aadmin") && !a.includes("0241238347"));
});
test("withdraw: rate limited (429) before the password is even tested; database refusals show a safe message, unknown errors a generic one", async () => {
  env(); let calls = install([meRoute(), rl(false), grant(), rpcWd(reply(200, "x")), aud]); assert.equal((await post(body())).status, 429); assert.ok(!calls.some((c) => has(c.url, "grant_type")));
  calls = install([meRoute(), rl(), grant(), rpcWd(reply(400, { message: "not enough available balance" })), aud]); let r = await post(body()); assert.equal(r.status, 400); assert.equal(r.json.error, "Not enough available balance");
  calls = install([meRoute(), rl(), grant(), rpcWd(reply(400, { message: "withdrawals are not available for this account type" })), aud]); assert.equal((await post(body())).json.error, "Withdrawals are not available for this account type");
  install([meRoute(), rl(), grant(), rpcWd(reply(500, { message: 'relation "secret_table" does not exist' })), aud]); r = await post(body()); assert.equal(r.json.error, "We couldn't request that withdrawal.");
});
test("withdraw: no console output ever", async () => {
  env(); const out = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => out.push(a.join(" "));
  install([meRoute(), rl(), grant(), rpcWd(reply(200, "BXD-WD-1")), aud]); await post(body()); Object.assign(console, o); assert.deepEqual(out, []);
});

/* ---------- Paystack checkout for phone accounts ---------- */
const initCalls = (email) => install([meRoute(email), [(u) => has(u, "billing_payments?provider_reference"), reply(200, [{ id: "p", expected_amount_minor: 50750, currency: "GHS", purpose: "wallet_deposit", target: { credit_minor: 50000 } }])], [(u) => has(u, "api.paystack.co/transaction/initialize"), reply(200, { data: { authorization_url: "https://checkout.paystack.com/x" } })]]);
const initReq = () => ({ method: "POST", headers: { authorization: "Bearer tok", origin: "https://baid-x-website.vercel.app" }, body: { reference: "BXP-ABCDEF1234567890" } });
test("paystack initialize: phone accounts (internal .invalid email) get a valid placeholder email; real emails are used as-is", async () => {
  env(); process.env.PAYSTACK_SECRET_KEY = "sk_test_fake";
  let calls = initCalls(); let r = await run(initialize, initReq()); assert.equal(r.status, 200);
  let sent = calls.find((c) => has(c.url, "transaction/initialize")).body; assert.match(sent.email, /^payer-[0-9a-z]{1,16}@pay\.baid-x-website\.vercel\.app$/); assert.ok(!sent.email.includes("invalid")); assert.equal(sent.amount, 50750);
  calls = initCalls("real@person.com"); await run(initialize, initReq()); assert.equal(calls.find((c) => has(c.url, "transaction/initialize")).body.email, "real@person.com");
  delete process.env.PAYSTACK_SECRET_KEY;
});

/* ---------- static checks on the wallet / billing screens ---------- */
const fs = require("node:fs");
const wl = fs.readFileSync(require.resolve("../js/wallet.js"), "utf8"), bill = fs.readFileSync(require.resolve("../js/billing.js"), "utf8");
test("wallet UI: what an account may do comes from the database (wallet_caps); deposits only via Paystack; withdrawals only via the password route", () => {
  assert.ok(wl.includes('"wallet_caps"') && wl.includes("caps.can_deposit") && wl.includes("caps.can_withdraw"));
  assert.ok(wl.includes('"wallet_start_deposit"') && wl.includes('"wallet_deposit_quote"') && wl.includes("goPaystack"));
  assert.ok(!wl.includes("request_deposit") && !wl.includes("request_withdrawal"), "no direct RPC for money out or manual deposits");
  assert.ok(wl.includes("/api/wallet-withdraw") && /password: val\("password"\)/.test(wl));
  assert.ok(/data-wl="withdraw"/.test(wl) && /caps\.can_withdraw \?/.test(wl) && /caps\.can_deposit \?/.test(wl));
});
test("billing UI: Services & fees tab sells verification, boosts and XID through billing_start_service + Paystack; fixed prices come from the catalog", () => {
  assert.ok(bill.includes('["services", "Services & fees"]') && bill.includes('"billing_start_service"') && bill.includes("service_catalog"));
  assert.ok(bill.includes("goPaystack") && bill.includes("verification") && bill.includes("xid"));
  assert.ok(!/price_minor\s*[:=]\s*\d/.test(bill), "no hard-coded prices");
});
test("routes/menus: clients and companies can open the wallet; every role's route list is explicit", () => {
  const c = fs.readFileSync(require.resolve("../js/common.js"), "utf8"), a = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
  assert.ok(/"individual-employer": \["discover", "hires", "post-job", "wallet"[^\]]*\]/.test(c));
  assert.ok(a.includes('["Wallet", "Add money and pay for work.", "wallet"]') && a.includes('["Wallet", "Add money, earnings and withdrawals.", "wallet"]'));
});
