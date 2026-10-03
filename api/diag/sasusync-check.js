// TEMPORARY, READ-ONLY connection check for Stage 0 verification. Deleted right after use.
// Never returns any secret. Calls only documented read-only SasuSync endpoints (no SMS, no OTP, no credits).
const crypto = require("crypto");
const { signatureMatches, expectedSignature } = require("../_lib/sasusync-webhook");
const NONCE = "57e2399c690a7dbc6292cf7d";
const SITE = "https://baid-x-website.vercel.app";
const flag = (v) => (v ? "CONFIGURED" : "MISSING");

async function timed(fn) { const t = Date.now(); try { const r = await fn(); return { ...r, ms: Date.now() - t }; } catch (e) { return { error: e && e.name === "AbortError" ? "timeout" : "network_error", detail: String(e && e.cause && e.cause.code || e && e.code || ""), ms: Date.now() - t }; } }
async function get(path) {
  const base = String(process.env.SASUSYNC_BASE_URL || "").replace(/\/+$/, "");
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(base + path, { method: "GET", headers: { "X-API-Key": process.env.SASUSYNC_API_KEY, Accept: "application/json" }, signal: ac.signal });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { http: r.status, json, nonJson: json === null ? text.slice(0, 120) : undefined };
  } finally { clearTimeout(to); }
}
const post = async (body, headers) => { const r = await fetch(SITE + "/api/webhooks/sasusync", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }); return r.status; };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const u = new URL(req.url, "https://x"); if (req.method !== "GET" || u.searchParams.get("k") !== NONCE) return res.status(404).end();
  const out = { env: {
    SASUSYNC_API_KEY: flag(process.env.SASUSYNC_API_KEY), SASUSYNC_SENDER_ID: flag(process.env.SASUSYNC_SENDER_ID), SASUSYNC_BASE_URL: flag(process.env.SASUSYNC_BASE_URL),
    SASUSYNC_MODE: flag(process.env.SASUSYNC_MODE), SASUSYNC_WEBHOOK_SECRET: flag(process.env.SASUSYNC_WEBHOOK_SECRET) },
    nonSecretValues: { base_url: process.env.SASUSYNC_BASE_URL || null, mode: process.env.SASUSYNC_MODE || null, sender_is_exactly_BAID_X: process.env.SASUSYNC_SENDER_ID === "BAID X" } };
  if (process.env.SASUSYNC_API_KEY && process.env.SASUSYNC_BASE_URL) {
    out.otp_balance = await timed(() => get("/otp/balance"));
    out.sms_balance = await timed(() => get("/api/v1/balance"));
    out.sender_status = await timed(() => get("/sender/id/status?sender_name=" + encodeURIComponent("BAID X")));
  }
  const secret = process.env.SASUSYNC_WEBHOOK_SECRET;
  if (secret) {
    const raw = Buffer.from(JSON.stringify({ test: true, source: "baid-x-webhook-verification" }), "utf8");
    const sig = expectedSignature(raw, secret), tampered = Buffer.from(JSON.stringify({ test: true, source: "baid-x-webhook-verification", x: 1 }), "utf8");
    out.local_verification = { valid_accepted: signatureMatches(raw, secret, sig), wrong_signature_rejected: !signatureMatches(raw, secret, "0".repeat(64)), modified_body_rejected: !signatureMatches(tampered, secret, sig), uppercase_hex_equal: signatureMatches(raw, secret, sig.toUpperCase()), uses_timingSafeEqual: /timingSafeEqual/.test(require("fs").readFileSync(require.resolve("../_lib/sasusync-webhook"), "utf8")) };
    const body = raw.toString("utf8");
    out.deployed_endpoint = await timed(async () => ({
      no_signature: await post(body, {}), invalid_signature: await post(body, { "x-webhook-signature": "0".repeat(64) }),
      valid_signature: await post(body, { "x-webhook-signature": sig }), modified_body_with_old_signature: await post(JSON.stringify({ test: true, x: 2 }), { "x-webhook-signature": sig }),
      get_method: (await fetch(SITE + "/api/webhooks/sasusync")).status }));
  }
  return res.status(200).json(out);
};
