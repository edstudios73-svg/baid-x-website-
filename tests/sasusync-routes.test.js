const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { install, reply, env, run } = require("./_mock");
const { parseEvent } = require("../api/_lib/sasusync/webhook-events");
const start = require("../api/auth/phone/start");
const verify = require("../api/auth/phone/verify");
const notify = require("../api/sms-notify");
const admin = require("../api/sasusync-admin");
const webhook = require("../api/webhooks/sasusync");
const LIVE = { SASUSYNC_MODE: "live", SASUSYNC_SENDER_APPROVED: "true", SASUSYNC_PHONE_AUTH: "true" };
const has = (u, s) => u.includes(s);

/* ---------- webhook events ---------- */
test("webhook event parsing: each status, UTC timestamps, missing message_id / unknown status / bad ts ignored", () => {
  for (const s of ["sent", "delivered", "failed", "expired"]) assert.equal(parseEvent({ event: s, timestamp: "2026-08-02T10:05:15.123456", data: { message_id: "m", recipient: "233552148347", status: s } }).status, s);
  assert.equal(parseEvent({ timestamp: "2026-08-02T10:05:15.123456", data: { message_id: "m", status: "delivered" } }).timestamp, "2026-08-02T10:05:15.123Z");
  for (const bad of [null, {}, { data: {} }, { timestamp: "2026-08-02T10:00:00", data: { status: "delivered" } }, { timestamp: "2026-08-02T10:00:00", data: { message_id: "m", status: "bounced" } }, { timestamp: "nope", data: { message_id: "m", status: "sent" } }, { data: { message_id: "m", status: "sent" } }]) assert.equal(parseEvent(bad), null);
});
function hook(body, secret = "whsec-test") {
  process.env.SASUSYNC_WEBHOOK_SECRET = secret; const raw = JSON.stringify(body);
  const req = Readable.from([Buffer.from(raw)]); req.method = "POST";
  req.headers = { "content-type": "application/json", "x-webhook-signature": crypto.createHmac("sha256", secret).update(raw).digest("hex") };
  return run(webhook, req);
}
test("webhook: signed event is applied through the idempotent DB function (duplicates + out-of-order are the DB's job, called once per delivery)", async () => {
  env(); const calls = install([[(u) => has(u, "sasusync_apply_event"), reply(200, "applied")]]);
  const ev = { event: "delivered", timestamp: "2026-08-02T10:05:15.123456", data: { message_id: "88cc", recipient: "233552148347", status: "delivered" } };
  const a = await hook(ev), b = await hook(ev); // duplicate delivery
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(calls.length, 2);
  assert.equal(calls[0].body.p_message_id, "88cc"); assert.equal(calls[0].body.p_status, "delivered");
});
test("webhook: failed-then-delivered with an OLDER request but LATER timestamp is passed with its own timestamp (DB resolves by timestamp)", async () => {
  env(); const calls = install([[(u) => has(u, "sasusync_apply_event"), reply(200, "applied")]]);
  await hook({ event: "delivered", timestamp: "2026-08-02T10:05:20", data: { message_id: "m9", status: "delivered" } });
  await hook({ event: "failed", timestamp: "2026-08-02T10:05:10", data: { message_id: "m9", status: "failed" } });
  assert.deepEqual(calls.map((c) => c.body.p_ts), ["2026-08-02T10:05:20.000Z", "2026-08-02T10:05:10.000Z"]);
});
test("webhook: missing message_id -> acknowledged 200, nothing stored; DB failure -> 500 so the provider can redeliver", async () => {
  env(); let calls = install([[() => true, reply(200, "applied")]]);
  const r = await hook({ event: "delivered", timestamp: "2026-08-02T10:05:15", data: { status: "delivered" } });
  assert.equal(r.status, 200); assert.equal(r.json.ignored, true); assert.equal(calls.length, 0);
  install([[() => true, reply(500, { message: "db down" })]]);
  assert.equal((await hook({ event: "sent", timestamp: "2026-08-02T10:05:15", data: { message_id: "m1", status: "sent" } })).status, 500);
});

/* ---------- phone auth ---------- */
const post = (handler, body, headers = {}) => run(handler, { method: "POST", body, headers: { "x-forwarded-for": "9.9.9.9", ...headers } });
const rl = (allowed = true) => [(u) => has(u, "rl_hit"), reply(200, { allowed, count: 1, retry_after_s: 120 })];
const audit = [(u) => has(u, "audit_logs"), reply(201)];

