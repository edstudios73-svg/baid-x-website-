const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(f, "utf8");

test("checklist: every row opens its own step, and every row has its own screen config", () => {
  const app = read("js/app.js"), feat = read("js/features.js"), common = read("js/common.js");
  assert.match(app, /data-go="step\/\$\{n\}"/);
  assert.doesNotMatch(app, /verif\|id\\b\|tin/, "no more shared edit-profile/verification routing regex");
  assert.match(common, /COMMON_ROUTES = \[[^\]]*"step"/);
  new Function(feat);
  const titles = new Set();
  for (const m of common.matchAll(/\.checklist = \[([\s\S]*?)\n  \];/g)) for (const t of m[1].matchAll(/\["([^"]+)", "/g)) titles.add(t[1]);
  assert.ok(titles.size >= 15);
  for (const t of titles) assert.ok(feat.includes(`"${t}": {`), `step config for "${t}"`);
});

test("checklist: steps never share fields (Basic profile = photo + name only, Phone has no form)", () => {
  const feat = read("js/features.js");
  assert.match(feat, /"Basic profile": \{ photo: true, cols: \[ROLES\[c\.role\]\.nameKey\]/);
  assert.match(feat, /"Phone number": \{ phone: true \}/);
  const seen = new Map();
  const body = feat.slice(feat.indexOf("const STEPS = (c)"), feat.indexOf("const defOf"));
  for (const line of body.split("\n")) {
    const t = line.match(/^\s*"([^"]+)": \{/); if (!t) continue;
    const cols = (line.match(/cols: \[([^\]]*)\]/) || [, ""])[1].match(/"[a-z_.]+"/g) || [];
    for (const col of cols) { if (seen.has(col) && !/region|city_town|short_bio|email|ghana_card_number/.test(col)) assert.fail(`${col} appears in both ${seen.get(col)} and ${t[1]}`); seen.set(col, t[1]); }
  }
});
