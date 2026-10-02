// Run with: node --test tests/payments.test.js
const test = require("node:test"); const assert = require("node:assert"); const crypto = require("crypto");
process.env.PAYSTACK_SECRET_KEY = "sk_test_unit"; process.env.SUPABASE_URL = "https://x.supabase.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "service_unit";
const webhook = require("../api/paystack-webhook.js"), init = require("../api/paystack-initialize.js"), lib = require("../api/_lib/paystack.js");

const sign = (raw) => crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
const mkRes = () => { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => (r.headers[k] = v); r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };
const mkReq = (raw, sig, extra = {}) => ({ method: "POST", headers: { "x-paystack-signature": sig, ...extra.headers }, body: raw, ...extra });
let calls; const stub = (routes) => { calls = []; global.fetch = async (url, opt = {}) => { calls.push({ url: String(url), body: opt.body ? JSON.parse(opt.body) : null }); for (const [m, fn] of routes) if (String(url).includes(m)) { const out = fn(String(url), opt); return { ok: out.ok !== false, status: out.status || 200, text: async () => JSON.stringify(out.json), json: async () => out.json }; } return { ok: true, status: 200, text: async () => "null", json: async () => null }; }; };
const charge = (over = {}) => JSON.stringify({ event: "charge.success", data: { id: 42, reference: "BXP-AAAAAAAAAAAAAAAA", amount: 1, currency: "XXX", ...over } });

test("signature: valid passes, tampered and missing fail", () => {
  const raw = '{"a":1}'; assert.ok(lib.validSignature(raw, sign(raw), "sk_test_unit"));
  assert.ok(!lib.validSignature(raw + " ", sign(raw), "sk_test_unit")); assert.ok(!lib.validSignature(raw, "", "sk_test_unit")); assert.ok(!lib.validSignature(raw, sign(raw), ""));
});
test("webhook rejects an invalid signature and does nothing", async () => {
  stub([]); const raw = charge(), res = mkRes(); await webhook(mkReq(raw, "bad"), res);
  assert.equal(res.code, 401); assert.equal(calls.length, 0);
});
test("webhook uses amount and currency from Paystack verify, not from the webhook body", async () => {
  stub([["/transaction/verify/", () => ({ json: { data: { status: "success", reference: "BXP-AAAAAAAAAAAAAAAA", amount: 3000, currency: "GHS", id: 42, customer: { customer_code: "CUS_1" }, authorization: { authorization_code: "AUTH_1" } } } })], ["billing_apply_charge", () => ({ json: "processed" })]]);
  const raw = charge(), res = mkRes(); await webhook(mkReq(raw, sign(raw)), res);
  assert.equal(res.code, 200); const c = calls.find((x) => x.url.includes("billing_apply_charge")).body;
  assert.equal(c.p_amount_minor, 3000); assert.equal(c.p_currency, "GHS"); assert.equal(c.p_dedupe_key, "charge.success:42");
});
test("a charge Paystack does not confirm is never applied", async () => {
  stub([["/transaction/verify/", () => ({ json: { data: { status: "failed" } } })]]);
  const raw = charge(), res = mkRes(); await webhook(mkReq(raw, sign(raw)), res);
  assert.equal(res.code, 200); assert.ok(!calls.some((x) => x.url.includes("billing_apply_charge")));
});
test("database failure returns 500 so Paystack retries", async () => {
  stub([["/transaction/verify/", () => ({ json: { data: { status: "success", reference: "R", amount: 1, currency: "GHS", id: 1 } } })], ["billing_apply_charge", () => ({ ok: false, status: 500, json: {} })]]);
  const raw = charge(), res = mkRes(); await webhook(mkReq(raw, sign(raw)), res); assert.equal(res.code, 500);
});
test("unknown events are passed on to be logged, not crashed on", async () => {
  stub([["billing_apply_event", () => ({ json: "ignored" })]]);
  const raw = JSON.stringify({ event: "something.new", data: { id: 7 } }), res = mkRes(); await webhook(mkReq(raw, sign(raw)), res);
  assert.equal(res.code, 200); assert.equal(calls[0].body.p_type, "something.new");
});
test("same event gives the same dedupe key", () => {
  assert.equal(lib.dedupeKey({ event: "invoice.payment_failed", data: { id: 9 } }), lib.dedupeKey({ event: "invoice.payment_failed", data: { id: 9 } }));
  assert.notEqual(lib.dedupeKey({ event: "invoice.payment_failed", data: { id: 9 } }), lib.dedupeKey({ event: "invoice.update", data: { id: 9 } }));
});
test("initialize: amount comes from the database record, never the request", async () => {
  stub([["/auth/v1/user", () => ({ json: { id: "u1", email: "a@b.com" } })], ["billing_payments?", () => ({ json: [{ id: "p1", expected_amount_minor: 3000, currency: "GHS", purpose: "verification", target: {} }] })], ["/transaction/initialize", () => ({ json: { data: { authorization_url: "https://checkout.paystack.com/x" } } })]]);
  const res = mkRes(); await init({ method: "POST", headers: { authorization: "Bearer t", origin: "https://baid-x-website.vercel.app" }, body: { reference: "BXP-AAAAAAAAAAAAAAAA", amount: 1 } }, res);
  assert.equal(res.code, 200); assert.equal(calls.find((x) => x.url.includes("/transaction/initialize")).body.amount, 3000);
});
test("initialize: bad reference and signed-out users are refused", async () => {
  stub([["/auth/v1/user", () => ({ ok: false, status: 401, json: {} })]]);
  let res = mkRes(); await init({ method: "POST", headers: { authorization: "Bearer t" }, body: { reference: "BXP-AAAAAAAAAAAAAAAA" } }, res); assert.equal(res.code, 401);
  stub([["/auth/v1/user", () => ({ json: { id: "u1", email: "a@b.com" } })]]);
  res = mkRes(); await init({ method: "POST", headers: { authorization: "Bearer t" }, body: { reference: "../../etc" } }, res); assert.equal(res.code, 400);
});
test("not configured: payments report unavailable", async () => {
  const k = process.env.PAYSTACK_SECRET_KEY; delete process.env.PAYSTACK_SECRET_KEY;
  const res = mkRes(); await init({ method: "POST", headers: {}, body: {} }, res); assert.equal(res.code, 503); process.env.PAYSTACK_SECRET_KEY = k;
});
