// POST /api/auth/phone/password { password }  (Authorization: Bearer <session of the user who just verified a phone code>)
// Sets the account's password right after sign-up / reset. Supabase's own "update password" call asks for the CURRENT password,
// which a phone user doesn't have (the session was minted from a one-time code), so the server does it, but only when:
//   * the caller's session is valid,
//   * that same user verified a SasuSync code in the last 30 minutes, and
//   * that verification has not already been used to set a password (one use only).
const { cfg } = require("../../_lib/sasusync/config");
const id = require("../../_lib/sasusync/identity");
const { audit, rpc, supa } = require("../../_lib/sasusync/route");

// 8+ characters (<= 72 bytes), a letter, a number, and a capital letter or a symbol: the same rules the page shows.
const strong = (p) => typeof p === "string" && p.length >= 8 && Buffer.byteLength(p) <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p) && (/[A-Z]/.test(p) || /[^A-Za-z0-9]/.test(p));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!cfg().phoneAuth) return res.status(503).json({ error: "Phone sign-in isn't available yet." });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!token) return res.status(401).json({ error: "Please verify your number again." });
    const password = req.body && req.body.password;
    if (!strong(password)) return res.status(400).json({ error: "Use at least 8 characters with a letter, a number, and a capital letter or symbol." });
    const me = await supa("/auth/v1/user", { token });
    const uid = me.ok && me.json && me.json.id;
    if (!uid) return res.status(401).json({ error: "Please verify your number again." });
    const lim = await rpc("rl_hit", { p_key: `phone:setpw:${uid}`, p_window_s: 3600, p_max: 10 });
    if (!lim.ok) return res.status(503).json({ error: "Try again shortly." });
    if (lim.json.allowed === false) return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." });

    // claim the newest unused verification for this user (atomic: only one request can win)
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const q = await supa(`/rest/v1/sasusync_otp_requests?user_id=eq.${uid}&status=eq.verified&password_set_at=is.null&verified_at=gte.${encodeURIComponent(since)}&order=verified_at.desc&limit=1&select=otp_id`);
    const row = q.ok && Array.isArray(q.json) ? q.json[0] : null;
    if (!row) return res.status(403).json({ error: "Please verify your number again to set a password." });
    const claim = await supa(`/rest/v1/sasusync_otp_requests?otp_id=eq.${encodeURIComponent(row.otp_id)}&password_set_at=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { password_set_at: new Date().toISOString() } });
    if (!claim.ok || !Array.isArray(claim.json) || claim.json.length !== 1) return res.status(409).json({ error: "That was already used. Verify your number again." });

    const u = await id.updateUser(uid, { password });
    if (!u.ok) {
      await supa(`/rest/v1/sasusync_otp_requests?otp_id=eq.${encodeURIComponent(row.otp_id)}`, { method: "PATCH", body: { password_set_at: null } }); // let them retry
      await audit("phone.password_failed", row.otp_id, { status: u.status }, uid);
      return res.status(502).json({ error: "We couldn't save your password. Try again." });
    }
    await audit("phone.password_set", row.otp_id, {}, uid);
    return res.status(200).json({ ok: true });
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
