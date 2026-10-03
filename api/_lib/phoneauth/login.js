// POST /api/auth/phone/login { phone, password } -> session. Phone + password sign-in WITHOUT Supabase's Phone provider:
// the number is mapped to its account server-side (public.phone_identities), then the normal email/password grant is used.
// Every failure looks the same (no account enumeration). Rate limited per number and per IP. Behind SASUSYNC_PHONE_AUTH.
const { cfg } = require("../sasusync/config");
const { normalizeGhanaPhone, maskPhone } = require("../sasusync/phone");
const id = require("../sasusync/identity");
const { ip, audit, rpc } = require("../sasusync/route");

const FAIL = { error: "That number or password isn't right." };
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!cfg().phoneAuth) return res.status(503).json({ error: "Phone sign-in isn't available yet." });
  try {
    const phone = normalizeGhanaPhone(req.body && req.body.phone), password = String((req.body && req.body.password) || "");
    if (!phone || !password || password.length > 200) return res.status(400).json(FAIL);
    // independent checks run together (one round trip instead of four)
    const [a, b, found] = await Promise.all([
      rpc("rl_hit", { p_key: `phone:login:p:${phone}`, p_window_s: 600, p_max: 10 }),
      rpc("rl_hit", { p_key: `phone:login:ip:${ip(req)}`, p_window_s: 600, p_max: 30 }),
      rpc("auth_email_by_phone", { p_phone: phone }),
    ]);
    const lim = [a, b].find((x) => x.ok && x.json && x.json.allowed === false);
    if (lim) { res.setHeader("Retry-After", String(lim.json.retry_after_s)); return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." }); }
    if (!a.ok || !b.ok) return res.status(503).json({ error: "Try again shortly." });
    const email = found.ok && typeof found.json === "string" && found.json ? found.json : null;
    if (!email) return res.status(401).json(FAIL);
    const t = await id.passwordGrant(email, password);
    if (!t.ok || !t.json.access_token) { await audit("phone.login_failed", null, { phone: maskPhone(phone) }); return res.status(401).json(FAIL); }
    return res.status(200).json({ ok: true, session: id.sessionOf(t.json) });
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
