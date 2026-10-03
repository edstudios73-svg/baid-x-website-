const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(f, "utf8");
const sql = read("supabase/phase10_milestones.sql");

test("milestones SQL: only the project owner creates/funds/approves, money functions are locked down", () => {
  assert.match(sql, /only the project owner can add milestones/);
  assert.match(sql, /m\.owner_id is distinct from me/); assert.match(sql, /m\.payee_id is distinct from auth\.uid\(\)/);
  assert.match(sql, /revoke all on function public\.milestones_auto_release\(\) from public, anon, authenticated/);
  for (const fn of ["milestone_create", "milestone_fund", "milestone_submit", "milestone_approve", "milestone_dispute", "milestone_cancel", "admin_resolve_milestone", "project_milestone_list"]) assert.match(sql, new RegExp(`grant execute on function[^;]*public\\.${fn}\\(`), fn);
  assert.match(sql, /revoke insert, update, delete on public\.project_milestones from anon, authenticated/);
  assert.match(sql, /'milestone:' \|\| m\.id::text/); assert.match(sql, /milestones-auto-release/); assert.match(sql, /not public\.is_active_admin\(\)/);
});

test("milestones UI is on the project workspace for owner, project manager and team", () => {
  const p = read("js/projects.js"), html = read("index.html");
  assert.equal((p.match(/\["milestones", "Milestones"\]/g) || []).length, 3);
  assert.match(p, /milestones: \(x\) => window\.MILESTONES\.tab\(x\)/);
  assert.ok(html.indexOf("js/milestones.js") > html.indexOf("js/projects.js"));
  new Function(read("js/milestones.js"));
});
