const test = require("node:test");
const assert = require("node:assert/strict");
const { install, reply, env } = require("./_mock");
const { generateOtp, verifyOtp } = require("../api/_lib/sasusync/otp");
const LIVE = { SASUSYNC_MODE: "live", SASUSYNC_SENDER_APPROVED: "true" };

test("OTP has no sandbox: sandbox mode or unapproved sender -> refused locally, ZERO network calls", async () => {
  for (const over of [{}, { SASUSYNC_MODE: "live" }, { SASUSYNC_SENDER_APPROVED: "true" }]) {
    env(over); const calls = install([[() => true, reply(200, { success: true, otp_id: 1 })]]);
    await assert.rejects(generateOtp({ to: "0552148347" }), (e) => e.kind === "LIVE_DISABLED");
    await assert.rejects(verifyOtp({ otpId: "1", code: "123456" }), (e) => e.kind === "LIVE_DISABLED");
    assert.equal(calls.length, 0);
  }
});
test("generate (mocked): posts documented fields, returns otp_id as string, never a code", async () => {
  env(LIVE); const calls = install([[() => true, reply(200, { success: true, otp_id: 4417, message: "OTP sent" })]]);
  const r = await generateOtp({ to: "+233552148347" });
  assert.deepEqual(r, { otpId: "4417" });
  const b = calls[0].body; assert.ok(calls[0].url.endsWith("/otp/generate")); assert.equal(b.number, "233552148347"); assert.ok(b.message.includes("%otp_code%")); assert.ok(b.message.length <= 160);
  assert.equal(b.expiry, 5); assert.equal(b.length, 6); assert.equal(b.medium, "sms");
});
test("verify: every documented reason is mapped; success ONLY when verified === true", async () => {
  env(LIVE);
  const cases = [[{ verified: true, reason: "verified" }, true, "verified"], [{ verified: false, reason: "wrong_code", attempts_remaining: 2 }, false, "wrong_code"], [{ verified: false, reason: "expired" }, false, "expired"],
    [{ verified: false, reason: "no_pending_code" }, false, "no_pending_code"], [{ verified: false, reason: "already_verified" }, false, "already_verified"],
    [{ success: true, reason: "verified" }, false, "verified"], [{ success: true, verified: "true", reason: "verified" }, false, "verified"], [{ verified: false, reason: "weird" }, false, "wrong_code"]];
  for (const [body, ok, reason] of cases) {
    install([[() => true, reply(200, body)]]);
    const r = await verifyOtp({ otpId: "4417", code: "123456" });
    assert.equal(r.verified, ok, JSON.stringify(body));
    if (!ok || body.verified === true) assert.equal(r.reason, ok ? "verified" : r.reason);
    if (body.reason === "wrong_code") assert.equal(r.attemptsRemaining, 2);
  }
});
test("wrong code is a 200 answer, not an exception; malformed code rejected locally without a call", async () => {
  env(LIVE); let calls = install([[() => true, reply(200, { verified: false, reason: "wrong_code" })]]);
  assert.equal((await verifyOtp({ otpId: "1", code: "000000" })).verified, false); assert.equal(calls.length, 1);
  calls = install([[() => true, reply(200, { verified: true })]]);
  assert.equal((await verifyOtp({ otpId: "1", code: "12ab" })).verified, false); assert.equal(calls.length, 0);
});
test("429 on generate surfaces RATE_LIMITED, is not retried and never auto-generates another code", async () => {
  env(LIVE); const calls = install([[() => true, reply(429, { detail: "pending code" })]]);
  await assert.rejects(generateOtp({ to: "0552148347" }), (e) => e.kind === "RATE_LIMITED");
  assert.equal(calls.length, 1);
});
test("generate network failure is never resent", async () => {
  env(LIVE); const calls = install([[() => true, new Error("ECONNRESET")]]);
  await assert.rejects(generateOtp({ to: "0552148347" }), (e) => e.kind === "NETWORK"); assert.equal(calls.length, 1);
});
test("OTP code is never present in errors or thrown details", async () => {
  env(LIVE); install([[() => true, reply(500, { detail: "x" })]]);
  try { await verifyOtp({ otpId: "1", code: "918273" }); assert.fail(); } catch (e) { assert.ok(!JSON.stringify({ m: e.message, d: e.detail, s: e.stack }).includes("918273")); }
});
