// Messaging routes on Zend (https://tryzend.com/docs): phone sign-in codes, delivery webhook, notification texts,
// Mission Control (live tests, lookups, announcements by SMS / WhatsApp / email). No real network: every fetch is scripted.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { install, reply, env, run } = require("./_mock");
const { parseEvent, signatureMatches } = require("../api/_lib/messaging/webhook");
const start = require("../api/_lib/phoneauth/start");
const verify = require("../api/_lib/phoneauth/verify");
const notify = require("../api/sms-notify");
const admin = require("../api/messaging-admin");
const webhook = require("../api/webhooks/zend");
const LIVE = { MESSAGING_LIVE: "true", MESSAGING_PHONE_AUTH: "true" };
const has = (u, s) => u.includes(s);
const isZv = (u) => has(u, "zend.test/otp/") && has(u, "/verify");
const zv = (u) => isZv(u);
const zendPosts = (calls) => calls.filter((c) => has(c.url, "zend.test") && c.method === "POST");

/* ---------- webhook (Zend signs `${timestamp}.${raw}` with HMAC-SHA256, header "sha256=<hex>") ---------- */
const SECRET = "whsec_fake";
const sign = (raw, ts, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
function hookReq(obj, { ts = "1764000000000", sig, type = "application/json" } = {}) {
  const raw = typeof obj === "string" ? obj : JSON.stringify(obj);
  const req = Readable.from([Buffer.from(raw)]);
  req.method = "POST"; req.headers = { "content-type": type, "x-zend-timestamp": ts, "x-zend-signature-256": sig === undefined ? sign(raw, ts) : sig };
  return req;
}
const hook = (obj, o) => run(webhook, hookReq(obj, o));

test("webhook events: sent / delivered / failed / read (= delivered); unknown or incomplete events ignored", () => {
  const ev = (o) => parseEvent({ message_id: "m1", timestamp: "2026-11-24T10:00:00Z", to: "+233552148347", channel: "sms", ...o });
  assert.equal(ev({ event: "message.sent" }).status, "sent");
  assert.equal(ev({ event: "message.delivered" }).status, "delivered");
  assert.equal(ev({ event: "message.failed", error: "x" }).status, "failed");
  assert.equal(ev({ event: "message.read", channel: "whatsapp" }).status, "delivered");
  assert.equal(ev({ event: "message.sent" }).timestamp, "2026-11-24T10:00:00.000Z");
  assert.equal(parseEvent({ event: "message.sent", message_id: "m1", timestamp: "2026-11-24T10:00:00" }).timestamp, "2026-11-24T10:00:00.000Z", "no zone = UTC");
  assert.equal(parseEvent({ status: "delivered", message_id: "m2", recipient: "+233..." }, "1764000000000").timestamp, new Date(1764000000000).toISOString(), "per-message shape + header time");
  assert.equal(ev({ event: "message.queued" }), null);
  assert.equal(ev({ event: "message.sent", message_id: "" }), null);
  assert.equal(ev({ event: "message.sent", message_id: "bad id with spaces" }), null);
  assert.equal(ev({ event: "message.sent", timestamp: "not a date" }), null);
});
test("webhook signature: exact bytes + timestamp; wrong secret, edited body, missing prefix or bad lengths are rejected without throwing", () => {
  const raw = Buffer.from('{"a":1}'), ts = "1764000000000";
  assert.equal(signatureMatches(raw, SECRET, sign(raw, ts), ts), true);
  assert.equal(signatureMatches(raw, SECRET, sign(raw, ts).toUpperCase().replace("SHA256=", "sha256="), ts), true);
  assert.equal(signatureMatches(raw, "other", sign(raw, ts), ts), false);
  assert.equal(signatureMatches(Buffer.from('{"a":2}'), SECRET, sign(raw, ts), ts), false);
  assert.equal(signatureMatches(raw, SECRET, sign(raw, ts), "1764000000001"), false);
  assert.equal(signatureMatches(raw, SECRET, sign(raw, ts).slice(7), ts), false, "prefix required");
  for (const bad of ["sha256=abc", "sha256=" + "z".repeat(64), "", undefined, ["x"]]) assert.equal(signatureMatches(raw, SECRET, bad, ts), false);
  assert.equal(signatureMatches(raw, "", sign(raw, ts, ""), ts), false, "no secret never verifies");
});
test("webhook route: 503 until the secret exists; 405 / 415 / 401 checks; a signed event is stored through the idempotent DB function", async () => {
  env(); let calls = install([[() => true, reply(200, "applied")]]);
  assert.equal((await hook({ event: "message.sent", message_id: "m1", timestamp: "2026-11-24T10:00:00Z" })).status, 503); assert.equal(calls.length, 0);
  env({ ZEND_WEBHOOK_SECRET: SECRET });
  assert.equal((await run(webhook, { method: "GET", headers: {} })).status, 405);
  assert.equal((await hook({ event: "message.sent" }, { type: "text/plain" })).status, 415);
  assert.equal((await hook({ event: "message.sent", message_id: "m1" }, { sig: "sha256=" + "0".repeat(64) })).status, 401);
  calls = install([[(u) => has(u, "sasusync_apply_event"), reply(200, "applied")]]);
  const r = await hook({ event: "message.delivered", message_id: "m1", status: "delivered", channel: "whatsapp", to: "+233552148347", timestamp: "2026-11-24T10:00:00Z" });
  assert.equal(r.status, 200); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { p_message_id: "m1", p_status: "delivered", p_ts: "2026-11-24T10:00:00.000Z", p_recipient: "+233552148347" });
});
test("webhook route: unknown event acknowledged and ignored; storage failure -> 500 so Zend redelivers", async () => {
  env({ ZEND_WEBHOOK_SECRET: SECRET }); let calls = install([[() => true, reply(200, "applied")]]);
  const r = await hook({ event: "message.queued", message_id: "m1" }); assert.equal(r.status, 200); assert.equal(r.json.ignored, true); assert.equal(calls.length, 0);
  install([[() => true, reply(500, { message: "db down" })]]);
  assert.equal((await hook({ event: "message.sent", message_id: "m1", timestamp: "2026-11-24T10:00:00Z" })).status, 500);
});

