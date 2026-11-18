// Blueprint (sites/blueprint): house plans sold by verified designers, bought with the BAID X wallet.
const test = require("node:test"), assert = require("node:assert"), fs = require("fs");
const read = (f) => fs.readFileSync(f, "utf8");
const code = (f) => read(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

test("Blueprint: public gallery, private plan files, purchases only through the wallet and escrow", () => {
  const sql = code("supabase/phase26_blueprint.sql"), js = read("sites/blueprint/js/site.js"), cfg = read("sites/blueprint/js/config.js");
  assert.match(sql, /alter table public\.house_plans enable row level security/); assert.match(sql, /alter table public\.plan_purchases enable row level security/);
  assert.match(sql, /revoke insert, update, delete on public\.house_plans from anon, authenticated/, "plans change only through blueprint_save_plan");
  assert.match(sql, /values \('plan-files', 'plan-files', false/, "drawings are in a private bucket");
  assert.match(sql, /plan_files_read on storage\.objects for select to authenticated using \(bucket_id = 'plan-files' and public\._plan_file_reader\(name\)\)/, "only the seller and buyers who paid read the files");
  assert.match(sql, /grant execute on function public\.buy_plan\(uuid\) to authenticated/); assert.doesNotMatch(sql, /grant execute on function public\.buy_plan\(uuid\) to anon/);
  assert.match(sql, /insufficient_funds/); assert.match(sql, /perform public\._escrow_release\(esc\)/, "the seller is paid minus BAID X's commission");
  assert.match(sql, /unique \(plan_id, buyer_id\)/, "a plan is bought once per buyer");
  assert.doesNotMatch(cfg + js, /sb_secret_|sk-ant-|eyJhbGciOi/);
  assert.match(js, /\$\{esc\(p\.title\)\}/, "plan text is escaped"); assert.match(js, /\$\{C\.BAIDX\}\/#\/blueprint\//, "buying happens on BAID X");
});
