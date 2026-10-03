// Message templates with personalisation. Placeholders: {name} (full name or business name), {first_name}, {role}.
// Names come from user-entered profiles, so they are sanitised: control characters and links are stripped, whitespace collapsed,
// length capped. A missing name falls back to "there" so a message never reads "Welcome, !".
const ROLE_LABEL = { worker: "worker", company: "company", "project-manager": "project manager", business: "business", "individual-employer": "client" };
const PLACEHOLDERS = ["name", "first_name", "role"];

function cleanName(raw) {
  const CTRL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]", "g");
  let n = String(raw == null ? "" : raw).normalize("NFC").replace(CTRL, " ").replace(/https?:\/\/\S+|www\.\S+/gi, " ").replace(/\s+/g, " ").trim();
  if (n.length > 40) n = n.slice(0, 40).replace(/\s+\S*$/, "").trim() || n.slice(0, 40);
  return n;
}
const titleCase = (s) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s); // KWAME MENSAH -> Kwame Mensah; leaves mixed case alone
function renderTemplate(template, { name, role } = {}) {
  const full = titleCase(cleanName(name)) || "there", first = full === "there" ? "there" : full.split(" ")[0];
  return String(template).replace(/\{(name|first_name|role)\}/g, (m, k) => (k === "name" ? full : k === "first_name" ? first : ROLE_LABEL[role] || "member"));
}
// null when the template is acceptable, otherwise a short reason for the admin.
function validateTemplate(template) {
  const t = String(template == null ? "" : template);
  if (t.trim().length < 5) return "Write at least 5 characters.";
  if (t.length > 200) return "Keep the template to 200 characters (names are added on top).";
  const bad = [...t.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).find((k) => !PLACEHOLDERS.includes(k));
  if (bad !== undefined) return `Unknown placeholder {${bad}}. Use {name}, {first_name} or {role}.`;
  if (/[{}]/.test(t.replace(/\{(name|first_name|role)\}/g, ""))) return "Curly braces are only for placeholders.";
  return null;
}
module.exports = { renderTemplate, validateTemplate, cleanName, ROLE_LABEL, PLACEHOLDERS };
