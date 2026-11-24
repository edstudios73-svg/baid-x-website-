// The Zend client layer (api/_lib/messaging). No real network: every fetch is scripted.
const test = require("node:test");
const assert = require("node:assert/strict");
const { install, reply, env } = require("./_mock");
const { sendMessage, sendBulk, smsParts } = require("../api/_lib/messaging/messages");
const { sendEmail, validEmail } = require("../api/_lib/messaging/email");
const { generateOtp, verifyOtp } = require("../api/_lib/messaging/otp");
const { MessagingError, kindFor } = require("../api/_lib/messaging/errors");
const LIVE = { MESSAGING_LIVE: "true" };
const posts = (calls) => calls.filter((c) => c.method === "POST");

test("nothing is ever sent while MESSAGING_LIVE is off or the key is missing: refused locally, ZERO network calls", async () => {
  for (const over of [{}, { MESSAGING_LIVE: "false" }, { MESSAGING_LIVE: "true", ZEND_API_KEY: "" }]) {
    env(over); const calls = install([[() => true, reply(200, { id: "x" })]]);
    await assert.rejects(sendMessage({ to: "0552148347", message: "hi" }), (e) => ["LIVE_DISABLED", "NOT_CONFIGURED"].includes(e.kind));
    await assert.rejects(sendBulk({ recipients: ["0552148347"], message: "hi" }), (e) => ["LIVE_DISABLED", "NOT_CONFIGURED"].includes(e.kind));
    await assert.rejects(generateOtp({ to: "0552148347" }), (e) => ["LIVE_DISABLED", "NOT_CONFIGURED"].includes(e.kind));
    await assert.rejects(verifyOtp({ otpId: "1", code: "123456" }), (e) => ["LIVE_DISABLED", "NOT_CONFIGURED"].includes(e.kind));
    await assert.rejects(sendEmail({ to: "a@x.com", subject: "Hello", text: "Hello there" }), (e) => ["LIVE_DISABLED", "NOT_CONFIGURED"].includes(e.kind));
    assert.equal(calls.length, 0);
  }
});
test("sendMessage: documented fields, E.164 number, API key only in x-api-key, Zend's id returned as a string", async () => {
  env({ ...LIVE, ZEND_SENDER_ID: "BAIDX" }); const calls = install([[() => true, reply(200, { id: 123, status: "pending", estimated_cost: 0.035 })]]);
  const r = await sendMessage({ to: "055 214 8347", message: "Hello" });
  assert.equal(r.jobId, "123"); assert.equal(r.queued, true); assert.deepEqual(r.channels, ["sms"]);
  assert.ok(calls[0].url.endsWith("/messages")); assert.deepEqual(calls[0].body, { to: "+233552148347", body: "Hello", preferred_channels: ["sms"], sender_id: "BAIDX" });
  assert.equal(calls[0].headers["x-api-key"], "zk_FAKE_KEY_FOR_TESTS"); assert.ok(!JSON.stringify(calls[0].body).includes("FAKE_KEY"));
});
test("WhatsApp is used only with an approved template, always before SMS; without one it stays SMS", async () => {
  env(LIVE); let calls = install([[() => true, reply(200, { id: "m" })]]);
  await sendMessage({ to: "0552148347", message: "Hi", whatsapp: { kind: "announce", params: { message: "Hi" } } });
  assert.deepEqual(calls[0].body.preferred_channels, ["sms"]); assert.equal(calls[0].body.template_id, undefined);
  env({ ...LIVE, ZEND_WA_TEMPLATE_ANNOUNCE: "tmpl_a" }); calls = install([[() => true, reply(200, { id: "m" })]]);
  await sendMessage({ to: "0552148347", message: "Hi", whatsapp: { kind: "announce", params: { message: "Hi" } } });
  assert.deepEqual(calls[0].body.preferred_channels, ["whatsapp", "sms"]); assert.equal(calls[0].body.template_id, "tmpl_a"); assert.deepEqual(calls[0].body.template_params, { message: "Hi" });
});
test("a send is attempted ONCE: 5xx, 429, timeout or dropped connection are never resent", async () => {
  for (const rsp of [reply(500, { message: "x" }), reply(503, {}), reply(429, { message: "Rate limit exceeded" }), new Error("ECONNRESET")]) {
    env(LIVE); const calls = install([[() => true, rsp]]);
    await assert.rejects(sendMessage({ to: "0552148347", message: "hi" }));
    assert.equal(calls.length, 1);
  }
});
test("bad numbers and messages are refused locally; one bad number blocks the whole bulk send before Zend is called", async () => {
  env(LIVE); const calls = install([[() => true, reply(200, { id: "b" })]]);
  await assert.rejects(sendMessage({ to: "12345", message: "hi" }), (e) => e.kind === "BAD_PHONE");
  await assert.rejects(sendMessage({ to: "0552148347", message: "" }), (e) => e.kind === "BAD_MESSAGE");
  await assert.rejects(sendMessage({ to: "0552148347", message: "x".repeat(1601) }), (e) => e.kind === "BAD_MESSAGE");
  await assert.rejects(sendBulk({ recipients: ["0552148347", "999"], message: "hi" }), (e) => e.kind === "BAD_PHONE");
  assert.equal(calls.length, 0);
});
test("Zend's 400 wording is sorted into kinds; numbers and emails are blanked from error details", () => {
  assert.equal(kindFor(400, "Insufficient credits. Required: 0.020, Available: 0.015"), "INSUFFICIENT_CREDIT");
  assert.equal(kindFor(400, "Number not on WhatsApp"), "NOT_ON_WHATSAPP");
  assert.equal(kindFor(400, "Sender ID not approved"), "SENDER_NOT_APPROVED");
  assert.equal(kindFor(400, "Template not approved"), "TEMPLATE");
  assert.equal(kindFor(400, "Invalid phone number"), "BAD_PHONE");
  assert.equal(kindFor(401, ""), "AUTH"); assert.equal(kindFor(429, ""), "RATE_LIMITED"); assert.equal(kindFor(502, ""), "SERVER");
  const e = new MessagingError("BAD_PHONE", 400, "Invalid phone numbers found: +233552148347, 0241234567; contact a.b@x.com");
  assert.ok(!e.detail.includes("552148347") && !e.detail.includes("0241234567") && !e.detail.includes("a.b@x.com"));
  assert.ok(new MessagingError("INSUFFICIENT_CREDIT", 400, "Required: 0.020, Available: 0.015").detail.includes("0.015"), "money amounts stay readable");
});
test("email: needs a sender on a verified domain; refuses phone-login placeholders; sends html + text with the opt-out footer", async () => {
  env(LIVE); let calls = install([[() => true, reply(200, { _id: "e1" })]]);
  await assert.rejects(sendEmail({ to: "a@x.com", subject: "Hello", text: "Hello there" }), (e) => e.kind === "EMAIL_NOT_SET_UP");
  env({ ...LIVE, ZEND_EMAIL_FROM: "BAID X <hello@baid-x.com>" }); calls = install([[() => true, reply(200, { _id: "e1", status: "pending" })]]);
  await assert.rejects(sendEmail({ to: "p233552148347@phone.baidx.invalid", subject: "Hello", text: "Hello there" }), (e) => e.kind === "BAD_EMAIL");
  const r = await sendEmail({ to: "a@x.com", subject: "  New   jobs ", text: "Line one\n\n<b>Line two</b>" });
  assert.equal(r.id, "e1"); assert.equal(calls.length, 1); const b = calls[0].body;
  assert.ok(calls[0].url.endsWith("/email/send")); assert.equal(b.from, "BAID X <hello@baid-x.com>"); assert.equal(b.subject, "New jobs");
  assert.ok(b.html.includes("&lt;b&gt;Line two&lt;/b&gt;") && !b.html.includes("<b>Line two"), "message text is escaped");
  assert.ok(b.text.includes("turn off Announcements")); assert.equal(validEmail("a@b"), false); assert.equal(validEmail("x@y.co"), true);
});
test("OTP: send uses Zend's fields (no code ever leaves BAID X); WhatsApp channel by setting; verify maps answers to reasons", async () => {
  env(LIVE); let calls = install([[() => true, reply(200, { id: "otp_1", status: "sent" })]]);
  assert.deepEqual(await generateOtp({ to: "0552148347" }), { otpId: "otp_1" });
  assert.deepEqual(calls[0].body, { phone_number: "+233552148347", app: "BAID X", channel: "sms", expiry: 5, length: 6 });
  env({ ...LIVE, ZEND_OTP_CHANNEL: "whatsapp" }); calls = install([[() => true, reply(200, { id: "otp_2" })]]);
  await generateOtp({ to: "0552148347" }); assert.equal(calls[0].body.channel, "whatsapp");
  env(LIVE);
  const cases = [[reply(200, { success: true, attempts_remaining: 2 }), true, "verified"], [reply(400, { success: false, message: "Invalid OTP code", attempts_remaining: 1 }), false, "wrong_code"],
    [reply(400, { success: false, message: "Invalid OTP code", attempts_remaining: 0 }), false, "expired"], [reply(400, { success: false, message: "OTP has expired" }), false, "expired"],
    [reply(404, { message: "Not found" }), false, "no_pending_code"], [reply(200, { success: "true" }), false, "wrong_code"]];
  for (const [rsp, ok, reason] of cases) {
    calls = install([[() => true, rsp]]); const v = await verifyOtp({ otpId: "otp_1", code: "123456" });
    assert.equal(v.verified, ok); assert.equal(v.reason, reason); assert.ok(calls[0].url.endsWith("/otp/otp_1/verify")); assert.deepEqual(calls[0].body, { code: "123456" });
  }
  calls = install([[() => true, reply(200, { success: true })]]);
  assert.equal((await verifyOtp({ otpId: "otp_1", code: "12ab" })).verified, false); assert.equal((await verifyOtp({ otpId: "../x", code: "123456" })).verified, false); assert.equal(calls.length, 0);
  calls = install([[() => true, reply(500, { message: "x" })]]); await assert.rejects(verifyOtp({ otpId: "otp_1", code: "123456" }), (e) => e.kind === "SERVER" && !JSON.stringify(e).includes("123456"));
});
test("SMS parts: GSM text is 160/153 per part, anything else 70/67", () => {
  assert.equal(smsParts("a".repeat(160)), 1); assert.equal(smsParts("a".repeat(161)), 2); assert.equal(smsParts("é".repeat(70)), 1); assert.equal(smsParts("“".repeat(71)), 2); assert.equal(smsParts(""), 0);
});
