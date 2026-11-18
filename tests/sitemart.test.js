// SiteMart (sites/sitemart): BAID X's construction marketplace, Phase 1 (docs/sitemart/ARCHITECTURE.md).
const test = require("node:test"), assert = require("node:assert"), fs = require("fs");
const read = (f) => fs.readFileSync(f, "utf8");
const code = (s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = code(read("supabase/phase27_sitemart_foundation.sql"));
const site = ["index.html", "js/config.js", "js/core.js", "js/site.js"].map((f) => read(`sites/sitemart/${f}`)).join("\n");
const css = read("sites/sitemart/css/site.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("SiteMart SQL: public reads expose no private fields; member writes are signed-in only", () => {
  for (const fn of ["sitemart_search\\(jsonb\\)", "sitemart_home\\(\\)", "sitemart_listing\\(text, uuid\\)", "sitemart_supplier\\(uuid\\)"])
    assert.match(sql, new RegExp(`grant execute on function [^;]*public\\.${fn}[^;]*to anon, authenticated`), fn);
  assert.match(sql, /revoke all on function public\.sm_register\(jsonb\)[^;]*from public, anon/);
  assert.doesNotMatch(sql, /grant execute on function public\.(sm_register|sm_me|sm_listing_details|sm_toggle_saved|sm_submit_verification|admin_sm_review_verification)[^;]*\banon\b/);
  assert.match(sql, /revoke all on function [^;]*public\._sm_trust\(uuid\)[^;]*from public, anon, authenticated/, "helpers are not callable");
  for (const f of ["contact_phone", "contact_email", "payout", "ghana_card", "tin_number", "rgd_registration", "momo"]) assert.doesNotMatch(sql, new RegExp(f), `${f} never leaves the database`);
});

test("SiteMart SQL: RLS on every new table, no client writes, nothing destructive", () => {
  for (const t of ["sm_countries", "sm_categories", "sm_accounts", "sm_verification", "sm_saved"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t} has RLS`);
    assert.match(sql, new RegExp(`revoke insert, update, delete on public\\.${t} from anon, authenticated`), `${t} is written only through functions`);
  }
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema)\b|\btruncate\b|\bdelete\s+from\s+public\.(business|orders|wallet|escrow)/i);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.match(sql, /add column if not exists/);
});

test("SiteMart SQL: trust is computed from BAID X checks, never chosen or bought", () => {
  assert.match(sql, /function public\._sm_trust/);
  assert.doesNotMatch(sql, /trust\w*\s*=\s*(p|p_)/i, "no write path sets trust");
  assert.doesNotMatch(sql.match(/function public\._sm_trust[\s\S]*?\$\$;/)[0], /plan|membership|subscription|boost/i, "plans do not affect trust");
  assert.match(sql, /perform public\._need\('verification', 'APPROVE'\)/, "only staff with the verification permission decide");
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/, "members upload only into their own folder");
  assert.match(sql, /'sm-verification', 'sm-verification', false/, "verification documents are private");
  assert.match(sql, /split_part\(d, '\/', 1\) <> me::text/, "a member can only submit their own uploads");
});

test("SiteMart SQL: seller details only on the seller's own listings", () => {
  const f = sql.match(/function public\.sm_listing_details[\s\S]*?\$\$;/)[0];
  assert.match(f, /where id = p_id and business_id = me/);
  assert.match(f, /raise exception 'not your listing'/);
});

test("SiteMart site: only the publishable key, everything escaped, honest about later phases", () => {
  assert.doesNotMatch(site, /sb_secret_|sk-ant-|service_role"|eyJhbGciOi/, "no secret or service key in the site");
  assert.match(site, /storageKey: "sitemart-auth"/);
  assert.match(site, /\$\{esc\(i\.name\)\}/); assert.match(site, /\$\{esc\(s\.name/);
  assert.match(site, /Example only, not a real order/, "the tracking demonstration is labelled as an example");
  assert.match(site, /Estimated, not confirmed/, "GPS, checkpoints and estimates are told apart");
  assert.match(site, /does not mean BAID X checked the land title/i, "real estate does not overclaim");
  assert.doesNotMatch(site, /\bfake\b|lorem ipsum/i);
  assert.match(site, /lowercase letter, a capital letter, a number and a symbol/, "same password rule as BAID X");
  assert.match(read("sites/sitemart/index.html"), /name="viewport" content="width=device-width, initial-scale=1/);
});

test("SiteMart style: BAID X colours only, reduced motion respected", () => {
  assert.doesNotMatch(css, /gold|amber|yellow|#f5b|#fbbf24|#fcd34d|#facc15|#eab308|#f59e0b/i, "no gold, amber or yellow");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(site, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emoji");
});
