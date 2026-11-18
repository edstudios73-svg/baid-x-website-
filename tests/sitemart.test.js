// SiteMart by BAID X (sites/sitemart): a public storefront over BAID X's supplier listings.
const test = require("node:test"), assert = require("node:assert"), fs = require("fs");
const read = (f) => fs.readFileSync(f, "utf8");

test("SiteMart: public read-only catalogue, nothing private leaves the database, ordering stays on BAID X", () => {
  const sqlAll = read("supabase/phase25_sitemart.sql"), sql = sqlAll.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"), js = read("sites/sitemart/js/site.js"), cfg = read("sites/sitemart/js/config.js"), html = read("sites/sitemart/index.html");
  assert.match(sql, /grant execute on function public\.sitemart_catalog\([^)]*\) to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.sitemart_item\([^)]*\) to anon, authenticated/);
  for (const f of ["contact_phone", "contact_email", "payout", "ghana_card", "tin_number", "rgd_registration"]) assert.doesNotMatch(sql, new RegExp(f), `${f} never leaves the database`);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\s+(into\s+)?public\./i, "the storefront only reads");
  assert.doesNotMatch(cfg + js + html, /sb_secret_|sk-ant-|eyJhbGciOi/, "only the publishable key is in the site (no secret or service key)");
  assert.match(js, /\$\{esc\(i\.name\)\}/, "listing text is escaped"); assert.match(js, /\$\{esc\(s\.name/, "supplier text is escaped");
  assert.match(js, /\$\{C\.BAIDX\}\/auth\.html/, "orders are placed on BAID X, where escrow holds the money");
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1/); assert.doesNotMatch(read("sites/sitemart/css/site.css").replace(/\/\*[\s\S]*?\*\//g, ""), /gold|amber|yellow|#f5b|#fbbf24|#fcd34d|#facc15|#eab308/i, "no gold, amber or yellow");
});
