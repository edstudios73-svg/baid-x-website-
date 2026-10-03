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