/* ---------- phone auth (codes through Zend OTP) ---------- */
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
  calls = install([rl(false), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], audit]);
  const r = await post(start, { phone: "0552148347", purpose: "signup" });
  assert.equal(r.status, 429); assert.equal(r.headers["retry-after"], "120"); assert.ok(!calls.some((c) => has(c.url, "/otp/send")));
});
test("start (signup): sends via provider, stores only otp_id (no code), answers ok", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/send"), reply(200, { id: "77", status: "sent" })], [(u) => has(u, "sasusync_otp_requests"), reply(201)], audit]);
  const r = await post(start, { phone: "+233552148347", purpose: "signup" });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  const ins = calls.find((c) => has(c.url, "sasusync_otp_requests") && c.method === "POST");
  assert.deepEqual(Object.keys(ins.body).sort(), ["otp_id", "phone", "purpose", "user_id"]); assert.equal(ins.body.otp_id, "77");
  const send = calls.find((c) => has(c.url, "zend.test/otp/send")).body; // Zend makes and sends the code; BAID X never sees it
  assert.deepEqual(send, { phone_number: "+233552148347", app: "BAID X", channel: "sms", expiry: 5, length: 6 });
});
test("start (signup) for an existing number -> 409; (reset) for unknown number -> identical 200, nothing sent (no enumeration)", async () => {
  env(LIVE); let calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, "uuid-1")], audit]);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 409);
  calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], audit]);
  const r = await post(start, { phone: "0552148347", purpose: "reset" });
  assert.equal(r.status, 200); assert.ok(!calls.some((c) => has(c.url, "/otp/send")));
});
test("start: provider 429 (code already pending) -> 429 to the user, exactly one generate call, no second code", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/send"), reply(429, { detail: "pending" })], audit]);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 429);
  assert.equal(calls.filter((c) => has(c.url, "/otp/send")).length, 1);
});
test("start: sender not approved (live disabled) -> 503, provider never called", async () => {
  env({ MESSAGING_PHONE_AUTH: "true" }); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], audit]);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 503);
  assert.ok(!calls.some((c) => has(c.url, "zend.test")));
});
const pending = [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [{ otp_id: "77", purpose: "signup", user_id: null }])];
test("verify: wrong / expired / no pending / already_verified -> 400 with reason, NO session, no account created", async () => {
  const answers = { wrong_code: reply(400, { success: false, message: "Invalid OTP code", attempts_remaining: 2 }), expired: reply(400, { success: false, message: "OTP has expired", attempts_remaining: 1 }),
    no_pending_code: reply(404, { statusCode: 404, message: "OTP not found", error: "Not Found" }), already_verified: reply(400, { success: false, message: "OTP already verified" }) };
  for (const [reason, answer] of Object.entries(answers)) {
    env(LIVE); const calls = install([rl(), pending, [zv, answer], [(u) => has(u, "sasusync_otp_requests?otp_id"), reply(204)], audit]);
    const r = await post(verify, { phone: "0552148347", code: "123456" });
    assert.equal(r.status, 400, reason); assert.equal(r.json.reason, reason); assert.equal(r.json.session, undefined);
    if (reason === "wrong_code") assert.equal(r.json.attempts_remaining, 2);
    assert.ok(!calls.some((c) => has(c.url, "/auth/v1/")));
  }
});
test("verify: no pending request for the number -> 400 and the provider is not asked", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [])], audit]);
  assert.equal((await post(verify, { phone: "0552148347", code: "123456" })).status, 400); assert.ok(!calls.some((c) => isZv(c.url)));
});
const claimOk = [(u, o) => has(u, "sasusync_otp_requests?otp_id") && o.method === "PATCH", (u, o) => (JSON.parse(o.body).status === "verified" ? reply(200, [{ otp_id: "77" }]) : reply(204))];
const grantOk = [(u) => has(u, "grant_type=password"), reply(200, { access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "bearer" })];
test("verify (signup): verified===true creates a SYNTHETIC-EMAIL user (no phone, no Supabase phone provider), links the number, returns a session; claim comes first", async () => {
  env(LIVE); const calls = install([rl(), pending, [zv, reply(200, { success: true, message: "OTP verified successfully", attempts_remaining: 2 })], claimOk,
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
  assert.ok(!JSON.stringify(calls.filter((c) => !isZv(c.url))).includes("123456")); assert.ok(!JSON.stringify(r.json).includes("123456"));
});
test("verify (signup): if the number can't be linked (race) the just-created user is deleted and no session is returned", async () => {
  env(LIVE); const calls = install([rl(), pending, [zv, reply(200, { success: true, message: "OTP verified successfully", attempts_remaining: 2 })], claimOk,
    [(u, o) => has(u, "/auth/v1/admin/users") && o.method === "POST", reply(200, { id: "new-user" })], [(u, o) => has(u, "/auth/v1/admin/users/new-user") && o.method === "DELETE", reply(200, {})], [(u) => has(u, "/rest/v1/phone_identities"), reply(409, { code: "23505" })], grantOk, audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" });
  assert.equal(r.status, 409); assert.equal(r.json.session, undefined); assert.ok(calls.some((c) => c.method === "DELETE")); // the session minted in parallel is discarded, never returned
});
test("verify (reset): existing user's own email is kept; password replaced by a random temp one; session minted by email grant", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [{ otp_id: "77", purpose: "reset", user_id: "u-1" }])], [zv, reply(200, { success: true, message: "OTP verified successfully", attempts_remaining: 2 })], claimOk,
    [(u, o) => has(u, "/auth/v1/admin/users/u-1") && o.method === "GET", reply(200, { id: "u-1", email: "real@person.test" })], [(u, o) => has(u, "/auth/v1/admin/users/u-1") && o.method === "PUT", reply(200, {})], [(u) => has(u, "/rest/v1/phone_identities"), reply(201)], grantOk, audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" });
  assert.equal(r.status, 200); const put = calls.find((c) => c.method === "PUT").body; assert.equal(put.email, undefined); assert.ok(put.password); assert.equal(put.phone, undefined);
  assert.equal(calls.find((c) => has(c.url, "grant_type")).body.email, "real@person.test");
});
test("verify (reset): a phone-only legacy user gets the synthetic email set so the grant can work", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "sasusync_otp_requests?phone="), reply(200, [{ otp_id: "77", purpose: "reset", user_id: "u-2" }])], [zv, reply(200, { success: true, message: "OTP verified successfully", attempts_remaining: 2 })], claimOk,
    [(u, o) => has(u, "/auth/v1/admin/users/u-2") && o.method === "GET", reply(200, { id: "u-2", email: "" })], [(u, o) => has(u, "/auth/v1/admin/users/u-2") && o.method === "PUT", reply(200, {})], [(u) => has(u, "/rest/v1/phone_identities"), reply(201)], grantOk, audit]);
  await post(verify, { phone: "0552148347", code: "123456" });
  assert.equal(calls.find((c) => c.method === "PUT").body.email, "p233552148347@phone.baidx.invalid");
});
test("verify: replay/double submit loses the claim -> 409 and NO session", async () => {
  env(LIVE); const calls = install([rl(), pending, [zv, reply(200, { success: true, message: "OTP verified successfully", attempts_remaining: 2 })], [(u) => has(u, "sasusync_otp_requests?otp_id"), reply(200, [])], audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" }); assert.equal(r.status, 409); assert.ok(!calls.some((c) => has(c.url, "/auth/v1/")));
});
test("verify: rate limited -> 429 without calling the provider", async () => {
  env(LIVE); const calls = install([rl(false), pending]);
  assert.equal((await post(verify, { phone: "0552148347", code: "123456" })).status, 429); assert.ok(!calls.some((c) => has(c.url, "zend.test")));
});
test("verify: Zend success:'true' (string), missing success, or a 200 without success is NOT success", async () => {
  for (const body of [{ success: "true" }, { message: "OTP verified" }, {}]) {
    env(LIVE); install([rl(), pending, [zv, reply(200, body)], [(u) => has(u, "sasusync_otp_requests?otp_id"), reply(204)], audit]);
    const r = await post(verify, { phone: "0552148347", code: "123456" }); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.session, undefined);
  }
});

/* ---------- notification texts ---------- */
const SEC = "push-secret-fake";
const secretRoute = [(u) => has(u, "app_secrets"), reply(200, [{ v: SEC }])];
const nreq = (id = "11111111-1111-1111-1111-111111111111") => ({ method: "POST", body: { notification_id: id }, headers: { "x-push-secret": SEC } });
const flagOn = [(u) => has(u, "platform_settings"), reply(200, [{ value: true }])];
test("sms-notify: wrong secret 401; flag off -> skipped; not live -> skipped; no Zend call in any case", async () => {
  env(LIVE); install([secretRoute, [(u) => has(u, "platform_settings"), reply(200, [{ value: false }])]]);
  assert.equal((await run(notify, { method: "POST", body: {}, headers: { "x-push-secret": "bad" } })).status, 401);
  let calls = install([secretRoute, [(u) => has(u, "platform_settings"), reply(200, [{ value: false }])]]);
  assert.equal((await run(notify, nreq())).json.skipped, "disabled"); assert.equal(zendPosts(calls).length, 0);
  env(); calls = install([secretRoute, flagOn]);
  assert.equal((await run(notify, nreq())).json.skipped, "not_live"); assert.equal(zendPosts(calls).length, 0);
});
const nbase = [secretRoute, flagOn, [(u) => has(u, "/notifications?id="), reply(200, [{ id: "n", user_id: "u1", category: "payments", title: "Payment received" }])], [(u) => has(u, "notification_logs?notification_id"), reply(200, [])]];
test("sms-notify: not opted in -> skipped; opted in -> one SMS through Zend, logged with masked number and Zend's message id", async () => {
  env(LIVE); let calls = install([...nbase, [(u) => has(u, "sms_recipient"), reply(200, null)]]);
  assert.equal((await run(notify, nreq())).json.skipped, "not_opted_in"); assert.equal(zendPosts(calls).length, 0);
  calls = install([...nbase, [(u) => has(u, "sms_recipient"), reply(200, "233552148347")], [(u) => has(u, "zend.test/messages"), reply(200, { id: "msg_5", status: "pending", estimated_cost: 0.035 })], [(u) => has(u, "/notification_logs"), reply(201)]]);
  assert.equal((await run(notify, nreq())).json.ok, true);
  const send = zendPosts(calls); assert.equal(send.length, 1);
  assert.deepEqual(send[0].body, { to: "+233552148347", body: "BAID X: Payment received. Open BAID X to view.", preferred_channels: ["sms"] });
  assert.equal(send[0].headers["x-api-key"], "zk_FAKE_KEY_FOR_TESTS");
  const log = calls.find((c) => has(c.url, "/rest/v1/notification_logs") && c.method === "POST").body;
  assert.equal(log.provider_ref, "msg_5"); assert.equal(log.provider, "zend"); assert.ok(!JSON.stringify(log).includes("233552148347"));
});
test("sms-notify: with the notify template set, WhatsApp is tried first with SMS fallback and the title as {{title}}", async () => {
  env({ ...LIVE, ZEND_WA_TEMPLATE_NOTIFY: "tmpl_notify" });
  const calls = install([...nbase, [(u) => has(u, "sms_recipient"), reply(200, "233552148347")], [(u) => has(u, "zend.test/messages"), reply(200, { id: "msg_6", status: "pending" })], [(u) => has(u, "/notification_logs"), reply(201)]]);
  await run(notify, nreq());
  const b = zendPosts(calls)[0].body; assert.deepEqual(b.preferred_channels, ["whatsapp", "sms"]); assert.equal(b.template_id, "tmpl_notify"); assert.deepEqual(b.template_params, { title: "Payment received" });
});
test("sms-notify: a Zend failure is logged (kind only) and never resent; duplicates and other categories are never sent", async () => {
  env(LIVE); let calls = install([...nbase, [(u) => has(u, "sms_recipient"), reply(200, "233552148347")], [(u) => has(u, "zend.test/messages"), reply(503, { message: "busy" })], [(u) => has(u, "/notification_logs"), reply(201)]]);
  const r = await run(notify, nreq()); assert.equal(r.json.ok, false); assert.equal(r.json.kind, "SERVER"); assert.equal(zendPosts(calls).length, 1);
  calls = install([secretRoute, flagOn, [(u) => has(u, "/notifications?id="), reply(200, [{ id: "n", user_id: "u", category: "announcements", title: "Sale" }])]]);
  assert.equal((await run(notify, nreq())).json.skipped, "category");
  calls = install([secretRoute, flagOn, [(u) => has(u, "/notifications?id="), reply(200, [{ id: "n", user_id: "u", category: "payments", title: "x" }])], [(u) => has(u, "notification_logs?notification_id"), reply(200, [{ id: "l" }])]]);
  assert.equal((await run(notify, nreq())).json.skipped, "duplicate");
});

/* ---------- Mission Control ---------- */
const staffOk = [(u) => has(u, "admin_sms_overview"), reply(200, { delivery_7d: {} })];
const who = (can) => [(u) => has(u, "platform_whoami"), reply(200, { can })];
const aud = [(u) => has(u, "audit_logs"), reply(201)];
const me = [(u) => has(u, "/auth/v1/user"), reply(200, { id: "admin-1" })];
const A = (body, headers = { authorization: "Bearer t" }) => run(admin, { method: "POST", headers, body });
test("admin: no token 401; non-admin 403; status shows settings without secrets; refresh checks the key with ONE free GET", async () => {
  env(); install([]); assert.equal((await A({}, {})).status, 401);
  install([[(u) => has(u, "admin_sms_overview"), reply(403, { message: "not allowed" })]]); assert.equal((await A({})).status, 403);
  env({ ZEND_EMAIL_FROM: "BAID X <hello@baid-x.com>", ZEND_WA_TEMPLATE_ANNOUNCE: "tmpl_a", ZEND_WEBHOOK_SECRET: SECRET });
  const calls = install([staffOk, [(u) => has(u, "zend.test/messages?limit=1"), reply(200, { messages: [], total: 0 })], [(u) => has(u, "platform_settings"), reply(200, [{}])]]);
  const r = await A({ action: "refresh" });
  assert.equal(r.status, 200); assert.equal(r.json.provider, "zend"); assert.equal(r.json.live, false); assert.equal(r.json.key_check.ok, true);
  assert.deepEqual(r.json.whatsapp, { announce: true, notify: false }); assert.equal(r.json.email_ready, false, "email needs live"); assert.equal(r.json.webhook_secret, true);
  const z = calls.filter((c) => has(c.url, "zend.test")); assert.equal(z.length, 1); assert.equal(z[0].method, "GET");
  const txt = JSON.stringify(r.json); assert.ok(!txt.includes("FAKE_KEY") && !txt.includes(SECRET));
});
test("admin refresh: a rejected key is reported as AUTH, never thrown", async () => {
  env(); install([staffOk, [(u) => has(u, "zend.test"), reply(401, { statusCode: 401, message: "Invalid API key", error: "Unauthorized" })], [(u) => has(u, "platform_settings"), reply(200, [{}])]]);
  const r = await A({ action: "refresh" }); assert.equal(r.json.key_check.ok, false); assert.equal(r.json.key_check.kind, "AUTH");
});
const lt = (over = {}) => ({ action: "live_test", live_test: true, confirm: "SEND ONE LIVE TEST", channel: "sms", to: "0552148347", ...over });
const rlOk = [(u) => has(u, "rl_hit"), reply(200, { allowed: true, count: 1, retry_after_s: 60 })];
test("live test: refused unless live, confirmed exactly, valid recipient and finance staff (no Zend send in any case)", async () => {
  const cases = [[{}, lt()], [LIVE, lt({ confirm: "send one live test" })], [LIVE, lt({ live_test: "true" })], [LIVE, lt({ to: "123" })], [LIVE, lt({ channel: "email", to: "not-an-email" })],
    [LIVE, lt({ channel: "email", to: "me@example.com" })], [LIVE, lt({ channel: "whatsapp" })]];
  for (const [e, body] of cases) {
    env(e); const calls = install([staffOk, who(["finance:ADMINISTER"]), me, rlOk, aud, [(u) => has(u, "zend.test"), reply(200, { id: "x" })]]);
    const r = await A(body); assert.ok(r.status >= 400, JSON.stringify(body)); assert.equal(zendPosts(calls).length, 0);
  }
  env(LIVE); const calls = install([staffOk, who(["support:READ"]), [(u) => has(u, "zend.test"), reply(200, { id: "x" })]]);
  assert.equal((await A(lt())).status, 403); assert.equal(zendPosts(calls).length, 0);
});
test("live test: SMS, WhatsApp (template, SMS fallback) and email each send exactly ONE message; audit holds masked recipients only", async () => {
  env({ ...LIVE, ZEND_WA_TEMPLATE_ANNOUNCE: "tmpl_a", ZEND_EMAIL_FROM: "BAID X <hello@baid-x.com>" });
  for (const [channel, to, path] of [["sms", "0552148347", "/messages"], ["whatsapp", "0552148347", "/messages"], ["email", "me@example.com", "/email/send"]]) {
    const calls = install([staffOk, who(["finance:ADMINISTER"]), me, rlOk, aud, [(u) => has(u, "zend.test" + path), reply(200, channel === "email" ? { _id: "em_1", status: "pending" } : { id: "msg_9", status: "pending" })]]);
    const r = await A(lt({ channel, to }));
    assert.equal(r.json.sent, true, channel); assert.equal(zendPosts(calls).length, 1);
    const b = zendPosts(calls)[0].body;
    if (channel === "whatsapp") { assert.deepEqual(b.preferred_channels, ["whatsapp", "sms"]); assert.equal(b.template_id, "tmpl_a"); }
    if (channel === "email") { assert.equal(b.from, "BAID X <hello@baid-x.com>"); assert.equal(b.to, "me@example.com"); assert.ok(b.html.includes("BAID X")); assert.equal(r.json.message_id, "em_1"); }
    const a = JSON.stringify(calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body)); assert.ok(!a.includes("233552148347") && !a.includes("me@example.com") && !a.includes("0552148347"));
  }
});
test("live test: a timeout is never resent and says it may have been sent; rate limit -> 429 and nothing sent", async () => {
  env(LIVE); let calls = install([staffOk, who(["finance:ADMINISTER"]), me, rlOk, aud, [(u) => has(u, "zend.test/messages"), new Error("ECONNRESET")]]);
  const r = await A(lt()); assert.equal(r.json.sent, false); assert.equal(r.json.error_category, "NETWORK"); assert.ok(r.json.note); assert.equal(zendPosts(calls).length, 1);
  calls = install([staffOk, who(["finance:ADMINISTER"]), me, [(u) => has(u, "rl_hit"), reply(200, { allowed: false, count: 9, retry_after_s: 60 })], aud, [(u) => has(u, "zend.test"), reply(200, { id: "x" })]]);
  assert.equal((await A(lt())).status, 429); assert.equal(zendPosts(calls).length, 0);
});
test("lookup: a message id or bulk id is read with GETs only and matched to the webhook state and log", async () => {
  env(); let calls = install([staffOk, [(u) => has(u, "zend.test/messages/msg_5"), reply(200, { id: "msg_5", status: "delivered", channel_used: "whatsapp" })], [(u) => has(u, "sasusync_message_state"), reply(200, [{ message_id: "msg_5", status: "delivered" }])], [(u) => has(u, "notification_logs"), reply(200, [{ id: "l1", status: "sent" }])]]);
  let r = await A({ action: "message_status", id: "msg_5" });
  assert.equal(r.json.delivery_status, "delivered"); assert.equal(r.json.channel_used, "whatsapp"); assert.equal(r.json.messages[0].webhook_state, "delivered"); assert.equal(r.json.matched_log.id, "l1");
  assert.ok(calls.filter((c) => has(c.url, "zend.test")).every((c) => c.method === "GET"));
  install([staffOk, [(u) => has(u, "bulk_id=bulk_1"), reply(200, { status: "processing", sent: 3, delivered: 2, failed: 0, pending: 1, messages: [{ id: "m1", status: "delivered", channel_used: "sms" }] })], [(u) => has(u, "sasusync_message_state"), reply(200, [])], [(u) => has(u, "notification_logs"), reply(200, [])]]);
  r = await A({ action: "message_status", id: "bulk_1" }); assert.equal(r.json.totals.delivered, 2); assert.equal(r.json.messages[0].message_id, "m1");
  calls = install([staffOk]); assert.equal((await A({ action: "message_status", id: "bad id" })).status, 400); assert.equal(calls.filter((c) => has(c.url, "zend.test")).length, 0);
});

