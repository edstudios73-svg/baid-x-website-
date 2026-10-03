// GET  /api/auth/phone/start            -> { enabled }   (lets the app know whether to use phone codes)
// POST /api/auth/phone/start { phone, purpose: "signup"|"reset" } -> sends a code through SasuSync.
// Behind SASUSYNC_PHONE_AUTH (default OFF). BAID X never sees or stores the code; only the provider's otp_id is kept.
const { cfg } = require("../sasusync/config");
const { normalizeGhanaPhone, maskPhone } = require("../sasusync/phone");
const { generateOtp } = require("../sasusync/otp");
const { ip, audit, rpc, supa } = require("../sasusync/route");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return res.status(200).json({ enabled: cfg().phoneAuth });
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).end(); }
  if (!cfg().phoneAuth) return res.status(503).json({ error: "Phone sign-in isn't available yet." });
  try {
    const phone = normalizeGhanaPhone(req.body && req.body.phone);
    const purpose = req.body && req.body.purpose;
    if (!phone) return res.status(400).json({ error: "Enter a valid Ghana mobile number." });
    if (purpose !== "signup" && purpose !== "reset") return res.status(400).json({ error: "Unsupported request." });

    // rate limits: per number and per IP (fixed windows, stored in the database)
    const [a, b, existing] = await Promise.all([
      rpc("rl_hit", { p_key: `otp:start:p:${phone}`, p_window_s: 600, p_max: 3 }),
      rpc("rl_hit", { p_key: `otp:start:ip:${ip(req)}`, p_window_s: 3600, p_max: 10 }),
      rpc("auth_user_by_phone", { p_phone: phone }),
    ]);
    const lim = [a, b].find((x) => x.ok && x.json && x.json.allowed === false);
    if (lim) { res.setHeader("Retry-After", String(lim.json.retry_after_s)); return res.status(429).json({ error: "Too many attempts. Please wait a few minutes.", retry_after_s: lim.json.retry_after_s }); }
    if (!a.ok || !b.ok) return res.status(503).json({ error: "Try again shortly." });

    const userId = existing.ok && typeof existing.json === "string" ? existing.json : null;
    if (purpose === "signup" && userId) return res.status(409).json({ error: "This number already has an account. Sign in instead." });
    if (purpose === "reset" && !userId) return res.status(200).json({ ok: true, expires_in: 300 }); // no enumeration: look identical, send nothing

    // Global daily ceiling on real OTP sends (each costs credits). Counted only here, after every cheap check, so it measures actual sends.
    // Default 40/day (about 120 credits at 3 per code); the owner can change SASUSYNC_OTP_DAILY_CAP in Vercel.
    const cap = Number.isInteger(Number(process.env.SASUSYNC_OTP_DAILY_CAP)) && Number(process.env.SASUSYNC_OTP_DAILY_CAP) > 0 ? Number(process.env.SASUSYNC_OTP_DAILY_CAP) : 40;
    const day = await rpc("rl_hit", { p_key: "otp:start:all", p_window_s: 86400, p_max: cap });
    if (!day.ok) return res.status(503).json({ error: "Try again shortly." });
    if (day.json && day.json.allowed === false) { await audit("otp.daily_cap_reached", null, { cap }); return res.status(429).json({ error: "Phone codes are temporarily unavailable. Please try again later or sign up with email." }); }

    let gen;
    try { gen = await generateOtp({ to: phone }); }
    catch (e) {
      const k = e && e.kind;
      await audit("otp.start_failed", null, { kind: k, purpose, phone: maskPhone(phone) });
      if (k === "RATE_LIMITED") return res.status(429).json({ error: "A code was already sent. Enter it, or wait for it to expire before asking again." }); // never auto-generate another
      if (k === "LIVE_DISABLED" || k === "NOT_CONFIGURED") return res.status(503).json({ error: "Phone sign-in isn't available yet." });
      return res.status(502).json({ error: "We couldn't send the code. Try again shortly." });
    }
    const [ins] = await Promise.all([supa("/rest/v1/sasusync_otp_requests", { method: "POST", body: { otp_id: gen.otpId, phone, purpose, user_id: userId } }), audit("otp.started", gen.otpId, { purpose, phone: maskPhone(phone) })]);
    if (!ins.ok) return res.status(500).json({ error: "Something went wrong." });
    return res.status(200).json({ ok: true, expires_in: 300 });
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
