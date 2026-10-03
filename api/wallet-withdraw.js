// POST /api/wallet-withdraw { amount, network, account, name, password }   (Authorization: Bearer <session>)
// A withdrawal is only requested after the account holder re-enters their password, so a stolen or left-open session can't
// move money. The request itself is made as the user (their token), so the database applies the same role and balance rules
// (receivers only; the amount is held while BAID X pays it out to their Mobile Money).
const id = require("./_lib/sasusync/identity");
const { audit, rpc, supa, maskPhone } = require("./_lib/sasusync/route");

const SAFE = /^(the minimum withdrawal|not enough available balance|choose a mobile money|enter a valid mobile|enter the name|withdrawals are not available)/i;
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!token) return res.status(401).json({ error: "Please sign in again." });
    const b = req.body || {}, amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return res.status(400).json({ error: "Enter a valid amount." });
    if (typeof b.password !== "string" || !b.password || b.password.length > 200) return res.status(400).json({ error: "Enter your password to authorize this withdrawal." });
    const me = await supa("/auth/v1/user", { token });
    const uid = me.ok && me.json && me.json.id, email = me.ok && me.json && me.json.email;
    if (!uid || !email) return res.status(401).json({ error: "Please sign in again." });

    const lim = await rpc("rl_hit", { p_key: `wallet:withdraw:${uid}`, p_window_s: 600, p_max: 5 });
    if (!lim.ok) return res.status(503).json({ error: "Try again shortly." });
    if (lim.json.allowed === false) return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." });

    const t = await id.passwordGrant(email, b.password);          // proves the person at the keyboard knows the password
    if (!t.ok || !t.json.access_token) { await audit("wallet.withdraw_bad_password", null, {}, uid); return res.status(401).json({ error: "That password isn't right." }); }

    const r = await supa("/rest/v1/rpc/request_withdrawal", { method: "POST", token, body: { p_amount: amount, p_network: String(b.network || ""), p_account: String(b.account || ""), p_name: String(b.name || "") } });
    if (!r.ok) { const m = String((r.json && (r.json.message || r.json.error)) || ""); return res.status(400).json({ error: SAFE.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) : "We couldn't request that withdrawal." }); }
    await audit("wallet.withdraw_requested", typeof r.json === "string" ? r.json : null, { amount, network: String(b.network || ""), to: maskPhone(String(b.account || "").replace(/\D/g, "")) }, uid);
    return res.status(200).json({ ok: true, reference: r.json });
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
