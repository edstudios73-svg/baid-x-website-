// Canonical Ghana number: 233XXXXXXXXX (12 digits). Accepts 233…, +233…, 0… and spaced/dashed input. Anything else -> null.
function normalizeGhanaPhone(input) {
  if (typeof input !== "string") return null;
  let d = input.trim().replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("00233")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "233" + d.slice(1);
  if (!/^233\d{9}$/.test(d)) return null;
  if (!/^[235]/.test(d[3])) return null; // Ghana mobile/fixed prefixes begin 2 (20,23,24,26,27,28), 3 or 5 (50,53,54,55,56,57,59)
  return d;
}
const maskPhone = (p) => (p ? `${String(p).slice(0, 3)}****${String(p).slice(-3)}` : "");
module.exports = { normalizeGhanaPhone, maskPhone };
