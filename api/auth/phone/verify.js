// POST /api/auth/phone/verify { phone, code } -> verifies with SasuSync (verified === true only), then returns a Supabase session.
// A session is minted only for a brand-new number (signup) or the account's own number (reset). It never signs an existing
// account in by itself and the temporary password used to mint it is random, discarded, and not returned.
const crypto = require("crypto");
const { cfg } = require("../../_lib/sasusync/config");
const { normalizeGhanaPhone, maskPhone } = require("../../_lib/sasusync/phone");
const { verifyOtp } = require("../../_lib/sasusync/otp");
const { ip, audit, rpc, supa } = require("../../_lib/sasusync/route");
const { env } = require("../../_lib/paystack");

const MSG = { wrong_code: "That code isn't right.", expired: "That code expired. Request a new one.", no_pending_code: "No code is waiting for this number. Request a new one.", already_verified: "That code was already used." };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!cfg().phoneAuth) return res.status(503).json({ error: "Phone sign-in isn't available yet." });
  try {
    const phone = normalizeGhanaPhone(req.body && req.body.phone), code = String((req.body && req.body.code) || "");
    if (!phone || !/^\d{4,8}$/.test(code)) return res.status(400).json({ error: "Enter the code you received." });
    const a = await rpc("rl_hit", { p_key: `otp:verify:p:${phone}`, p_window_s: 600, p_max: 8 });
    const b = await rpc("rl_hit", { p_key: `otp:verify:ip:${ip(req)}`, p_window_s: 600, p_max: 30 });
    const lim = [a, b].find((x) => x.ok && x.json && x.json.allowed === false);
    if (lim) { res.setHeader("Retry-After", String(lim.json.retry_after_s)); return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." }); }
    if (!a.ok || !b.ok) return res.status(503).json({ error: "Try again shortly." });

    // the newest code we sent to this number, from the last 15 minutes
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const q = await supa(`/rest/v1/sasusync_otp_requests?phone=eq.${phone}&status=eq.sent&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1&select=otp_id,purpose,user_id`);
    const row = q.ok && Array.isArray(q.json) ? q.json[0] : null;
    if (!row) return res.status(400).json({ ok: false, reason: "no_pending_code", error: MSG.no_pending_code });

    let v;
    try { v = await verifyOtp({ otpId: row.otp_id, code }); }
    catch (e) {
      await audit("otp.verify_error", row.otp_id, { kind: e && e.kind, phone: maskPhone(phone) });
      return res.status(e && e.kind === "RATE_LIMITED" ? 429 : 502).json({ error: "We couldn't check that code. Try again shortly." });
    }
    if (v.verified !== true) {
      if (v.reason === "expired") await supa(`/rest/v1/sasusync_otp_requests?otp_id=eq.${encodeURIComponent(row.otp_id)}&status=eq.sent`, { method: "PATCH", body: { status: "expired" } });
      await audit("otp.rejected", row.otp_id, { reason: v.reason, phone: maskPhone(phone) });
      return res.status(400).json({ ok: false, reason: v.reason, attempts_remaining: v.attemptsRemaining, error: MSG[v.reason] || MSG.wrong_code });
    }

    // claim the request exactly once: a double submit or replay gets no second session
    const claim = await supa(`/rest/v1/sasusync_otp_requests?otp_id=eq.${encodeURIComponent(row.otp_id)}&status=eq.sent`, { method: "PATCH", body: { status: "verified", verified_at: new Date().toISOString() }, headers: { Prefer: "return=representation" } });
    if (!claim.ok || !Array.isArray(claim.json) || claim.json.length !== 1) return res.status(409).json({ ok: false, reason: "already_verified", error: MSG.already_verified });

    const e = env(), tmp = crypto.randomBytes(24).toString("base64url") + "aA1!";
    let uid = row.user_id;
    if (row.purpose === "signup") {
      const c = await fetch(`${e.supaUrl}/auth/v1/admin/users`, { method: "POST", headers: { apikey: e.serviceKey, authorization: `Bearer ${e.serviceKey}`, "content-type": "application/json" }, body: JSON.stringify({ phone: `+${phone}`, phone_confirm: true, password: tmp, user_metadata: { phone_verified_by: "sasusync" } }) });
      const cj = await c.json().catch(() => ({}));
      if (!c.ok || !cj.id) { await audit("otp.account_failed", row.otp_id, { purpose: "signup" }); return res.status(500).json({ error: "We couldn't finish creating your account." }); }
      uid = cj.id;
    } else {
      if (!uid) return res.status(400).json({ error: "Something went wrong." });
      const u = await fetch(`${e.supaUrl}/auth/v1/admin/users/${uid}`, { method: "PUT", headers: { apikey: e.serviceKey, authorization: `Bearer ${e.serviceKey}`, "content-type": "application/json" }, body: JSON.stringify({ phone_confirm: true, password: tmp }) });
      if (!u.ok) { await audit("otp.account_failed", row.otp_id, { purpose: "reset" }); return res.status(500).json({ error: "We couldn't finish. Try again." }); }
    }
    const t = await fetch(`${e.supaUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: e.serviceKey, "content-type": "application/json" }, body: JSON.stringify({ phone: `+${phone}`, password: tmp }) });
    const tj = await t.json().catch(() => ({}));
    await supa(`/rest/v1/sasusync_otp_requests?otp_id=eq.${encodeURIComponent(row.otp_id)}`, { method: "PATCH", body: { user_id: uid } });
    await audit("otp.verified", row.otp_id, { purpose: row.purpose, phone: maskPhone(phone) }, uid);
    if (!t.ok || !tj.access_token) return res.status(502).json({ error: "Your number is verified, but we couldn't sign you in. Try signing in." });
    // phone verification is NOT identity/KYC verification; it only proves control of the number
    return res.status(200).json({ ok: true, purpose: row.purpose, session: { access_token: tj.access_token, refresh_token: tj.refresh_token, expires_in: tj.expires_in, token_type: tj.token_type } });
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
