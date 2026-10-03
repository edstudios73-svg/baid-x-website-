// Phone alerts (Web Push).
//   GET  /api/push?key=1   -> { publicKey }  (the VAPID public key; the browser needs it to subscribe)
//   POST /api/push         -> sends one alert to every device a user turned alerts on for. Called by the database
//                             (trigger via pg_net) with the shared secret kept in public.app_secrets.
// The VAPID key pair is created here on first use and stored only in public.app_secrets (service role access only).
const webpush = require("web-push");

const URL_ = process.env.SUPABASE_URL || "https://igfmmprlrybxsdzehwid.supabase.co"; // project URL is public
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBJECT = "https://baid-x-website.vercel.app";

const db = async (path, { method = "GET", body, headers = {} } = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* empty */ }
  return { ok: r.ok, status: r.status, json: j };
};
const secret = async (k) => { const r = await db(`app_secrets?k=eq.${encodeURIComponent(k)}&select=v`); return r.ok && r.json && r.json[0] ? r.json[0].v : null; };

let cached = null;
async function vapid() {
  if (cached) return cached;
  let v = await secret("vapid");
  if (!v) {
    const k = webpush.generateVAPIDKeys();
    await db("app_secrets", { method: "POST", body: { k: "vapid", v: JSON.stringify(k) }, headers: { prefer: "resolution=ignore-duplicates,return=minimal" } });
    v = await secret("vapid"); // whoever won the race
  }
  cached = JSON.parse(v);
  return cached;
}

module.exports = async (req, res) => {
  if (!KEY) return res.status(503).json({ error: "not configured" });
  try {
    if (req.method === "GET") {
      const v = await vapid();
      res.setHeader("cache-control", "public, max-age=3600");
      return res.status(200).json({ publicKey: v.publicKey });
    }
    if (req.method !== "POST") return res.status(405).end();
    const want = await secret("push_secret");
    if (!want || req.headers["x-push-secret"] !== want) return res.status(401).end();
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!b.user_id) return res.status(400).end();
    const v = await vapid();
    webpush.setVapidDetails(SUBJECT, v.publicKey, v.privateKey);
    const subs = await db(`push_subscriptions?user_id=eq.${encodeURIComponent(b.user_id)}&select=endpoint,p256dh,auth`);
    const payload = JSON.stringify({ title: String(b.title || "BAID X").slice(0, 80), body: String(b.body || "").slice(0, 200), href: String(b.href || "#/notifications"), tag: b.tag || undefined });
    let sent = 0, gone = 0;
    await Promise.all((subs.json || []).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" }); sent++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { gone++; await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }); } }
    }));
    return res.status(200).json({ sent, gone });
  } catch (e) {
    console.error("push error", e && e.message);
    return res.status(500).json({ error: "push failed" });
  }
};