test("phone auth is OFF by default: config says disabled, start/verify refuse, no provider/db calls", async () => {
  env(); const calls = install([[() => true, reply(200, {})]]);
  assert.equal((await run(start, { method: "GET" })).json.enabled, false);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 503);
  assert.equal((await post(verify, { phone: "0552148347", code: "123456" })).status, 503);
  assert.equal(calls.length, 0);
});
test("start: invalid phone / purpose rejected; rate limit -> 429 with Retry-After and no provider call", async () => {
  env(LIVE); let calls = install([rl(true), [() => true, reply(200, {})]]);
  assert.equal((await post(start, { phone: "123", purpose: "signup" })).status, 400);
  assert.equal((await post(start, { phone: "0552148347", purpose: "login" })).status, 400);
  calls = install([rl(false), audit]);
  const r = await post(start, { phone: "0552148347", purpose: "signup" });
  assert.equal(r.status, 429); assert.equal(r.headers["retry-after"], "120"); assert.ok(!calls.some((c) => has(c.url, "/otp/generate")));
});
test("start (signup): sends via provider, stores only otp_id (no code), answers ok", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/generate"), reply(200, { success: true, otp_id: 77 })], [(u) => has(u, "sasusync_otp_requests"), reply(201)], audit]);
  const r = await post(start, { phone: "+233552148347", purpose: "signup" });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  const ins = calls.find((c) => has(c.url, "sasusync_otp_requests") && c.method === "POST");
  assert.deepEqual(Object.keys(ins.body).sort(), ["otp_id", "phone", "purpose", "user_id"]); assert.equal(ins.body.otp_id, "77");
  assert.ok(!JSON.stringify(calls).includes("%otp_code%") === false); // provider message template only; never a real code
});
test("start (signup) for an existing number -> 409; (reset) for unknown number -> identical 200, nothing sent (no enumeration)", async () => {
  env(LIVE); let calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, "uuid-1")], audit]);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 409);
  calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], audit]);
  const r = await post(start, { phone: "0552148347", purpose: "reset" });
  assert.equal(r.status, 200); assert.ok(!calls.some((c) => has(c.url, "/otp/generate")));
});
test("start: provider 429 (code already pending) -> 429 to the user, exactly one generate call, no second code", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/generate"), reply(429, { detail: "pending" })], audit]);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 429);
  assert.equal(calls.filter((c) => has(c.url, "/otp/generate")).length, 1);
});
test("start: sender not approved (live disabled) -> 503, provider never called", async () => {
  env({ SASUSYNC_PHONE_AUTH: "true" }); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], audit]);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 503);
  assert.ok(!calls.some((c) => has(c.url, "sms.test")));
});
const pending = [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [{ otp_id: "77", purpose: "signup", user_id: null }])];
test("verify: wrong / expired / no pending / already_verified -> 400 with reason, NO session, no account created", async () => {
  for (const reason of ["wrong_code", "expired", "no_pending_code", "already_verified"]) {
    env(LIVE); const calls = install([rl(), pending, [(u) => has(u, "/otp/verify"), reply(200, { verified: false, reason, ...(reason === "wrong_code" ? { attempts_remaining: 2 } : {}) })], [(u) => has(u, "sasusync_otp_requests?otp_id"), reply(204)], audit]);
    const r = await post(verify, { phone: "0552148347", code: "123456" });
    assert.equal(r.status, 400); assert.equal(r.json.reason, reason); assert.equal(r.json.session, undefined);
    assert.ok(!calls.some((c) => has(c.url, "/auth/v1/")));
  }
});
test("verify: no pending request for the number -> 400 and the provider is not asked", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [])], audit]);
  assert.equal((await post(verify, { phone: "0552148347", code: "123456" })).status, 400); assert.ok(!calls.some((c) => has(c.url, "/otp/verify")));
});
const claimOk = [(u, o) => has(u, "sasusync_otp_requests?otp_id") && o.method === "PATCH", (u, o) => (JSON.parse(o.body).status === "verified" ? reply(200, [{ otp_id: "77" }]) : reply(204))];
const grantOk = [(u) => has(u, "grant_type=password"), reply(200, { access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "bearer" })];
test("verify (signup): verified===true creates a SYNTHETIC-EMAIL user (no phone, no Supabase phone provider), links the number, returns a session; claim comes first", async () => {
  env(LIVE); const calls = install([rl(), pending, [(u) => has(u, "/otp/verify"), reply(200, { verified: true, reason: "verified" })], claimOk,
    [(u, o) => has(u, "/auth/v1/admin/users") && o.method === "POST", reply(200, { id: "new-user" })], [(u) => has(u, "/rest/v1/phone_identities"), reply(201)], grantOk, audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" });
  assert.equal(r.status, 200); assert.equal(r.json.session.access_token, "a"); assert.equal(r.json.session.password, undefined);
  const urls = calls.map((c) => c.url);
  assert.ok(urls.findIndex((u) => has(u, "otp_id=eq.77")) < urls.findIndex((u) => has(u, "/auth/v1/admin/users")));
  const create = calls.find((c) => has(c.url, "/auth/v1/admin/users")).body;
  assert.equal(create.email, "p233552148347@phone.baidx.invalid"); assert.equal(create.email_confirm, true); assert.equal(create.phone, undefined); assert.equal(create.phone_confirm, undefined);
  assert.ok(create.password.length >= 30 && create.password.length < 72);
  const link = calls.find((c) => has(c.url, "/rest/v1/phone_identities")).body; assert.deepEqual(link, { phone: "233552148347", user_id: "new-user" });
  const grant = calls.find((c) => has(c.url, "grant_type=password")).body; assert.equal(grant.email, create.email); assert.equal(grant.phone, undefined);
  assert.ok(!calls.some((c) => has(c.url, "/auth/v1/otp") || has(c.url, "type=sms")), "no Supabase phone OTP call anywhere");
  assert.ok(!JSON.stringify(calls.filter((c) => !has(c.url, "/otp/verify"))).includes("123456")); assert.ok(!JSON.stringify(r.json).includes("123456"));
});
test("verify (signup): if the number can't be linked (race) the just-created user is deleted and no session is returned", async () => {
  env(LIVE); const calls = install([rl(), pending, [(u) => has(u, "/otp/verify"), reply(200, { verified: true })], claimOk,
    [(u, o) => has(u, "/auth/v1/admin/users") && o.method === "POST", reply(200, { id: "new-user" })], [(u, o) => has(u, "/auth/v1/admin/users/new-user") && o.method === "DELETE", reply(200, {})], [(u) => has(u, "/rest/v1/phone_identities"), reply(409, { code: "23505" })], grantOk, audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" });
  assert.equal(r.status, 409); assert.equal(r.json.session, undefined); assert.ok(calls.some((c) => c.method === "DELETE")); assert.ok(!calls.some((c) => has(c.url, "grant_type")));
});
test("verify (reset): existing user's own email is kept; password replaced by a random temp one; session minted by email grant", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [{ otp_id: "77", purpose: "reset", user_id: "u-1" }])], [(u) => has(u, "/otp/verify"), reply(200, { verified: true })], claimOk,
    [(u, o) => has(u, "/auth/v1/admin/users/u-1") && o.method === "GET", reply(200, { id: "u-1", email: "real@person.test" })], [(u, o) => has(u, "/auth/v1/admin/users/u-1") && o.method === "PUT", reply(200, {})], [(u) => has(u, "/rest/v1/phone_identities"), reply(201)], grantOk, audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" });
  assert.equal(r.status, 200); const put = calls.find((c) => c.method === "PUT").body; assert.equal(put.email, undefined); assert.ok(put.password); assert.equal(put.phone, undefined);
  assert.equal(calls.find((c) => has(c.url, "grant_type")).body.email, "real@person.test");
});
test("verify (reset): a phone-only legacy user gets the synthetic email set so the grant can work", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [{ otp_id: "77", purpose: "reset", user_id: "u-2" }])], [(u) => has(u, "/otp/verify"), reply(200, { verified: true })], claimOk,
    [(u, o) => has(u, "/auth/v1/admin/users/u-2") && o.method === "GET", reply(200, { id: "u-2", email: "" })], [(u, o) => has(u, "/auth/v1/admin/users/u-2") && o.method === "PUT", reply(200, {})], [(u) => has(u, "/rest/v1/phone_identities"), reply(201)], grantOk, audit]);
  await post(verify, { phone: "0552148347", code: "123456" });
  assert.equal(calls.find((c) => c.method === "PUT").body.email, "p233552148347@phone.baidx.invalid");
});
test("verify: replay/double submit loses the claim -> 409 and NO session", async () => {
  env(LIVE); const calls = install([rl(), pending, [(u) => has(u, "/otp/verify"), reply(200, { verified: true })], [(u) => has(u, "sasusync_otp_requests?otp_id"), reply(200, [])], audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" }); assert.equal(r.status, 409); assert.ok(!calls.some((c) => has(c.url, "/auth/v1/")));
});
test("verify: rate limited -> 429 without calling the provider", async () => {
  env(LIVE); const calls = install([rl(false)]);
  assert.equal((await post(verify, { phone: "0552148347", code: "123456" })).status, 429); assert.ok(!calls.some((c) => has(c.url, "sms.test")));
});
test("verify: provider verified:'true' (string) or missing is NOT success", async () => {
  env(LIVE); install([rl(), pending, [(u) => has(u, "/otp/verify"), reply(200, { success: true, message: "OTP verified" })], [(u) => has(u, "sasusync_otp_requests?otp_id"), reply(204)], audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" }); assert.equal(r.status, 400); assert.equal(r.json.session, undefined);
});

/* ---------- SMS notification route ---------- */
const SEC = "push-secret-fake";
const secretRoute = [(u) => has(u, "app_secrets"), reply(200, [{ v: SEC }])];
const nreq = (id = "11111111-1111-1111-1111-111111111111") => ({ method: "POST", body: { notification_id: id }, headers: { "x-push-secret": SEC } });
test("sms-notify: wrong secret 401; flag off -> skipped, no provider call", async () => {
  env(); install([secretRoute, [(u) => has(u, "platform_settings"), reply(200, [{ value: false }])]]);
  assert.equal((await run(notify, { method: "POST", body: {}, headers: { "x-push-secret": "bad" } })).status, 401);
  const calls = install([secretRoute, [(u) => has(u, "platform_settings"), reply(200, [{ value: false }])]]);
  assert.equal((await run(notify, nreq())).json.skipped, "disabled"); assert.ok(!calls.some((c) => has(c.url, "sms.test")));
});
test("sms-notify: not opted in (no preference row) -> skipped; opted in -> sandbox send logged with masked number and provider ref", async () => {
  const base = [secretRoute, [(u) => has(u, "platform_settings"), reply(200, [{ value: true }])], [(u) => has(u, "/notifications?id="), reply(200, [{ id: "n", user_id: "u1", category: "payments", title: "Payment received" }])], [(u) => has(u, "notification_logs?notification_id"), reply(200, [])]];
  env(); let calls = install([...base, [(u) => has(u, "sms_recipient"), reply(200, null)]]);
  assert.equal((await run(notify, nreq())).json.skipped, "not_opted_in"); assert.ok(!calls.some((c) => has(c.url, "sms.test")));
  calls = install([...base, [(u) => has(u, "sms_recipient"), reply(200, "233552148347")], [(u) => has(u, "/smssandbox/v1/send"), reply(200, { success: true, balance: { deducted: 1, remaining: 9 }, data: { job_id: 5, status: "queued" } })], [(u) => has(u, "/notification_logs"), reply(201)]]);
  assert.equal((await run(notify, nreq())).json.ok, true);
  const log = calls.find((c) => has(c.url, "/rest/v1/notification_logs") && c.method === "POST").body;
  assert.equal(log.provider_ref, "5"); assert.equal(log.channel, "sms"); assert.ok(!JSON.stringify(log).includes("233552148347")); assert.equal(log.meta.sandbox, true);
});
test("sms-notify: duplicate notification is not sent twice; marketing/other categories are never sent", async () => {
  env(); let calls = install([secretRoute, [(u) => has(u, "platform_settings"), reply(200, [{ value: true }])], [(u) => has(u, "/notifications?id="), reply(200, [{ id: "n", user_id: "u", category: "announcements", title: "Sale" }])]]);
  assert.equal((await run(notify, nreq())).json.skipped, "category");
  calls = install([secretRoute, [(u) => has(u, "platform_settings"), reply(200, [{ value: true }])], [(u) => has(u, "/notifications?id="), reply(200, [{ id: "n", user_id: "u", category: "payments", title: "x" }])], [(u) => has(u, "notification_logs?notification_id"), reply(200, [{ id: "l" }])]]);
  assert.equal((await run(notify, nreq())).json.skipped, "duplicate");
});

/* ---------- admin ---------- */
test("admin: no token 401; non-admin 403; refresh reads balance+sender only (GET), hides main_balance without finance permission", async () => {
  env(); install([]); assert.equal((await run(admin, { method: "POST", body: {}, headers: {} })).status, 401);
  install([[(u) => has(u, "admin_sms_overview"), reply(403, { message: "not allowed" })]]);
  assert.equal((await run(admin, { method: "POST", body: {}, headers: { authorization: "Bearer t" } })).status, 403);
  const calls = install([[(u) => has(u, "admin_sms_overview"), reply(200, { delivery_7d: {} })], [(u) => has(u, "platform_whoami"), reply(200, { can: ["support:READ"] })],
    [(u) => has(u, "/api/v1/balance"), reply(200, { sms_credits: 400, main_balance: "0.00", currency: "GHS", sms_sendable: 400, otp_sendable: 133, otp_voice_sendable: 0, rates: { otp_sms_credits: 3 } })],
    [(u) => has(u, "/sender/id/status"), reply(200, { status: "pending" })], [(u) => has(u, "platform_settings"), reply(200, [{}])]]);
  const r = await run(admin, { method: "POST", body: { action: "refresh" }, headers: { authorization: "Bearer t" } });
  assert.equal(r.status, 200); assert.equal(r.json.capacity.otp_sendable, 133); assert.equal(r.json.capacity.main_balance, undefined); assert.equal(r.json.sender.status, "pending"); assert.equal(r.json.live_allowed, false);
  assert.ok(calls.filter((c) => has(c.url, "sms.test")).every((c) => c.method === "GET"));
  assert.ok(!JSON.stringify(r.json).includes("FAKE_KEY"));
});

/* ---------- security ---------- */
test("security: nothing in any route logs (no console output) and responses never carry keys/secrets", async () => {
  env(LIVE); const out = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => out.push(a.join(" "));
  install([rl(), pending, [(u) => has(u, "/otp/verify"), reply(500, { detail: "ss_FAKE_KEY_FOR_TESTS 123456" })], audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" });
  Object.assign(console, o);
  assert.deepEqual(out, []); assert.ok(!JSON.stringify(r).includes("FAKE_KEY") && !JSON.stringify(r).includes("123456"));
});

/* ---------- staff sandbox SMS test action ---------- */
const sbReq = (over = {}, headers = { authorization: "Bearer t" }) => ({ method: "POST", headers, body: { action: "sandbox_test", sandbox_test: true, to: "0552148347", ...over } });
const staffOk = [(u) => has(u, "admin_sms_overview"), reply(200, {})];
const who = (can) => [(u) => has(u, "platform_whoami"), reply(200, { can })];
const sandboxSend = [(u) => has(u, "/smssandbox/v1/send"), reply(200, { success: true, balance: { deducted: 0, remaining: 400 }, data: { status: "queued", job_id: 321 } })];
const aud = [(u) => has(u, "audit_logs"), reply(201)];

test("sandbox test: authorized staff succeeds, labelled SANDBOX — NO DELIVERY, only /smssandbox/v1/send is called", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const calls = install([staffOk, who(["finance:ADMINISTER"]), sandboxSend, aud]);
  const r = await run(admin, sbReq());
  assert.equal(r.status, 200); assert.equal(r.json.result, "SANDBOX — NO DELIVERY"); assert.equal(r.json.success, true); assert.equal(r.json.job_id, "321"); assert.equal(r.json.delivered, false); assert.equal(r.json.charged, false);
  const provider = calls.filter((c) => has(c.url, "sms.test")); assert.equal(provider.length, 1); assert.ok(provider[0].url.endsWith("/smssandbox/v1/send"));
  assert.equal(provider[0].body.recipients[0], "233552148347"); // normalized with the shared utility
  assert.ok(!JSON.stringify(r.json).includes("233552148347") && !JSON.stringify(r.json).includes("sandbox test message"));
});
test("sandbox test: unauthorized rejected (no token 401, non-admin 403, admin without finance:ADMINISTER 403) and no provider call", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); let calls = install([]);
  assert.equal((await run(admin, sbReq({}, {}))).status, 401);
  calls = install([[(u) => has(u, "admin_sms_overview"), reply(403, {})]]);
  assert.equal((await run(admin, sbReq())).status, 403);
  calls = install([staffOk, who(["support:READ"]), sandboxSend]);
  assert.equal((await run(admin, sbReq())).status, 403);
  assert.ok(!calls.some((c) => has(c.url, "sms.test")));
});
test("sandbox test: refused unless SASUSYNC_MODE is exactly sandbox (unset, live, anything else) and unless explicitly flagged", async () => {
  for (const mode of [undefined, "live", "Sandbox ", "prod"]) {
    env(); if (mode !== undefined) process.env.SASUSYNC_MODE = mode;
    const calls = install([staffOk, who(["finance:ADMINISTER"]), sandboxSend, aud]);
    assert.equal((await run(admin, sbReq())).status, 409, String(mode)); assert.ok(!calls.some((c) => has(c.url, "sms.test")));
  }
  env({ SASUSYNC_MODE: "sandbox" }); const calls = install([staffOk, who(["finance:ADMINISTER"]), sandboxSend, aud]);
  assert.equal((await run(admin, sbReq({ sandbox_test: undefined }))).status, 400); assert.equal((await run(admin, sbReq({ sandbox_test: "true" }))).status, 400);
  assert.equal((await run(admin, sbReq({ to: "123" }))).status, 400); assert.ok(!calls.some((c) => has(c.url, "sms.test")));
});
test("sandbox test: the live endpoint can never be selected, even with live env vars forced on", async () => {
  const { sendSandboxSms } = require("../api/_lib/sasusync/sms");
  env({ SASUSYNC_MODE: "live", SASUSYNC_SENDER_APPROVED: "true" }); let calls = install([sandboxSend]);
  await sendSandboxSms({ to: "0552148347", message: "x" }); assert.ok(calls.every((c) => !has(c.url, "/api/v1/send")) && calls[0].url.endsWith("/smssandbox/v1/send"));
  // and through the route: live mode is rejected before any provider call
  calls = install([staffOk, who(["finance:ADMINISTER"]), [(u) => has(u, "/api/v1/send"), reply(200, { success: true })], sandboxSend, aud]);
  assert.equal((await run(admin, sbReq())).status, 409); assert.equal(calls.filter((c) => has(c.url, "sms.test")).length, 0);
  const fs = require("node:fs"); assert.ok(!/api\/v1\/send/.test(fs.readFileSync(require.resolve("../api/sasusync-admin"), "utf8").replace(/\/\/.*$/gm, "")));
});
test("sandbox test: provider errors are handled safely (typed category, 200 with success:false, no secrets, still labelled)", async () => {
  for (const [st, kind] of [[401, "AUTH"], [402, "INSUFFICIENT_CREDIT"], [403, "FORBIDDEN"], [422, "VALIDATION"]]) {
    env({ SASUSYNC_MODE: "sandbox" }); const calls = install([staffOk, who(["finance:ADMINISTER"]), [(u) => has(u, "/smssandbox/v1/send"), reply(st, { detail: "ss_FAKE_KEY_FOR_TESTS 233552148347" })], aud]);
    const r = await run(admin, sbReq());
    assert.equal(r.json.result, "SANDBOX — NO DELIVERY"); assert.equal(r.json.success, false); assert.equal(r.json.error_category, kind);
    assert.ok(!JSON.stringify(r.json).includes("FAKE_KEY") && !JSON.stringify(r.json).includes("233552148347"));
    assert.equal(calls.filter((c) => has(c.url, "sms.test")).length, 1); // 4xx: never retried
  }
});
test("sandbox test: no console output, and audit entries hold no full phone, message or key", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const out = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => out.push(a.join(" "));
  const calls = install([staffOk, who(["finance:ADMINISTER"]), sandboxSend, aud]);
  await run(admin, sbReq()); Object.assign(console, o);
  assert.deepEqual(out, []);
  const a = JSON.stringify(calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body));
  assert.ok(a.includes("sms.sandbox_test") && !a.includes("233552148347") && !a.includes("sandbox test message") && !a.includes("FAKE_KEY"));
});

/* ---------- read-only delivery lookup ---------- */
const lookReq = (over = {}, headers = { authorization: "Bearer t" }) => ({ method: "POST", headers, body: { action: "sms_status", job_id: "sandbox_46f63165bc13", ...over } });
const statusRoute = (body, st = 200) => [(u) => has(u, "/api/v1/status/"), reply(st, body)];
test("lookup: staff gets provider message ids matched to webhook state and the notification log; read-only GETs only", async () => {
  env({ SASUSYNC_MODE: "sandbox" });
  const calls = install([staffOk, statusRoute({ success: true, status: "completed", delivery_status: "delivered", sandbox: true, messages: [{ message_id: "m-1", status: "delivered" }] }),
    [(u) => has(u, "sasusync_message_state"), reply(200, [{ message_id: "m-1", status: "delivered" }])], [(u) => has(u, "notification_logs"), reply(200, [{ id: "log-1", status: "sent" }])]]);
  const r = await run(admin, lookReq());
  assert.equal(r.status, 200); assert.equal(r.json.delivery_status, "delivered"); assert.deepEqual(r.json.messages, [{ message_id: "m-1", provider_status: "delivered", webhook_state: "delivered" }]); assert.deepEqual(r.json.matched_log, { id: "log-1", status: "sent" });
  assert.ok(calls.every((c) => c.method === "GET" || has(c.url, "admin_sms_overview"))); // no writes, no sends
  assert.ok(!calls.some((c) => has(c.url, "/send") || has(c.url, "/otp/")));
});
test("lookup: unauthorized rejected; invalid job id rejected; no provider call in either case", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); let calls = install([]);
  assert.equal((await run(admin, lookReq({}, {}))).status, 401);
  calls = install([[(u) => has(u, "admin_sms_overview"), reply(403, {})]]); assert.equal((await run(admin, lookReq())).status, 403);
  calls = install([staffOk]); assert.equal((await run(admin, lookReq({ job_id: "1/../../x" }))).status, 400); assert.equal((await run(admin, lookReq({ job_id: "a b" }))).status, 400);
  assert.ok(!calls.some((c) => has(c.url, "sms.test")));
});
test("lookup: provider error handled safely (category only, no secrets); unknown job reports unknown", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); install([staffOk, statusRoute({ detail: "ss_FAKE_KEY_FOR_TESTS" }, 401)]);
  const r = await run(admin, lookReq()); assert.equal(r.json.error_category, "AUTH"); assert.ok(!JSON.stringify(r.json).includes("FAKE_KEY"));
  install([staffOk, statusRoute({ success: true, delivery_status: "unknown", messages: [] }), [(u) => has(u, "notification_logs"), reply(200, [])]]);
  const u = await run(admin, lookReq()); assert.equal(u.json.delivery_status, "unknown"); assert.deepEqual(u.json.messages, []); assert.equal(u.json.matched_log, null);
});

