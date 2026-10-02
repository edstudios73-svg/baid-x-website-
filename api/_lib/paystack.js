// Shared helpers for the Paystack functions. Secrets come only from environment variables (never from code).
const crypto = require("crypto");

const env = () => ({
  secret: process.env.PAYSTACK_SECRET_KEY,
  supaUrl: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const configured = () => { const e = env(); return !!(e.secret && e.supaUrl && e.serviceKey); };

// Paystack signs the raw body with HMAC SHA512 using the secret key.
function validSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8"), b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.body === "string") return resolve(req.body);
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString("utf8"));
    const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
  });
}

async function supa(path, { method = "GET", body, token } = {}) {
  const e = env();
  const r = await fetch(`${e.supaUrl}${path}`, { method, headers: { apikey: e.serviceKey, authorization: `Bearer ${token || e.serviceKey}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: r.ok, status: r.status, json };
}
const rpc = (fn, args) => supa(`/rest/v1/rpc/${fn}`, { method: "POST", body: args });

async function paystack(path, { method = "GET", body } = {}) {
  const r = await fetch(`https://api.paystack.co${path}`, { method, headers: { authorization: `Bearer ${env().secret}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

// Turns a Paystack event into a stable key so the same event can never be applied twice.
function dedupeKey(ev) {
  const d = ev.data || {};
  const id = d.id || d.invoice_code || d.subscription_code || d.reference || d.transaction_reference || d.refund_reference;
  return `${ev.event}:${id || crypto.createHash("sha256").update(JSON.stringify(d)).digest("hex").slice(0, 24)}`;
}

module.exports = { env, configured, validSignature, readRaw, supa, rpc, paystack, dedupeKey };
