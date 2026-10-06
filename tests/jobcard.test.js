const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(f, "utf8");
const sql = read("supabase/phase14_job_cards.sql");

test("job card SQL: RLS on, tables read-only, every write is a guarded function", () => {
  for (const t of ["job_card_items", "job_card_materials", "job_card_photos", "job_card_signoffs"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`create policy ${t}_select on public\\.${t} for select to authenticated using \\(public\\.job_card_party\\(engagement_id\\) is not null`));
  }
  assert.match(sql, /revoke insert, update, delete on public\.job_card_items, public\.job_card_materials, public\.job_card_photos, public\.job_card_signoffs from anon, authenticated/);
  for (const fn of ["job_card_item_add", "job_card_item_progress", "job_card_item_remove", "job_card_material_add", "job_card_material_used", "job_card_material_remove", "job_card_photo_add", "job_card_photo_remove", "job_card_sign"]) {
    assert.match(sql, new RegExp(`function public\\.${fn}\\(`));
    assert.match(sql, new RegExp(`grant execute on function [^;]*public\\.${fn}\\(`));
  }
  assert.doesNotMatch(sql, /grant [^;]* to anon/);
});

test("job card SQL: nothing is deleted, photos are kept as evidence", () => {
  assert.doesNotMatch(sql, /\bdelete from\b/i);
  assert.match(sql, /set removed_at = now\(\)/);
  assert.match(sql, /create policy job_cards_keep on storage\.objects as restrictive for delete/);
  assert.match(sql, /'job-cards', 'job-cards', false/, "the photo bucket is private");
  assert.match(sql, /not exists \(select 1 from storage\.objects where bucket_id = 'job-cards' and name = p_path\)/, "a photo must really be uploaded");
});

test("job card SQL: only the worker or PM records progress; sign-off by all releases escrow", () => {
  assert.match(sql, /if me not in \('worker','pm'\) then raise exception 'only the worker or the PM can record progress'/);
  assert.match(sql, /if me not in \('worker','pm'\) then raise exception 'only the worker or the PM can log materials used'/);
  assert.match(sql, /the worker has signed off, so the card is locked/);
  assert.match(sql, /if me = 'worker' and g\.status = 'active' then[\s\S]*auto_release_at = now\(\) \+ interval '3 days'/);
  assert.match(sql, /\(not need_pm or exists \(select 1 from job_card_signoffs where engagement_id = p_eng and party = 'pm'\)\) then\s+r := public\._escrow_release/);
});

test("job card UI: replaces the engagement page, wired for worker, client and PM", () => {
  const html = read("index.html"), common = read("js/common.js"), esc = read("js/escrow.js"), jc = read("js/jobcard.js"), proj = read("js/projects.js"), css = read("css/escrow.css");
  assert.ok(html.indexOf("js/jobcard.js") > html.indexOf("js/escrow.js"), "loads after escrow.js");
  assert.match(jc, /window\.DASH\.register\("engagement", view\)/);
  assert.doesNotMatch(esc, /register\("engagement"/, "only one engagement view");
  assert.match(common, /"project-manager": \[[^\]]*"engagement"/);
  assert.match(proj, /window\.JOBCARD\.projectRows/);
  for (const k of ["Scope", "Materials", "Evidence", "Payments", "Completion"]) assert.match(jc, new RegExp(`<h4>${k}</h4>`));
  assert.match(jc, /JOB #BX-/);
  assert.match(jc, /from\("job-cards"\)\.upload/);
  assert.doesNotMatch(jc + css, /[\u{1F300}-\u{1FAFF}]/u, "no emoji");
  assert.doesNotMatch(css, /backdrop-filter/);
  new Function(jc); new Function(esc);
});

test("my build: client-only, read-only table, built from job cards; wired on web", () => {
  const sql = read("supabase/phase15_my_build.sql"), b = read("js/build.js"), html = read("index.html"), common = read("js/common.js"), dash = read("js/dash.js");
  assert.match(sql, /alter table public\.client_builds enable row level security/);
  assert.match(sql, /revoke insert, update, delete on public\.client_builds from anon, authenticated/);
  assert.match(sql, /my build is for client accounts/);
  assert.match(sql, /where g\.payer_id = auth\.uid\(\) and g\.payer_role = 'individual_employer'/, "only the caller's own hires");
  assert.match(sql, /worker_signed and not client_signed/, "waiting = cards the worker signed and the client has not");
  assert.ok(html.indexOf("js/build.js") > html.indexOf("js/jobcard.js"));
  assert.match(b, /window\.DASH\.register\("build", view\)/);
  assert.match(common, /"individual-employer": \[[^\]]*"build"/); assert.match(common, /\["build", "My build", "site"\]/);
  assert.match(dash, /window\.BUILD\.homeCard\(c\)/);
  for (const t of ["Held in escrow", "Waiting for you", "Finish date", "Jobs in this build"]) assert.match(b, new RegExp(t));
  new Function(b);
});
