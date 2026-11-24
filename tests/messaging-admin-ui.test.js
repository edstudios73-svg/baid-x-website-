// Static checks on the admin console's messaging controls (no browser, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const src = fs.readFileSync(require.resolve("../js/admin.js"), "utf8");
const block = src.slice(src.indexOf('q("[data-sms-live]")'), src.indexOf('q("[data-mkplans]")'));

test("admin UI: live tests exist for SMS, WhatsApp and email, only for super admins while live, labelled LIVE", () => {
  assert.ok(src.includes('data-sms-live="sms"') && src.includes('data-sms-live="whatsapp"') && src.includes('data-sms-live="email"'));
  assert.ok(/isSuper\(\) \? `<div style="margin-top:12px">\$\{j\.live \?/.test(src));
  assert.ok(src.includes("LIVE — sends one real message"));
  assert.ok(!src.includes("data-sms-sandbox") && !src.includes("sandbox_test"), "no sandbox: Zend has none");
});
test("admin UI: two confirmations (recipient, then typed SEND ONE LIVE TEST) before any request", () => {
  const live = block.slice(0, block.indexOf('q("[data-sms-lookup]")'));
  assert.ok(live.indexOf("await ask(") > -1 && live.indexOf("await ask(") < live.indexOf("smsCall("));
  assert.ok(/if \(!a\) return;/.test(live) && /if \(!typed\) return;/.test(live) && live.includes('"SEND ONE LIVE TEST"'));
});
test("admin UI: every messaging call goes to /api/messaging-admin with the staff token; the browser never names a Zend endpoint", () => {
  assert.ok(src.includes('fetch("/api/messaging-admin"') && !src.includes("/api/sasusync-admin"));
  assert.ok(!/tryzend|zend\.test|\/messages\/bulk|\/otp\/send|\/email\/send|api\/v1\/send|smssandbox/.test(src));
  assert.ok(!/ZEND_API_KEY|x-api-key/i.test(src));
});
test("admin UI: results show Zend's outcome and id, never the entered number or email", () => {
  assert.ok(block.includes("error_category") && block.includes("message_id"));
  assert.ok(!/innerHTML[^;]*a\.value/.test(block), "the entered recipient is only sent, never rendered");
});

const auth = fs.readFileSync(require.resolve("../js/auth.js"), "utf8"), html = fs.readFileSync(require.resolve("../auth.html"), "utf8");
test("signup UI: password needs 8+ chars with a small letter, a capital, a number and a symbol; Create account saves the password, then the profile", () => {
  assert.ok(/len: \(p\) => p\.length >= 8/.test(auth) && /sym:/.test(auth) && html.includes('data-r="sym"'));
  assert.ok(/finishProfile\(label, \$\("#pass"\)\.value\)/.test(auth));
  assert.ok(/const pw = password \? await savePassword\(password\)/.test(auth), "a refused password stops before the profile is made");
  assert.ok(!/getUser\(\)/.test(auth.slice(auth.indexOf("async function finishProfile"), auth.indexOf("/* ---------- sign in"))), "no network getUser in the create step");
});

test("admin broadcast UI: SMS, WhatsApp or email (one at a time) previews first, needs typed SEND, sends a request id + expected count, then records the in-app broadcast", () => {
  const f = src.slice(src.indexOf('if (f.id === "bf")'), src.indexOf('if (f.id === "setf")'));
  assert.ok(src.includes('data-ch="whatsapp" data-out="1"') && src.includes('data-ch="email" data-out="1"') && src.includes('data-ch="sms" data-out="1"'));
  assert.ok(src.includes('document.querySelectorAll("[data-out].on").forEach((b) => b.classList.remove("on"))'), "only one outside channel at a time");
  assert.ok(f.indexOf("dry_run: true") > -1 && f.indexOf("dry_run: true") < f.indexOf('confirm: "SEND BROADCAST"'));
  assert.ok(/toUpperCase\(\) !== "SEND"/.test(f) && f.includes("request_id: rq") && f.includes("expected_recipients: p.recipients"));
  assert.ok(f.indexOf('confirm: "SEND BROADCAST"') < f.indexOf('rpc("admin_broadcast"'));
  assert.ok(f.includes("440") && f.includes("within_limit") && f.includes("channel_ready") && f.includes('p.mode !== "live"'));
  assert.ok(f.includes("subject: d.title"), "the title is the email subject");
});

test("admin UI: Scheduled and Automations tabs, schedule-for-later flow with confirmation, template chips and live preview", () => {
  assert.ok(src.includes('["scheduled", "Scheduled"]') && src.includes('["automations", "Automations", 1]'));
  const f = src.slice(src.indexOf('if (f.id === "bf")'), src.indexOf('if (f.id === "setf")'));
  assert.ok(f.indexOf("dry_run: true") < f.indexOf('action: "sms_schedule"') && /confirm: outCh \? "SCHEDULE BROADCAST"/.test(f) && /toUpperCase\(\) !== "SEND"/.test(f));
  assert.ok(src.includes('data-ph="{first_name}"') && src.includes("data-auto-prev") && src.includes('action: "sms_automation_save"') && src.includes('action: "sms_automations_master"') && src.includes('action: "sms_job_cancel"'));
  assert.ok(src.includes("data-painted"), "the preview repaint is guarded against an observer loop");
  assert.ok(!/api\/v1\/send|smssandbox|tryzend/.test(src));
});
