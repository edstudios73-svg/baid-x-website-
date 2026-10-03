const test = require("node:test");
const assert = require("node:assert/strict");
const { install, reply, env } = require("./_mock");
const { sendSms } = require("../api/_lib/sasusync/sms");
const { request } = require("../api/_lib/sasusync/client");
const { normalizeGhanaPhone } = require("../api/_lib/sasusync/phone");
const noSleep = { sleepImpl: async () => {} };
const OK = { success: true, balance: { deducted: 2, remaining: 1357 }, data: { recipients_count: 1, status: "queued", job_id: "6f461b5a" } };

test("sandbox is the default: only /smssandbox/v1/send is called, never /api/v1/send", async () => {
  env(); const calls = install([[() => true, reply(200, OK)]]);
  const r = await sendSms({ to: "0552148347", message: "Hi" }, noSleep);
  assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith("/smssandbox/v1/send")); assert.equal(r.mode, "sandbox");
  assert.deepEqual(calls[0].body.recipients, ["233552148347"]); assert.equal(calls[0].body.sender, "BAID X");
  assert.equal(calls[0].headers["X-API-Key"], "ss_FAKE_KEY_FOR_TESTS");
});
test("live requested but sender not approved: refused, no call, NO fallback to sandbox", async () => {
  env({ SASUSYNC_MODE: "live" }); const calls = install([[() => true, reply(200, OK)]]);
  await assert.rejects(sendSms({ to: "0552148347", message: "Hi" }), (e) => e.kind === "LIVE_DISABLED");
  assert.equal(calls.length, 0);
});
test("live + approved: uses /api/v1/send", async () => {
  env({ SASUSYNC_MODE: "live", SASUSYNC_SENDER_APPROVED: "true" }); const calls = install([[() => true, reply(200, OK)]]);
  const r = await sendSms({ to: "233552148347", message: "Hi" }, noSleep);
  assert.ok(calls[0].url.endsWith("/api/v1/send")); assert.equal(r.mode, "live");
});
test("deducted/remaining come from the provider (no hard-coded pricing); job_id is a string", async () => {
  env(); install([[() => true, reply(200, { success: true, balance: { deducted: 3, remaining: 10 }, data: { job_id: 1841, status: "queued" } })]]);
  const r = await sendSms({ to: "0552148347", message: "x".repeat(200) }, noSleep);
  assert.equal(r.deducted, 3); assert.equal(r.jobId, "1841"); assert.equal(typeof r.jobId, "string");
});
test("queued:true is accepted, not an error, and is never resent", async () => {
  env(); const calls = install([[() => true, reply(200, { success: true, queued: true, data: { job_id: 1841, status: "queued", recipients_count: 1 } })]]);
  const r = await sendSms({ to: "0552148347", message: "Hi" }, noSleep);
  assert.equal(r.queued, true); assert.equal(r.accepted, true); assert.equal(calls.length, 1);
});
test("no retry on 400/401/402/403/422 (one call each) and typed errors", async () => {
  const want = { 400: "BAD_REQUEST", 401: "AUTH", 402: "INSUFFICIENT_CREDIT", 403: "FORBIDDEN", 422: "VALIDATION" };
  for (const [s, kind] of Object.entries(want)) {
    env(); const calls = install([[() => true, reply(Number(s), { detail: "nope" })]]);
    await assert.rejects(sendSms({ to: "0552148347", message: "Hi" }, noSleep), (e) => e.kind === kind && e.status === Number(s));
    assert.equal(calls.length, 1, s);
  }
});
test("retries 503 then succeeds; gives up after bounded attempts on persistent 500", async () => {
  env(); let n = 0; let calls = install([[() => true, () => (++n < 3 ? reply(503, { detail: "busy" }) : reply(200, OK))]]);
  assert.equal((await sendSms({ to: "0552148347", message: "Hi" }, noSleep)).accepted, true); assert.equal(calls.length, 3);
  calls = install([[() => true, reply(500, { detail: "boom" })]]);
  await assert.rejects(sendSms({ to: "0552148347", message: "Hi" }, noSleep), (e) => e.kind === "SERVER"); assert.equal(calls.length, 3);
});
test("429 backs off (Retry-After honoured) then retries", async () => {
  env(); let n = 0; const waits = []; install([[() => true, () => (++n < 2 ? reply(429, { detail: "slow" }, { "retry-after": "2" }) : reply(200, OK))]]);
  await sendSms({ to: "0552148347", message: "Hi" }, { sleepImpl: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [2000]);
});
test("LIVE send timeout/network error is NEVER resent", async () => {
  env({ SASUSYNC_MODE: "live", SASUSYNC_SENDER_APPROVED: "true" });
  for (const err of [Object.assign(new Error("aborted"), { name: "AbortError" }), new Error("ECONNRESET")]) {
    const calls = install([[() => true, err]]);
    await assert.rejects(sendSms({ to: "0552148347", message: "Hi" }, noSleep), (e) => e.kind === "TIMEOUT" || e.kind === "NETWORK");
    assert.equal(calls.length, 1);
  }
});
test("invalid phone/message rejected locally with no network call", async () => {
  env(); const calls = install([[() => true, reply(200, OK)]]);
  await assert.rejects(sendSms({ to: "12345", message: "Hi" }), (e) => e.kind === "BAD_PHONE");
  await assert.rejects(sendSms({ to: "0552148347", message: "x".repeat(651) }), (e) => e.kind === "BAD_MESSAGE");
  assert.equal(calls.length, 0);
});
test("errors never contain the API key, request body or phone number", async () => {
  env(); install([[() => true, reply(401, { detail: "Invalid key" })]]);
  try { await sendSms({ to: "0552148347", message: "secret body" }, noSleep); assert.fail(); }
  catch (e) { const s = JSON.stringify({ m: e.message, d: e.detail, k: e.kind, st: e.stack }); assert.ok(!s.includes("FAKE_KEY") && !s.includes("233552148347") && !s.includes("secret body")); }
});
test("phone normalization: 233…, +233…, 0… accepted; junk rejected", () => {
  for (const v of ["233552148347", "+233552148347", "0552148347", "055 214 8347", "+233-55-214-8347"]) assert.equal(normalizeGhanaPhone(v), "233552148347", v);
  for (const v of ["", null, undefined, 552148347, "055214834", "2335521483471", "+447700900123", "0152148347", "abc", "233 55 21 48 34 7 9"]) assert.equal(normalizeGhanaPhone(v), null, String(v));
});
test("client never logs", async () => {
  env(); const orig = console.log; let logged = false; console.log = () => { logged = true; }; console.error = () => { logged = true; };
  install([[() => true, reply(200, OK)]]); await request("/api/v1/balance"); console.log = orig; assert.equal(logged, false);
});
