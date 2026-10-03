const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(f, "utf8");
const sql = read("supabase/phase8_escrow.sql");

test("escrow SQL: every money function is locked down and idempotent", () => {
  for (const fn of ["_escrow_split", "_escrow_release", "_escrow_refund", "escrow_auto_release"]) assert.match(sql, new RegExp(`revoke all on function[^;]*public\\.${fn}\\(`), `${fn} revoked from clients`);
  for (const fn of ["hire_worker", "engagement_submit", "engagement_approve", "engagement_dispute", "engagement_cancel", "admin_resolve_engagement"]) {
    assert.match(sql, new RegExp(`grant execute on function[^;]*public\\.${fn}\\(`), `${fn} callable by members`);
    assert.match(sql, new RegExp(`function public\\.${fn}\\([^)]*\\)[^$]*security definer`), `${fn} is security definer`);
  }
  assert.match(sql, /revoke insert, update, delete on public\.job_engagements from anon, authenticated/);
  assert.match(sql, /idempotency_key[^;]*'job-hire:'/);
  assert.match(sql, /for update/, "rows are locked while money moves");
  assert.match(sql, /escrow-auto-release/);
});

test("escrow SQL: only the job owner hires, only the payer approves, only admins resolve", () => {
  assert.match(sql, /only the job owner can hire/);
  assert.match(sql, /g\.payer_id is distinct from me/);
  assert.match(sql, /not public\.is_active_admin\(\)/);
});

test("escrow UI is wired: script, styles, routes and no glass", () => {
  const html = read("index.html"), common = read("js/common.js"), css = read("css/escrow.css");
  assert.match(html, /js\/escrow\.js/); assert.match(html, /css\/escrow\.css/);
  assert.ok(html.indexOf("js/escrow.js") > html.indexOf("js/market.js"), "loads after market.js");
  assert.match(common, /worker: \[[^\]]*"engagement"/); assert.match(common, /company: \[[^\]]*"applicants"[^\]]*"engagement"/);
  assert.match(common, /"individual-employer": \[[^\]]*"applicants"[^\]]*"engagement"/);
  assert.doesNotMatch(css, /backdrop-filter/);
  new Function(read("js/escrow.js"));
});
