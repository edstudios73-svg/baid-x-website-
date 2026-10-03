// POST /api/auth/phone/verify { phone, code } -> verifies with SasuSync (verified === true only), then returns a Supabase session.
// A session is minted only for a brand-new number (signup) or the account's own number (reset). The temporary password used to
// mint it is random, discarded and never returned. Supabase's native Phone provider is not used (synthetic-email identity).
const { cfg } = require("../sasusync/config");
const { normalizeGhanaPhone, maskPhone } = require("../sasusync/phone");
const { verifyOtp } = require("../sasusync/otp");
const { ip, audit, rpc, supa } = require("../sasusync/route");
const id = require("../sasusync/identity");

const MSG = { wrong_code: "That code isn't right.", expired: "That code expired. Request a new one.", no_pending_code: "No code is waiting for this number. Request a new one.", already_verified: "That code was already used." };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!cfg().phoneAuth) return res.status(503).json({ error: "Phone sign-in isn't available yet." });
  try {
    const phone = normalizeGhanaPhone(req.body && req.body.phone), code = String((req.body && req.body.code) || "");
    if (!phone || !/^\d{4,8}$/.test(code)) return res.status(400).json({ error: "Enter the code you received." });
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [a, b, q] = await Promise.all([
      rpc("rl_hit", { p_key: `otp:verify:p:${phone}`, p_window_s: 600, p_max: 8 }),
      rpc("rl_hit", { p_key: `otp:verify:ip:${ip(req)}`, p_window_s: 600, p_max: 30 }),
      supa(`/rest/v1/sasusync_otp_requests?phone=eq.${phone}&status=eq.sent&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1&select=otp_id,purpose,user_id`),
    ]);
    const lim = [a, b].find((x) => x.ok && x.json && x.json.allowed === false);
    if (lim) { res.setHeader("Retry-After", String(lim.json.retry_after_s)); return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." }); }
    if (!a.ok || !b.ok) return res.status(503).json({ error: "Try again shortly." });

    // q (above): the newest code we sent to this number in the last 15 minutes
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

    // Account step. No Supabase phone/SMS provider is involved: the user is a normal email user with an internal synthetic email.
    const tmp = id.tempPassword();
    let uid = row.user_id, email, grant = null;
    if (row.purpose === "signup") {
      email = id.syntheticEmail(phone);
      const c = await id.createUser(email, tmp, { signup_method: "phone_otp" });
      if (!c.ok || !c.json.id) { await audit("otp.account_failed", row.otp_id, { purpose: "signup", status: c.status }); return res.status(500).json({ error: "We couldn't finish creating your account." }); }
      uid = c.json.id;
      // link the number and mint the session at the same time; if the link loses a race the session is discarded and the user removed
      const [link, tok] = await Promise.all([supa("/rest/v1/phone_identities", { method: "POST", body: { phone, user_id: uid } }), id.passwordGrant(email, tmp)]);
      if (!link.ok) { await id.deleteUser(uid); await audit("otp.account_failed", row.otp_id, { purpose: "signup", step: "link" }); return res.status(409).json({ error: "This number already has an account. Sign in instead." }); }
      grant = tok;
    } else {
      if (!uid) return res.status(400).json({ error: "Something went wrong." });
      const cur = await id.getUser(uid);
      if (!cur.ok) { await audit("otp.account_failed", row.otp_id, { purpose: "reset", step: "lookup" }); return res.status(500).json({ error: "We couldn't finish. Try again." }); }
      email = cur.json.email || id.syntheticEmail(phone);
      const u = await id.updateUser(uid, { password: tmp, email_confirm: true, ...(cur.json.email ? {} : { email }) });
      if (!u.ok) { await audit("otp.account_failed", row.otp_id, { purpose: "reset", step: "update" }); return res.status(500).json({ error: "We couldn't finish. Try again." }); }
      await supa("/rest/v1/phone_identities", { method: "POST", body: { phone, user_id: uid }, headers: { Prefer: "resolution=ignore-duplicates" } }); // legacy users gain an identity row
    }
    const [t] = await Promise.all([
      grant ? Promise.resolve(grant) : id.passwordGrant(email, tmp),
      supa(`/rest/v1/sasusync_otp_requests?otp_id=eq.${encodeURIComponent(row.otp_id)}`, { method: "PATCH", body: { user_id: uid } }),
      audit("otp.verified", row.otp_id, { purpose: row.purpose, phone: maskPhone(phone) }, uid),
    ]);
    if (!t.ok || !t.json.access_token) return res.status(502).json({ error: "Your number is verified, but we couldn't sign you in. Try signing in." });
    // phone verification is NOT identity/KYC verification; it only proves control of the number
    return res.status(200).json({ ok: true, purpose: row.purpose, session: id.sessionOf(t.json) });
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
