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

test("house logbook: client-only reminders, trusted team from paid jobs, daily notice; wired on web", () => {
  const sql = read("supabase/phase16_house_logbook.sql"), h = read("js/house.js"), html = read("index.html"), common = read("js/common.js"), dash = read("js/dash.js");
  assert.match(sql, /alter table public\.house_reminders enable row level security/);
  assert.match(sql, /revoke insert, update, delete on public\.house_reminders from anon, authenticated/);
  assert.match(sql, /the house logbook is for client accounts/);
  assert.match(sql, /choose someone from your trusted team/, "a reminder can only name someone the client has paid");
  assert.match(sql, /status = 'released'\)/);
  assert.doesNotMatch(sql, /\bdelete from\b/i);
  assert.match(sql, /cron\.schedule\('house-reminders'/);
  assert.match(sql, /h\.notified_on is null or h\.notified_on < h\.due_on/, "one notice per due date");
  assert.ok(html.indexOf("js/house.js") > html.indexOf("js/build.js"));
  assert.match(h, /window\.DASH\.register\("house", view\)/);
  assert.match(common, /"individual-employer": \[[^\]]*"house"/); assert.match(common, /\["house", "House logbook", "home"\]/);
  assert.match(dash, /window\.HOUSE\.homeCard\(c\)/);
  for (const t of ["Who did what", "Coming up", "My trusted team", "Add reminder"]) assert.match(h, new RegExp(t));
  new Function(h);
});

test("marketplace: every role browses photo listings; suppliers add up to 6 photos; ordering stays with buyers", () => {
  const cat = read("js/catalog.js"), mk = read("js/market.js"), common = read("js/common.js"), html = read("index.html"), sql = read("supabase/phase17_catalog_gallery.sql"), css = read("css/escrow.css");
  assert.ok(html.indexOf("js/catalog.js") > html.indexOf("js/market.js"));
  assert.match(cat, /window\.DASH\.register\("equipment", view\("equipment"\)\)/); assert.match(cat, /window\.DASH\.register\("materials", view\("products"\)\)/);
  assert.doesNotMatch(mk, /register\("equipment"/, "only one buyer view");
  for (const r of ["worker", "company", "\"project-manager\"", "\"individual-employer\""]) assert.match(common, new RegExp(`${r}: \\[[^\\]]*"equipment"[^\\]]*\\]`));
  assert.match(cat, /const CAN_ORDER = \["company", "individual-employer"\]/, "matches place_order's buyer roles");
  assert.match(cat, /const MAX = 6/); assert.match(mk, /multiple hidden data-mk-pick/); assert.match(mk, /window\.CATALOG\.uploadPhotos/);
  assert.match(cat, /mk-slides/); assert.match(cat, /function lightbox/); assert.match(cat, /\.eq\("business_id", c\.uid\)/, "suppliers only edit their own listings");
  assert.match(sql, /'images', coalesce\(e\.image_urls, '\{\}'\)/); assert.match(sql, /'images', coalesce\(p\.image_urls, '\{\}'\)/);
  assert.doesNotMatch(css, /backdrop-filter/);
  new Function(cat); new Function(mk);
});

test("colours: the logo's black and white only; no gold, cream, amber or yellow in the UI", () => {
  const glob = (d, ext) => fs.readdirSync(d).filter((f) => f.endsWith(ext)).map((f) => `${d}/${f}`);
  const files = [...glob("css", ".css"), ...glob("js", ".js"), "index.html", "auth.html"].filter((f) => !/admin/.test(f));
  const warm = (r, g, b) => r > 150 && g > 90 && r - b > 60 && g - b > 40;
  const flag = /#fcd116/i; // the yellow in Ghana's flag beside the phone field
  for (const f of files) {
    const s = read(f).replace(new RegExp(flag.source, "gi"), "");
    for (const m of s.matchAll(/#([0-9a-f]{6})\b/gi)) { const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); assert.ok(!warm(r, g, b), `${f}: ${m[0]}`); }
    for (const m of s.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) assert.ok(!warm(+m[1], +m[2], +m[3]), `${f}: ${m[0]}`);
  }
});

test("member cards: glass with the cover photo, three fact tiles and the join date; the landing's drawing behind them", () => {
  const app = read("js/app.js"), css = read("css/glass-dash.css"), html = read("index.html");
  assert.match(app, /class="card c3 m4"/);
  assert.match(app, /m-cover" style="background-image:url\('\$\{esc\(it\.cover\)\}'\)"/, "the cover photo is shown");
  assert.match(app, /"Based in"/); assert.match(app, /Joined \$\{MONTHS/);
  assert.match(app, /bg\.classList\.add\("dir-bg"\)/);
  assert.match(css, /\.m4 \.m-cover \{[^}]*mask-image/);
  assert.ok(html.indexOf('class="dir-head"') > html.indexOf('</header>', html.indexOf('id="screen-directory"')), "the heading scrolls away, outside the sticky bar");
  new Function(app);
});

test("members' console: live total, five counted parts with a sliding highlight, verified share and search count", () => {
  const app = read("js/app.js"), html = read("index.html"), css = read("css/glass-dash.css");
  for (const id of ["dhTotal", "chips", "dhPct", "dhBar", "q", "dhFound"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /SEG_ORDER = \["all", "professionals", "companies", "managers", "businesses"\]/);
  assert.match(app, /setProperty\("--at", at\)/);
  assert.match(app, /state\.loading = false; renderChips\(\); renderFeed\(\);/, "counts fill in once the directory loads");
  assert.match(css, /\.seg \.seg-hl \{[^}]*translateX\(calc\(var\(--at\) \* 100%\)\)/);
  new Function(app);
});
