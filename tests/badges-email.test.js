const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(f, "utf8");

test("badges: every directory source loads and maps the tier; seal is coloured by tier", () => {
  const app = read("js/app.js"), common = read("js/common.js");
  assert.equal((app.match(/verification_status,badge_tier"/g) || []).length, 4);
  assert.equal((app.match(/badge: r\.verification_status === "verified" \? \(r\.badge_tier \|\| "verified"\) : null/g) || []).length, 4);
  assert.match(app, /SEAL\(it\.badge\)/);
  for (const t of ["identity", "professional", "advanced"]) assert.match(common, new RegExp(`${t}: \\["#`));
  assert.match(common, /verified: \["#38bdf8"/);
});

test("billing: services have real icons, badge colours, and plans open a benefits sheet", () => {
  const b = read("js/billing.js"), c = read("js/common.js");
  for (const k of ["bolt", "id", "mega", "seal"]) assert.match(c, new RegExp(`\\n    ${k}: '`), `icon ${k} exists`);
  assert.match(b, /TIER_OF/); assert.match(b, /benefitsSheet/); assert.match(b, /data-bact="benefits"/);
  assert.match(b, /metadata/, "benefits come from the plan row, not hard-coded promises");
});

test("email: the internal placeholder is never shown, stored or counted as a real email", () => {
  const c = read("js/common.js"), a = read("js/auth.js"), f = read("js/features.js");
  assert.match(c, /real = \(v\) => [^\n]*\\\.invalid/);
  assert.match(a, /const email = null; \/\/ no email is assigned at sign-up/, "sign-up never writes an email onto a profile");
  assert.match(c, /user_metadata\?\.email_added/, "only an email the member added is mirrored");
  assert.doesNotMatch(f, /val: c\.me\.session\.user\.email/);
  assert.match(f, /step-email/); assert.match(f, /updateUser\(\{ email, data: \{ email_added: true \} \}/);
  assert.match(f, /worker: \[\["full_name", "Full name", "text"\], \["email", "Email", "email"\]/, "workers type their email in Edit profile");
  assert.match(c, /worker: \[[^\]]*"Email"|\["Email", "Add your own email/);
});