/* ---------- security ---------- */
test("security: nothing in any route logs (no console output) and responses never carry keys, codes or numbers", async () => {
  env(LIVE); const out = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => out.push(a.join(" "));
  install([rl(), pending, [zv, reply(500, { message: "zk_FAKE_KEY_FOR_TESTS 123456 +233552148347" })], audit]);
  const r = await post(verify, { phone: "0552148347", code: "123456" });
  Object.assign(console, o);
  assert.deepEqual(out, []); const t = JSON.stringify(r); assert.ok(!t.includes("FAKE_KEY") && !t.includes("123456") && !t.includes("233552148347"));
});

/* ---------- phone + password login (no Supabase phone provider) ---------- */
const login = require("../api/_lib/phoneauth/login");
test("login: OFF by default (503, no calls); invalid input 400; rate limited 429", async () => {
  env(); let calls = install([[() => true, reply(200, {})]]); assert.equal((await post(login, { phone: "0552148347", password: "x" })).status, 503); assert.equal(calls.length, 0);
  env(LIVE); install([rl(), [() => true, reply(200, {})]]); assert.equal((await post(login, { phone: "12", password: "x" })).status, 400); assert.equal((await post(login, { phone: "0552148347", password: "" })).status, 400);
  calls = install([rl(false), [(u) => has(u, "auth_email_by_phone"), reply(200, null)]]); const r = await post(login, { phone: "0552148347", password: "x" }); assert.equal(r.status, 429); assert.equal(r.headers["retry-after"], "120");
});
test("login: maps number -> account email in ONE lookup, signs in by that EMAIL grant, returns session; never calls a phone grant", async () => {
  env(LIVE); const calls = install([rl(), [(u) => has(u, "auth_email_by_phone"), reply(200, "p233552148347@phone.baidx.invalid")], grantOk]);
  const r = await post(login, { phone: "+233552148347", password: "correct horse" });
  assert.equal(r.status, 200); assert.equal(r.json.session.access_token, "a");
  const g = calls.find((c) => has(c.url, "grant_type=password")).body; assert.equal(g.email, "p233552148347@phone.baidx.invalid"); assert.equal(g.phone, undefined);
  assert.ok(!JSON.stringify(r.json).includes("phone.baidx.invalid")); // the internal email is never returned
  assert.equal(calls.filter((c) => !has(c.url, "rl_hit")).length, 2); // lookup + grant only: no separate user fetch
});
test("login: unknown number, no email, or wrong password all give the SAME 401 (no enumeration); wrong password is audited with a masked number", async () => {
  env(LIVE); let r = [];
  install([rl(), [(u) => has(u, "auth_email_by_phone"), reply(200, null)]]); r.push(await post(login, { phone: "0552148347", password: "x" }));
  install([rl(), [(u) => has(u, "auth_email_by_phone"), reply(200, "")]]); r.push(await post(login, { phone: "0552148347", password: "x" }));
  const calls = install([rl(), [(u) => has(u, "auth_email_by_phone"), reply(200, "e@x.test")], [(u) => has(u, "grant_type"), reply(400, { error_code: "invalid_credentials" })], audit]);
  r.push(await post(login, { phone: "0552148347", password: "wrong" }));
  assert.ok(r.every((x) => x.status === 401 && JSON.stringify(x.json) === JSON.stringify(r[0].json)));
  const a = JSON.stringify(calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body)); assert.ok(a.includes("phone.login_failed") && !a.includes("233552148347") && !a.includes("wrong"));
});
test("login: rate limit denial wins even though the lookup ran in parallel (429, no grant)", async () => {
  env(LIVE); const calls = install([rl(false), [(u) => has(u, "auth_email_by_phone"), reply(200, "e@x.test")], grantOk]);
  assert.equal((await post(login, { phone: "0552148347", password: "x" })).status, 429); assert.ok(!calls.some((c) => has(c.url, "grant_type")));
});
test("identity helpers: synthetic email is deterministic and reserved-domain; temp password is under the 72-byte limit", () => {
  const id = require("../api/_lib/messaging/identity");
  assert.equal(id.syntheticEmail("233552148347"), "p233552148347@phone.baidx.invalid"); assert.ok(id.syntheticEmail("233552148347").endsWith(".invalid"));
  const p = id.tempPassword(); assert.ok(p.length < 72 && p.length >= 30 && p !== id.tempPassword());
});

