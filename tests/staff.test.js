// Run with: node --test tests/staff.test.js
const test = require("node:test"); const assert = require("node:assert"); const fs = require("fs");
process.env.SUPABASE_URL = "https://x.supabase.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "service_unit";
const staff = require("../api/admin-users.js");
const mkRes = () => { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => (r.headers[k] = v); r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
let calls; const stub = (routes) => { calls = []; global.fetch = async (url, opt = {}) => { calls.push({ url: String(url), method: opt.method, body: opt.body ? JSON.parse(opt.body) : null }); for (const [m, fn] of routes) if (String(url).includes(m)) { const out = fn(); return { ok: out.ok !== false, status: out.status || 200, text: async () => JSON.stringify(out.json), json: async () => out.json }; } return { ok: true, status: 200, text: async () => "null", json: async () => null }; }; };
const req = (body) => ({ method: "POST", headers: { authorization: "Bearer t" }, body: { action: "create_staff", name: "Ama Ops", email: "ama@baid-x.com", role: "ops", password: "BaidX-Ops-2026", ...body } });

test("create_staff: only when the database says the caller is a Super Admin", async () => {
  stub([["admin_can_add_staff", () => ({ ok: false, status: 400, json: { message: "Your staff role can't do this." } })]]);
  const res = mkRes(); await staff(req({}), res);
  assert.equal(res.code, 403); assert.ok(!calls.some((c) => c.url.includes("/auth/v1/admin/users")), "no login is created");
});
test("create_staff: validates input before asking anyone", async () => {
  stub([]);
  for (const [b, msg] of [[{ email: "nope" }, /valid email/], [{ role: "god" }, /Choose a role/], [{ password: "short" }, /10 characters/], [{ name: "" }, /name/]]) {
    const res = mkRes(); await staff(req(b), res); assert.equal(res.code, 400); assert.match(res.body.error, msg);
  }
  assert.equal(calls.length, 0);
});
test("create_staff: creates a confirmed login, then the staff row with the chosen role", async () => {
  stub([["admin_can_add_staff", () => ({ json: true })], ["/auth/v1/admin/users", () => ({ json: { id: "u-1" } })], ["/rest/v1/admin_users", () => ({ json: null })]]);
  const res = mkRes(); await staff(req({}), res);
  assert.equal(res.code, 200);
  const u = calls.find((c) => c.url.endsWith("/auth/v1/admin/users")).body; assert.equal(u.email_confirm, true); assert.equal(u.email, "ama@baid-x.com");
  const row = calls.find((c) => c.url.includes("/rest/v1/admin_users")).body; assert.equal(row.admin_role, "ops"); assert.equal(row.id, "u-1");
});
test("admin page: menus follow the role, sign-in asks for the code, first sign-in sets up two-step", () => {
  const a = fs.readFileSync(require.resolve("../js/admin.js"), "utf8");
  assert.match(a, /finance: "finance:VIEW"/); assert.match(a, /staff: "roles:VIEW"/); assert.match(a, /if \(!can\(p\)\)/);
  assert.match(a, /challengeAndVerify/); assert.match(a, /me\.mfa_required && !totp\.length/);
  const sql = fs.readFileSync(require.resolve("../supabase/phase23_staff_roles.sql"), "utf8");
  assert.match(sql, /'admin_finance', 'finance', 'VIEW'/); assert.match(sql, /Enter your authenticator code to continue/);
  assert.doesNotMatch(sql, /BaidX-/, "no passwords in the repo");
});
