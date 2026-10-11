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

test("members' console: no member numbers, five parts with a sliding highlight, verified share", () => {
  const app = read("js/app.js"), html = read("index.html"), css = read("css/glass-dash.css");
  for (const id of ["chips", "dhPct", "dhBar", "q"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const id of ["dhTotal", "dhFound"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`), "no member counts");
  assert.doesNotMatch(app, /members?\$\{|\$\{list\.length\} found/, "no member counts");
  assert.match(app, /setProperty\("--at", at\)/);
  assert.match(app, /state\.loading = false; renderChips\(\); renderFeed\(\);/, "counts fill in once the directory loads");
  assert.match(css, /\.seg \.seg-hl \{[^}]*translateX\(calc\(var\(--at\) \* 100%\)\)/);
  new Function(app);
});

test("visitor tools on the landing: check a badge and the price guide, from the public directory, no member counts", () => {
  const html = read("index.html"), land = read("js/landing.js"), app = read("js/app.js");
  for (const id of ["lp-check", "lpCheckQ", "lpCheckOut", "lp-rates", "lpRegions", "lpRates"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /href="#lp-check" data-lp-jump/); assert.match(html, /href="#lp-rates" data-lp-jump/);
  assert.match(app, /new CustomEvent\("baidx:directory"/); assert.match(app, /rate: Number\(r\.daily_rate_ghs\) \|\| null/);
  assert.match(land, /function tradeRates\(list, reg\)/); assert.match(land, /q\.length < 3/);
  assert.match(land, /m\.badge && String\(m\.name/, "the badge check lists verified members only");
  assert.doesNotMatch(land, /Not verified yet/);
  assert.match(land, /const MIN_SAMPLES = 3/); assert.match(land, /r >= m0 \/ 3 && r <= m0 \* 3/);
  assert.match(land, /setTimeout\(\(\) => \{ if \(!loaded\) renderRates\(\); \}, 8000\)/);
  assert.match(html, /id="lpMenuBtn"[^>]*aria-expanded="false" aria-controls="lpMenu"/); assert.match(html, /id="lpMenu" hidden/);
  assert.match(html, /EXAMPLE  &#183;  JOB #BX-10482/); assert.match(html, /Example &middot; Electrician/);
  new Function(land);
});

test("website opens straight on the landing: no splash; the stack glides and the hero rises in", () => {
  const html = read("index.html"), app = read("js/app.js"), land = read("js/landing.js"), css = read("css/landing.css");
  assert.doesNotMatch(html, /id="splash"/); assert.doesNotMatch(app, /runSplash/);
  assert.match(app, /sb-\.\+-auth-token/, "visitors are routed before the account check");
  assert.match(land, /shown \+= \(goal - shown\) \* 0\.2/);
  assert.match(css, /\.lp-stack \{ height: 230vh; height: 230svh;/);
  assert.match(css, /@keyframes lpUp/); assert.match(css, /prefers-reduced-motion: reduce\) \{\n  \.lp-bg, \.lp-hero/);
  new Function(land); new Function(app);
});

test("BAID Bot: floating on the landing for visitors, answers from the baid-bot function, text escaped, no secrets in the page", () => {
  const html = read("index.html"), bot = read("js/baidbot.js"), css = read("css/baidbot.css"), fn = read("supabase/functions/baid-bot/index.ts");
  assert.ok(html.indexOf("js/baidbot.js") > html.indexOf("js/landing.js")); assert.match(html, /css\/baidbot\.css/);
  assert.match(bot, /functions\/v1\/baid-bot/); assert.match(bot, /esc\(text\)/, "replies are escaped before they are shown");
  assert.match(css, /body:not\(\.is-guest\) \.bb \{ display: none; \}/, "visitors only");
  assert.doesNotMatch(bot + html, /sk-ant-|ANTHROPIC_API_KEY/, "the AI key lives only in the function's secrets");
  assert.match(fn, /Deno\.env\.get\("ANTHROPIC_API_KEY"\)/); assert.match(fn, /function limited\(ip/); assert.match(fn, /MAX_CHARS = 600/);
  assert.match(fn, /if \(!key\) return json\(\{ reply: topicAnswer/, "works without a key, from BAID X's facts");
  new Function(bot);
});

test("app on the web: an animated splash in the page while the app loads, never the old loading text", () => {
  const html = read("app/index.html");
  assert.doesNotMatch(html, /Loading BAID X/);
  for (const c of ["r1", "orbit", "logo", "word", "tag", "BAIDEN CREATIVES", "prog"]) assert.ok(html.includes(c), c);
  assert.match(html, /flutter-first-frame/); assert.match(html, /onSplash\(\)/, "stays until the app leaves its splash route");
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /minMs = calm \? 600 : 4000/, "4 seconds"); assert.match(html, /animation: bFill 4s linear forwards/, "the bar fills across the 4 seconds");
  const v = JSON.parse(read("vercel.json"));
  assert.ok(v.headers.some((h) => h.source.startsWith("/app/(assets|canvaskit") && /stale-while-revalidate/.test(h.headers[0].value)), "the app's files are kept by the browser so later visits open fast");
});

test("www.baid-x.com: old host redirects except /api/, contact page, Baiden Creatives named, fees stated", () => {
  const vj = JSON.parse(read("vercel.json"));
  const host = vj.redirects.find((r) => r.has?.[0]?.value === "baid-x-website.vercel.app");
  assert.equal(host.destination, "https://www.baid-x.com/:path"); assert.match(host.source, /\(\?!api\/\)/);
  for (const f of ["index.html", "about.html", "terms.html", "privacy.html", "contact.html", "pricing/index.html", "sitemap.xml", "robots.txt", "llms.txt"]) assert.doesNotMatch(read(f), /baid-x-website\.vercel\.app/, f);
  const c = read("contact.html");
  assert.match(c, /info@baidencreatives\.org/); assert.match(c, /\+233 20 607 1106/); assert.match(c, /East Legon/); assert.match(c, /organization under <b>Baiden Creatives/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/www\.baid-x\.com\/contact\.html<\/loc>/);
  assert.doesNotMatch(read("robots.txt"), /admin\.html/);
  assert.match(read("terms.html"), /10% of the amount released/); assert.doesNotMatch(read("terms.html"), /\[X\]|REGISTRATION NO|test release/);
  assert.match(read("pricing/index.html"), /Other fees/); assert.match(read("404.html"), /noindex/);
  assert.match(read("supabase/functions/baid-bot/index.ts"), /an organization under Baiden Creatives/);
});

test("sign-up and account fixes: blank phone is null, duplicates checked, password change re-checks current, iPhone fields 16px", () => {
  const auth = read("js/auth.js"), fx = read("js/features.js"), css = read("css/mobile.css"), sql = read("supabase/phase19_blank_fields_null.sql");
  assert.match(auth, /S\.phone \|\| null/);
  assert.match(auth, /select\("id"\)\.eq\("id", user\.id\)\.maybeSingle\(\)/, "a duplicate counts as success only for the user's own profile");
  assert.match(auth, /already on another BAID X account/);
  assert.match(auth, /params\.get\("mode"\) === "reset"\) \{ S\.mode = "reset"/); assert.match(auth, /!GROUP && S\.mode !== "reset"/);
  assert.match(fx, /inp\("cur", \{ type: "password"/); assert.match(fx, /signInWithPassword\(\{ email, password: d\.cur \}\)/);
  assert.match(fx, /Add a capital letter or a symbol\./); assert.match(fx, /"forgot-password":/);
  assert.match(css, /font-size: 16px !important/);
  for (const t of ["worker_profiles", "company_profiles", "project_manager_profiles", "business_profiles", "individual_employer_profiles"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} alter column \\w+ drop not null`), t);
    assert.match(sql, new RegExp(`before insert or update on public\\.${t}`), t);
  }
  // phone parsing matches the server: 9 digits after 233, starting 2, 3 or 5
  const body = auth.slice(auth.indexOf("function toE164"), auth.indexOf("function friendly"));
  const toE164 = new Function("S", `${body}; return toE164;`)({ country: { d: "233" } });
  for (const x of ["0206071106", "20 607 1106", "+233 20 607 1106", "00233206071106", "+233 020 607 1106"]) assert.equal(toE164(x), "+233206071106", x);
  for (const x of ["0206071", "0806071106", "02060711066"]) assert.equal(toE164(x), null, x);
});
