// Static checks on the admin console's sandbox-test control (no browser, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const src = fs.readFileSync(require.resolve("../js/admin.js"), "utf8");
const block = src.slice(src.indexOf('q("[data-sms-sandbox]")'), src.indexOf('q("[data-mkplans]")'));

test("admin UI: Send Sandbox Test control exists, only in sandbox mode, super admin, labelled SANDBOX — NO DELIVERY", () => {
  assert.ok(src.includes("data-sms-sandbox") && src.includes("Send Sandbox Test"));
  assert.ok(/j\.mode === "sandbox" && isSuper\(\)/.test(src));
  assert.ok(src.includes("SANDBOX — NO DELIVERY"));
});
test("admin UI: requires a confirmation step before the request is made", () => {
  assert.ok(block.indexOf("await ask(") > -1 && block.indexOf("await ask(") < block.indexOf("fetch("));
  assert.ok(/if \(!a\) return;/.test(block));
});
test("admin UI: reuses /api/sasusync-admin sandbox_test with the explicit flag and the staff bearer token; no other endpoint", () => {
  assert.ok(block.includes('"/api/sasusync-admin"') && block.includes('action: "sandbox_test"') && block.includes("sandbox_test: true") && block.includes("Bearer"));
  assert.equal((block.match(/fetch\(/g) || []).length, 1);
  assert.ok(!/api\/v1\/send|otp\/generate|smssandbox|sms\.sasusync/.test(src), "the browser never names a provider endpoint");
});
test("admin UI: result shows provider outcome and charged state, never the number, message or secrets", () => {
  assert.ok(block.includes("charged") && block.includes("not delivered") && block.includes("error_category"));
  assert.ok(!/a\.value/.test(block.replace('to: a.value.trim()', "")), "the entered number is only sent, never rendered");
  assert.ok(!/innerHTML[^;]*a\.value/.test(block));
  assert.ok(!/message|api[_-]?key|secret/i.test(block.replace(/sandbox test message/gi, "").replace(/Nothing is delivered[^"]*/, "")));
});

const auth = fs.readFileSync(require.resolve("../js/auth.js"), "utf8"), html = fs.readFileSync(require.resolve("../auth.html"), "utf8");
test("signup UI: password needs 8+ chars, a letter, a number and a capital or symbol; Create account saves password + profile together", () => {
  assert.ok(/len: \(p\) => p\.length >= 8/.test(auth) && /mix:/.test(auth) && html.includes('data-r="mix"'));
  assert.ok(/finishProfile\(label, \$\("#pass"\)\.value\)/.test(auth));
  assert.ok(/Promise\.all\(\[password \? sb\.auth\.updateUser/.test(auth), "password update and profile insert run together");
  assert.ok(!/getUser\(\)/.test(auth.slice(auth.indexOf("async function finishProfile"), auth.indexOf("/* ---------- sign in"))), "no network getUser in the create step");
});

test("admin broadcast UI: SMS channel previews first, needs typed SEND, sends a request id + expected count, then records the in-app broadcast", () => {
  const f = src.slice(src.indexOf('if (f.id === "bf")'), src.indexOf('if (f.id === "setf")'));
  assert.ok(f.indexOf("dry_run: true") > -1 && f.indexOf("dry_run: true") < f.indexOf('confirm: "SEND SMS BROADCAST"'));
  assert.ok(/toUpperCase\(\) !== "SEND"/.test(f) && f.includes("request_id: rq") && f.includes("expected_recipients: p.recipients"));
  assert.ok(f.indexOf('confirm: "SEND SMS BROADCAST"') < f.indexOf('rpc("admin_broadcast"'));
  assert.ok(f.includes("440") && f.includes("enough_credit") && f.includes("within_limit"));
  assert.ok(!/api\/v1\/send|smssandbox/.test(src));
});

test("admin UI: Scheduled and Automations tabs, schedule-for-later flow with confirmation, template chips and live preview", () => {
  assert.ok(src.includes('["scheduled", "Scheduled"]') && src.includes('["automations", "Automations", 1]'));
  const f = src.slice(src.indexOf('if (f.id === "bf")'), src.indexOf('if (f.id === "setf")'));
  assert.ok(f.indexOf("dry_run: true") < f.indexOf('action: "sms_schedule"') && /confirm: sms \? "SCHEDULE SMS"/.test(f) && /toUpperCase\(\) !== "SEND"/.test(f));
  assert.ok(src.includes('data-ph="{first_name}"') && src.includes("data-auto-prev") && src.includes('action: "sms_automation_save"') && src.includes('action: "sms_automations_master"') && src.includes('action: "sms_job_cancel"'));
  assert.ok(src.includes("data-painted"), "the preview repaint is guarded against an observer loop");
  assert.ok(!/api\/v1\/send|smssandbox/.test(src));
});
