const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(f, "utf8");

test("messages are solid and readable: typed toasts with their own colours, loaded on app and auth pages", () => {
  const css = read("css/toast.css"), c = read("js/common.js");
  for (const k of ["t-err", "t-ok", "t-warn", "t-info"]) assert.match(css, new RegExp(`\\.toast\\.${k}`));
  assert.doesNotMatch(css, /rgba\(20,\s*22,\s*26/); assert.match(c, /function toast\(msg, kind\)/);
  for (const f of ["index.html", "auth.html"]) assert.match(read(f), /css\/toast\.css/);
});

test("billing: removed copy is gone and Paystack opens via a status screen, then confirms on return", () => {
  const b = read("js/billing.js");
  for (const t of ["paid separately from your plan", "does not guarantee approval", "never part of a plan", "does not verify your account"]) assert.ok(!b.includes(t), t);
  assert.match(b, /Opening Paystack/); assert.match(b, /Confirming your payment/); assert.match(b, /location\.href = j\.authorization_url/);
  assert.match(b, /status === 401/, "a dead session is explained, not silently ignored");
  assert.match(b, /data-bact="cat"/);
});

test("switch account: cards, loading screen, and expired accounts go to sign-in prefilled", () => {
  const f = read("js/features.js"), a = read("js/auth.js");
  assert.match(f, /data-acc-go/); assert.match(f, /Switching to/); assert.match(f, /auth\.html\?mode=signin&acc=/);
  assert.match(a, /params\.get\("acc"\)/);
});

test("a password change hands back a fresh session (the old one is revoked by Supabase)", () => {
  assert.match(read("api/_lib/phoneauth/password.js"), /passwordGrant\(email, password\)/);
  assert.match(read("js/auth.js"), /setSession\(\{ access_token: j\.session\.access_token/);
});