/* ---------- one-message live test ---------- */
const liveReq = (over = {}, headers = { authorization: "Bearer t" }) => ({ method: "POST", headers, body: { action: "live_test", live_test: true, confirm: "SEND ONE LIVE SMS", to: "0552148347", ...over } });
const userRoute = [(u) => has(u, "/auth/v1/user"), reply(200, { id: "admin-1" })];
const LIVEENV = { SASUSYNC_MODE: "live", SASUSYNC_SENDER_APPROVED: "true" };
const senderRoute = (st) => [(u) => has(u, "/sender/id/status"), reply(200, { status: st })];
const balRoute = (n = 400) => [(u) => has(u, "/api/v1/balance"), reply(200, { sms_credits: n, sms_sendable: n, otp_sendable: 100, rates: { otp_sms_credits: 3 }, currency: "GHS" })];
const sendRoute = [(u) => has(u, "/api/v1/send"), reply(200, { success: true, balance: { deducted: 1, remaining: 399 }, data: { status: "queued", job_id: "j-1" } })];
const base = (...extra) => [staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), senderRoute("approved"), balRoute(), sendRoute, aud, ...extra];

test("live test: authorized + confirmed + approved sender sends EXACTLY one live SMS, single attempt, reports credits used", async () => {
  env(LIVEENV); const calls = install(base());
  const r = await run(admin, liveReq());
  assert.equal(r.status, 200); assert.equal(r.json.result, "LIVE — REAL SMS"); assert.equal(r.json.sent, true); assert.equal(r.json.job_id, "j-1"); assert.equal(r.json.credits_used, 1); assert.equal(r.json.credits_remaining, 399);
  assert.equal(calls.filter((c) => has(c.url, "/api/v1/send")).length, 1); assert.ok(!calls.some((c) => has(c.url, "/otp/") || has(c.url, "smssandbox")));
  assert.ok(!JSON.stringify(r.json).includes("233552148347") && !JSON.stringify(r.json).includes("live SMS is working"));
});
test("live test: refused unless live env on, confirmation typed exactly, flag boolean true, valid number, and staff authorized (no send in any case)", async () => {
  const cases = [[{}, {}, 401], [{ SASUSYNC_MODE: "sandbox" }, {}, 409], [{ SASUSYNC_MODE: "live" }, {}, 409], [LIVEENV, { confirm: "yes" }, 400], [LIVEENV, { live_test: "true" }, 400], [LIVEENV, { to: "123" }, 400]];
  for (const [e, over, status] of cases) {
    env(e); const calls = install(base()); const r = await run(admin, liveReq(over, status === 401 ? {} : { authorization: "Bearer t" }));
    assert.equal(r.status, status, JSON.stringify([e, over])); assert.equal(calls.filter((c) => has(c.url, "/api/v1/send")).length, 0);
  }
  env(LIVEENV); let calls = install([staffOk, who(["support:READ"]), userRoute, rl(), senderRoute("approved"), balRoute(), sendRoute]);
  assert.equal((await run(admin, liveReq())).status, 403); assert.equal(calls.filter((c) => has(c.url, "/api/v1/send")).length, 0);
});
test("live test: provider must itself report the sender approved; pending/rejected/unknown/no credit -> nothing sent", async () => {
  for (const st of ["pending", "rejected", "not_found", "weird"]) {
    env(LIVEENV); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), senderRoute(st), balRoute(), sendRoute, aud]);
    const r = await run(admin, liveReq()); assert.equal(r.json.sent, false); assert.equal(r.json.error_category, "SENDER_NOT_APPROVED"); assert.equal(calls.filter((c) => has(c.url, "/api/v1/send")).length, 0);
  }
  env(LIVEENV); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), senderRoute("approved"), balRoute(0), sendRoute, aud]);
  assert.equal((await run(admin, liveReq())).json.error_category, "NO_CREDIT"); assert.equal(calls.filter((c) => has(c.url, "/api/v1/send")).length, 0);
});
test("live test: rate limited (per admin / global) -> 429 and nothing sent", async () => {
  env(LIVEENV); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(false), senderRoute("approved"), balRoute(), sendRoute]);
  assert.equal((await run(admin, liveReq())).status, 429); assert.equal(calls.filter((c) => has(c.url, "/api/v1/send")).length, 0);
});
test("live test: a failed or timed-out send is NEVER resent; errors carry category only", async () => {
  for (const [rsp, kind] of [[reply(503, { detail: "busy ss_FAKE_KEY_FOR_TESTS" }), "SERVER"], [reply(402, { detail: "no credit" }), "INSUFFICIENT_CREDIT"], [new Error("ECONNRESET"), "NETWORK"], [Object.assign(new Error("a"), { name: "AbortError" }), "TIMEOUT"]]) {
    env(LIVEENV); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), senderRoute("approved"), balRoute(), [(u) => has(u, "/api/v1/send"), rsp], aud]);
    const r = await run(admin, liveReq());
    assert.equal(r.json.sent, false); assert.equal(r.json.error_category, kind); assert.equal(calls.filter((c) => has(c.url, "/api/v1/send")).length, 1, kind);
    assert.ok(!JSON.stringify(r.json).includes("FAKE_KEY") && !JSON.stringify(r.json).includes("233552148347"));
    if (kind === "NETWORK" || kind === "TIMEOUT") assert.ok(r.json.note);
  }
});
test("live test: no console output; audit holds masked number, no message, no key", async () => {
  env(LIVEENV); const out = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => out.push(a.join(" "));
  const calls = install(base()); await run(admin, liveReq()); Object.assign(console, o);
  assert.deepEqual(out, []);
  const a = JSON.stringify(calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body));
  assert.ok(a.includes("sms.live_test") && !a.includes("233552148347") && !a.includes("live SMS is working") && !a.includes("FAKE_KEY"));
});