/* ---------- global daily OTP cap ---------- */
const rlByKey = (deny) => [(u, o) => has(u, "rl_hit"), (u, o) => { const k = JSON.parse(o.body).p_key; return reply(200, { allowed: !deny.includes(k), count: 1, retry_after_s: 60 }); }];
test("daily cap: when reached, start returns 429, the provider is NOT called, and it is audited", async () => {
  env(LIVE); const calls = install([rlByKey(["otp:start:all"]), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/send"), reply(200, { id: "9", status: "sent" })], audit]);
  const r = await post(start, { phone: "0552148347", purpose: "signup" });
  assert.equal(r.status, 429); assert.ok(!calls.some((c) => has(c.url, "/otp/send"))); assert.ok(calls.some((c) => has(c.url, "audit_logs") && c.body.action === "otp.daily_cap_reached"));
});
test("daily cap: counts only real sends (reset for an unknown number and invalid input do not consume it); cap env is honoured, default 40", async () => {
  env(LIVE); let calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], audit]);
  await post(start, { phone: "0552148347", purpose: "reset" }); await post(start, { phone: "12", purpose: "signup" });
  assert.ok(!calls.some((c) => has(c.url, "rl_hit") && c.body.p_key === "otp:start:all"));
  calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/send"), reply(200, { id: "5", status: "sent" })], [(u) => has(u, "sasusync_otp_requests"), reply(201)], audit]);
  await post(start, { phone: "0552148347", purpose: "signup" });
  const hit = calls.find((c) => has(c.url, "rl_hit") && c.body.p_key === "otp:start:all"); assert.equal(hit.body.p_max, 40); assert.equal(hit.body.p_window_s, 86400);
  env({ ...LIVE, MESSAGING_OTP_DAILY_CAP: "7" }); calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/send"), reply(200, { id: "6", status: "sent" })], [(u) => has(u, "sasusync_otp_requests"), reply(201)], audit]);
  await post(start, { phone: "0552148347", purpose: "signup" }); assert.equal(calls.find((c) => has(c.url, "rl_hit") && c.body.p_key === "otp:start:all").body.p_max, 7);
});
test("daily cap: a bad cap value falls back to the default (never unlimited); limiter outage fails closed (503, nothing sent)", async () => {
  for (const v of ["0", "-5", "abc", "1.5", ""]) {
    env({ ...LIVE, MESSAGING_OTP_DAILY_CAP: v }); const calls = install([rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/send"), reply(200, { id: "6", status: "sent" })], [(u) => has(u, "sasusync_otp_requests"), reply(201)], audit]);
    await post(start, { phone: "0552148347", purpose: "signup" }); assert.equal(calls.find((c) => has(c.url, "rl_hit") && c.body.p_key === "otp:start:all").body.p_max, 40, v);
  }
  env(LIVE); const calls = install([[(u, o) => has(u, "rl_hit") && JSON.parse(o.body).p_key === "otp:start:all", reply(500, {})], rl(), [(u) => has(u, "auth_user_by_phone"), reply(200, null)], [(u) => has(u, "/otp/send"), reply(200, { id: "1", status: "sent" })], audit]);
  assert.equal((await post(start, { phone: "0552148347", purpose: "signup" })).status, 503); assert.ok(!calls.some((c) => has(c.url, "/otp/send")));
});

/* ---------- announcements (SMS / WhatsApp / email) ---------- */
const bReq = (over = {}) => ({ action: "sms_broadcast", roles: ["worker"], message: "Platform update: new jobs are live.", ...over });
const mkRecipients = (n, extra = []) => [...Array.from({ length: n }, (_, i) => ({ user_id: "u" + i, role: "worker", phone: "02" + String(40000000 + i) })), ...extra];
const recRoute = (list) => [(u) => has(u, "sms_broadcast_recipients"), reply(200, list)];
const rowIns = [(u, o) => has(u, "/rest/v1/sms_broadcasts") && o.method === "POST", reply(201, [{ id: "bc-1" }])];
const rowPatch = [(u, o) => has(u, "/rest/v1/sms_broadcasts") && o.method === "PATCH", reply(204)];
const RID = "11111111-2222-4333-8444-555555555555";
const sendBody = (n, over = {}) => ({ confirm: "SEND BROADCAST", request_id: RID, expected_recipients: n, ...over });
const fin = [staffOk, who(["finance:ADMINISTER"]), me, rlOk, aud];

test("broadcast: staff gate (401 / 403 non-finance); no recipient or Zend call", async () => {
  env(LIVE); let calls = install([]); assert.equal((await A(bReq(), {})).status, 401);
  calls = install([staffOk, who(["support:READ"]), recRoute(mkRecipients(2))]); assert.equal((await A(bReq())).status, 403);
  assert.ok(!calls.some((c) => has(c.url, "sms_broadcast_recipients")) && zendPosts(calls).length === 0);
});
test("broadcast dry run: deduped valid numbers counted, nothing sent, no numbers returned; works while live is off (labelled)", async () => {
  env(); const calls = install([...fin, recRoute(mkRecipients(3, [{ user_id: "x", phone: "0240000000" }, { user_id: "y", phone: "12" }, { user_id: "z", phone: null }]))]);
  const r = await A(bReq({ dry_run: true }));
  assert.equal(r.json.recipients, 3); assert.deepEqual(r.json.skipped, { no_phone: 1, invalid_number: 1, duplicate: 1 }); assert.equal(r.json.result, "NOT LIVE — NOTHING WILL BE SENT");
  assert.equal(r.json.parts, 1); assert.equal(zendPosts(calls).length, 0); assert.ok(!JSON.stringify(r.json).includes("024000000"));
});
test("broadcast: refused while live is off even with every confirmation (nothing sent, no row)", async () => {
  env(); const calls = install([...fin, recRoute(mkRecipients(2)), rowIns]);
  const r = await A(bReq(sendBody(2))); assert.equal(r.status, 409); assert.equal(zendPosts(calls).length, 0); assert.ok(!calls.some((c) => has(c.url, "sms_broadcasts")));
});
test("broadcast send: needs typed confirm, request id and the matching count; unknown role / channel / long text refused", async () => {
  env(LIVE);
  for (const over of [{ confirm: "send" }, { request_id: "x" }, { expected_recipients: 5 }]) {
    const calls = install([...fin, recRoute(mkRecipients(2)), rowIns]); const r = await A(bReq(sendBody(2, over))); assert.ok(r.status >= 400, JSON.stringify(over)); assert.equal(zendPosts(calls).length, 0);
  }
  install([...fin]); assert.equal((await A(bReq({ roles: ["admin"] }))).status, 400); assert.equal((await A(bReq({ channel: "fax" }))).status, 400); assert.equal((await A(bReq({ message: "x".repeat(441) }))).status, 400);
});
test("broadcast SMS: ONE bulk call per 1000, single attempt, row created then finalised with the bulk id", async () => {
  env(LIVE); const calls = install([...fin, recRoute(mkRecipients(3)), rowIns, rowPatch, [(u) => has(u, "zend.test/messages/bulk"), reply(200, { id: "bulk_77", status: "pending", recipients: 3, estimated_cost: 0.1 })]]);
  const r = await A(bReq(sendBody(3)));
  assert.equal(r.json.status, "sent"); assert.equal(r.json.accepted, 3); assert.equal(r.json.channel, "sms");
  const b = zendPosts(calls); assert.equal(b.length, 1); assert.deepEqual(b[0].body.preferred_channels, ["sms"]); assert.equal(b[0].body.messages.length, 3);
  assert.equal(b[0].body.messages[0].to, "+233240000000"); assert.equal(b[0].body.messages[0].body, "BAID X: Platform update: new jobs are live.");
  const patch = calls.find((c) => has(c.url, "sms_broadcasts") && c.method === "PATCH").body; assert.equal(patch.chunks[0].bulk_id, "bulk_77");
  assert.equal(calls.find((c) => has(c.url, "sms_broadcasts") && c.method === "POST").body.mode, "sms");
});
test("broadcast WhatsApp: needs the announce template; uses it with SMS fallback and the message as {{message}}", async () => {
  env(LIVE); let calls = install([...fin, recRoute(mkRecipients(2)), rowIns]);
  assert.equal((await A(bReq({ channel: "whatsapp", ...sendBody(2) }))).status, 409); assert.equal(zendPosts(calls).length, 0);
  env({ ...LIVE, ZEND_WA_TEMPLATE_ANNOUNCE: "tmpl_a" }); calls = install([...fin, recRoute(mkRecipients(2)), rowIns, rowPatch, [(u) => has(u, "zend.test/messages/bulk"), reply(200, { id: "bulk_8" })]]);
  const r = await A(bReq({ channel: "whatsapp", ...sendBody(2) })); assert.equal(r.json.status, "sent");
  const b = zendPosts(calls)[0].body; assert.deepEqual(b.preferred_channels, ["whatsapp", "sms"]); assert.equal(b.template_id, "tmpl_a"); assert.deepEqual(b.messages[0].template_params, { message: "BAID X: Platform update: new jobs are live." });
});
test("broadcast email: login emails read with the service key; phone placeholders and unconfirmed emails skipped; one email each", async () => {
  env({ ...LIVE, ZEND_EMAIL_FROM: "BAID X <hello@baid-x.com>" });
  const users = { users: [{ id: "u0", email: "a@x.com", email_confirmed_at: "2026-01-01" }, { id: "u1", email: "p233@phone.baidx.invalid", email_confirmed_at: "2026-01-01" }, { id: "u2", email: "c@x.com", email_confirmed_at: null }, { id: "zz", email: "other@x.com", email_confirmed_at: "2026-01-01" }] };
  const calls = install([...fin, recRoute(mkRecipients(3)), [(u) => has(u, "/auth/v1/admin/users?page=1"), reply(200, users)], rowIns, rowPatch, [(u) => has(u, "zend.test/email/send"), reply(200, { _id: "em", status: "pending" })]]);
  const p = await A(bReq({ channel: "email", subject: "New on BAID X", dry_run: true }));
  assert.equal(p.json.recipients, 1); assert.equal(p.json.skipped.no_email, 2);
  const r = await A(bReq({ channel: "email", subject: "New on BAID X", ...sendBody(1) }));
  assert.equal(r.json.accepted, 1); const e = zendPosts(calls); assert.equal(e.length, 1);
  assert.equal(e[0].body.to, "a@x.com"); assert.equal(e[0].body.subject, "New on BAID X"); assert.ok(e[0].body.text.includes("turn off Announcements")); assert.ok(!e[0].body.html.includes("<script"));
});
test("broadcast: a failing call stops the run and is NEVER resent; a timeout says it may have been sent", async () => {
  env({ ...LIVE, MESSAGING_BROADCAST_MAX: "5000" }); const many = mkRecipients(1500);
  let calls = install([...fin, recRoute(many), rowIns, rowPatch, [(u) => has(u, "zend.test/messages/bulk"), (u, o) => (JSON.parse(o.body).messages.length === 1000 ? reply(200, { id: "bulk_1" }) : reply(400, { statusCode: 400, message: "Insufficient credits for bulk send. Required: 20.000, Available: 15.500." }))]]);
  let r = await A(bReq(sendBody(1500))); assert.equal(r.json.status, "partial"); assert.equal(r.json.accepted, 1000); assert.equal(r.json.error_category, "INSUFFICIENT_CREDIT"); assert.equal(zendPosts(calls).length, 2);
  calls = install([...fin, recRoute(mkRecipients(2)), rowIns, rowPatch, [(u) => has(u, "zend.test/messages/bulk"), new Error("socket hang up")]]);
  r = await A(bReq(sendBody(2))); assert.equal(r.json.status, "failed"); assert.ok(r.json.error_category.includes("may have been sent")); assert.equal(zendPosts(calls).length, 1);
});
test("broadcast: over the limit, a duplicate request id and the rate limit all refuse before any send", async () => {
  env({ ...LIVE, MESSAGING_BROADCAST_MAX: "2" }); let calls = install([...fin, recRoute(mkRecipients(3)), rowIns]);
  assert.equal((await A(bReq(sendBody(3)))).status, 409); assert.equal(zendPosts(calls).length, 0);
  env(LIVE); calls = install([...fin, recRoute(mkRecipients(2)), [(u, o) => has(u, "sms_broadcasts") && o.method === "POST", reply(409, { code: "23505" })]]);
  assert.equal((await A(bReq(sendBody(2)))).status, 409); assert.equal(zendPosts(calls).length, 0);
  calls = install([staffOk, who(["finance:ADMINISTER"]), me, [(u) => has(u, "rl_hit"), reply(200, { allowed: false, count: 9, retry_after_s: 60 })], aud, recRoute(mkRecipients(2))]);
  assert.equal((await A(bReq(sendBody(2)))).status, 429); assert.equal(zendPosts(calls).length, 0);
});
test("schedule: confirmation phrase, channel and subject are stored; email subject validated", async () => {
  env(); const at = new Date(Date.now() + 3600e3).toISOString();
  let calls = install([...fin, [(u) => has(u, "/rest/v1/sms_jobs"), reply(201, [{ id: "job-1" }])]]);
  assert.equal((await A({ action: "sms_schedule", sms: true, channel: "email", subject: "x".repeat(121), message: "Hello all", run_at: at, confirm: "SCHEDULE BROADCAST" })).status, 400);
  assert.equal((await A({ action: "sms_schedule", sms: true, channel: "whatsapp", message: "Hello all", run_at: at, confirm: "SCHEDULE SMS" })).status, 400);
  const r = await A({ action: "sms_schedule", sms: true, channel: "email", subject: "Big news", message: "Hello all", run_at: at, confirm: "SCHEDULE BROADCAST" });
  assert.equal(r.status, 200); assert.equal(r.json.live, false);
  const p = calls.find((c) => has(c.url, "sms_jobs") && c.method === "POST").body.payload; assert.equal(p.channel, "email"); assert.equal(p.subject, "Big news"); assert.deepEqual(p.channels, ["in_app", "email"]);
});

/* ---------- set password + dispatcher ---------- */
const setpw = require("../api/_lib/phoneauth/password");
const pwReq = (over = {}, headers = { authorization: "Bearer t" }) => ({ method: "POST", headers, body: { password: "Aadmin123.com", ...over } });
const meRoute = [(u) => has(u, "/auth/v1/user"), reply(200, { id: "u-1" })];
const unused = (rows = [{ otp_id: "77" }]) => [(u, o) => has(u, "sasusync_otp_requests?user_id=") && o.method === "GET", reply(200, rows)];
const claimPw = (rows = [{ otp_id: "77" }]) => [(u, o) => has(u, "sasusync_otp_requests?otp_id=") && o.method === "PATCH", reply(200, rows)];
const putUser = (okk = true) => [(u, o) => has(u, "/auth/v1/admin/users/u-1") && o.method === "PUT", okk ? reply(200, {}) : reply(500, {})];
test("set password: flag off 503; no token 401; weak passwords 400; none of them touch the account", async () => {
  env(); let calls = install([[() => true, reply(200, {})]]); assert.equal((await run(setpw, pwReq())).status, 503); assert.equal(calls.length, 0);
  env(LIVE); calls = install([meRoute, rl(), unused(), claimPw(), putUser(), aud]); assert.equal((await run(setpw, pwReq({}, {}))).status, 401);
  for (const weak of ["short1A", "alllowercase1", "NoNumbersHere!", "12345678", "abcdefgh", "x".repeat(80) + "A1", "", null]) assert.equal((await run(setpw, pwReq({ password: weak }))).status, 400, String(weak));
  assert.ok(!calls.some((c) => c.method === "PUT"));
});
test("set password: a verified session sets the password via the admin API (no 'current password' needed), once only", async () => {
  env(LIVE); const calls = install([meRoute, rl(), unused(), claimPw(), putUser(), aud]);
  const r = await run(setpw, pwReq()); assert.equal(r.status, 200);
  assert.deepEqual(calls.find((c) => c.method === "PUT").body, { password: "Aadmin123.com" });
  assert.ok(calls.findIndex((c) => c.method === "PATCH" && has(c.url, "otp_id=")) < calls.findIndex((c) => c.method === "PUT"), "the one-time claim comes before the change");
  assert.ok(has(calls.find((c) => c.method === "PATCH").url, "password_set_at=is.null"));
  assert.ok(!JSON.stringify(r.json).includes("Aadmin") && !JSON.stringify(calls.filter((c) => has(c.url, "audit_logs"))).includes("Aadmin"));
});
test("set password: refused without a recent unused verification (403), or when the claim is lost (409); a failed change releases the claim", async () => {
  env(LIVE); let calls = install([meRoute, rl(), unused([]), claimPw(), putUser(), aud]); assert.equal((await run(setpw, pwReq())).status, 403); assert.ok(!calls.some((c) => c.method === "PUT"));
  calls = install([meRoute, rl(), unused(), claimPw([]), putUser(), aud]); assert.equal((await run(setpw, pwReq())).status, 409); assert.ok(!calls.some((c) => c.method === "PUT"));
  const since = calls.find((c) => has(c.url, "verified_at=gte")); assert.ok(since && has(since.url, "status=eq.verified"));
  calls = install([meRoute, rl(), unused(), claimPw(), putUser(false), aud]); assert.equal((await run(setpw, pwReq())).status, 502);
  assert.ok(calls.some((c) => c.method === "PATCH" && c.body && c.body.password_set_at === null), "claim released so they can retry");
  install([[(u) => has(u, "/auth/v1/user"), reply(401, {})], rl(), unused(), claimPw(), putUser()]); assert.equal((await run(setpw, pwReq())).status, 401);
  install([meRoute, rl(false), unused(), claimPw(), putUser()]); assert.equal((await run(setpw, pwReq())).status, 429);
});
test("set password UI: phone accounts use the server route for sign-up AND reset; native updateUser only when phone auth is off", () => {
  const a = require("node:fs").readFileSync(require.resolve("../js/auth.js"), "utf8");
  assert.ok(/async function savePassword/.test(a) && a.includes("/api/auth/phone/password") && /if \(!phoneApi\) return sb\.auth\.updateUser\(\{ password \}\)/.test(a));
  assert.equal((a.match(/sb\.auth\.updateUser\(\{ password/g) || []).length, 1, "only the fallback inside savePassword");
});

test("phone-auth dispatcher: one function serves start/verify/login/password; unknown ops 404; inherited keys are not handlers", async () => {
  const d = require("../api/auth/phone/[op]");
  env(); install([[() => true, reply(200, {})]]);
  assert.equal((await run(d, { method: "GET", query: { op: "start" } })).json.enabled, false);        // reaches start.js
  assert.equal((await run(d, { method: "POST", query: { op: "verify" }, body: {} })).status, 503);     // phone auth is off -> verify.js answers
  for (const op of ["nope", "constructor", "__proto__", "toString", undefined, ""]) assert.equal((await run(d, { method: "POST", query: { op }, body: {} })).status, 404, String(op));
  const fs = require("node:fs"); const fns = []; (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = dir + "/" + e.name; if (e.isDirectory()) { if (!e.name.startsWith("_")) walk(p); } else if (p.endsWith(".js")) fns.push(p); } })(require("node:path").join(__dirname, "../api"));
  assert.ok(fns.length <= 12, `Vercel Hobby allows at most 12 functions, found ${fns.length}: ${fns.join(", ")}`);
});