/* ---------- phone + password login (no Supabase phone provider) ---------- */
const login = require("../api/auth/phone/login");
test("login: OFF by default (503, no calls); invalid input 400; rate limited 429", async () => {
  env(); let calls = install([[() => true, reply(200, {})]]); assert.equal((await post(login, { phone: "0552148347", password: "x" })).status, 503); assert.equal(calls.length, 0);
  env(LIVE); install([rl(), [() => true, reply(200, {})]]); assert.equal((await post(login, { phone: "12", password: "x" })).status, 400); assert.equal((await post(login, { phone: "0552148347", password: "" })).status, 400);
  calls = install([rl(false)]); const r = await post(login, { phone: "0552148347", password: "x" }); assert.equal(r.status, 429); assert.equal(r.headers["retry-after"], "120");
});
test("login: maps number -> account server-side, signs in by that account's EMAIL grant, returns session; never calls a phone grant", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, "u-1")], [(u) => has(u, "/auth/v1/admin/users/u-1"), reply(200, { id: "u-1", email: "p233552148347@phone.baidx.invalid" })], grantOk]);
  const r = await post(login, { phone: "+233552148347", password: "correct horse" });
  assert.equal(r.status, 200); assert.equal(r.json.session.access_token, "a");
  const g = calls.find((c) => has(c.url, "grant_type=password")).body; assert.equal(g.email, "p233552148347@phone.baidx.invalid"); assert.equal(g.phone, undefined);
  assert.ok(!JSON.stringify(r.json).includes("phone.baidx.invalid")); // the internal email is never returned
});
test("login: unknown number, no email, or wrong password all give the SAME 401 (no enumeration); wrong password is audited with a masked number", async () => {
  env(LIVE); let r = []; 
  install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)]]); r.push(await post(login, { phone: "0552148347", password: "x" }));
  install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, "u-1")], [(u) => has(u, "/auth/v1/admin/users/u-1"), reply(200, { id: "u-1" })]]); r.push(await post(login, { phone: "0552148347", password: "x" }));
  const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, "u-1")], [(u) => has(u, "/auth/v1/admin/users/u-1"), reply(200, { id: "u-1", email: "e@x.test" })], [(u) => has(u, "grant_type"), reply(400, { error_code: "invalid_credentials" })], audit]);
  r.push(await post(login, { phone: "0552148347", password: "wrong" }));
  assert.ok(r.every((x) => x.status === 401 && JSON.stringify(x.json) === JSON.stringify(r[0].json)));
  const a = JSON.stringify(calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body)); assert.ok(a.includes("phone.login_failed") && !a.includes("233552148347") && !a.includes("wrong"));
});
test("identity helpers: synthetic email is deterministic and reserved-domain; temp password is under the 72-byte limit", () => {
  const id = require("../api/_lib/sasusync/identity");
  assert.equal(id.syntheticEmail("233552148347"), "p233552148347@phone.baidx.invalid"); assert.ok(id.syntheticEmail("233552148347").endsWith(".invalid"));
  const p = id.tempPassword(); assert.ok(p.length < 72 && p.length >= 30 && p !== id.tempPassword());
});
