// OTP via SasuSync. BAID X never generates, stores, compares or expires codes: only the provider's otp_id is kept.
// There is no OTP sandbox, so every call requires live mode + approved sender (requireLive throws otherwise; no fallback).
const { cfg, requireLive } = require("./config");
const { request } = require("./client");
const { SasuError } = require("./errors");
const { normalizeGhanaPhone } = require("./phone");

const MESSAGE = "Your BAID X code is %otp_code%. It expires in 5 minutes. Never share it.";
const REASONS = new Set(["verified", "wrong_code", "expired", "no_pending_code", "already_verified"]);

async function generateOtp({ to }) {
  requireLive("OTP generation");
  const phone = normalizeGhanaPhone(to);
  if (!phone) throw new SasuError("BAD_PHONE", 0, "invalid number");
  // retries: 0 — a 429 means a code is already pending; we must not auto-generate another. Network errors are never resent.
  const r = await request("/otp/generate", { method: "POST", retries: 0, body: { number: phone, sender_id: cfg().sender, message: MESSAGE, medium: "sms", otp_type: "numeric", expiry: 5, length: 6 } });
  if (r.json.success !== true || r.json.otp_id === undefined || r.json.otp_id === null) throw new SasuError("UNEXPECTED", r.status, "no otp_id returned");
  return { otpId: String(r.json.otp_id) };
}

// Success ONLY when verified === true. The status code is not the answer; a wrong code is a 200 with verified:false.
async function verifyOtp({ otpId, code }) {
  requireLive("OTP verification");
  if (!/^\d{4,8}$/.test(String(code || ""))) return { verified: false, reason: "wrong_code", attemptsRemaining: null };
  const r = await request("/otp/verify", { method: "POST", retries: 0, body: { otp_id: /^\d+$/.test(String(otpId)) ? Number(otpId) : otpId, code: String(code) } });
  const j = r.json, verified = j.verified === true;
  const reason = verified ? "verified" : REASONS.has(j.reason) ? j.reason : "wrong_code";
  return { verified, reason, attemptsRemaining: Number.isInteger(j.attempts_remaining) ? j.attempts_remaining : null };
}

async function otpStatus(otpId) { requireLive("OTP status"); const r = await request(`/otp/status/${encodeURIComponent(String(otpId))}`); return r.json; } // response shape undocumented: returned as-is
module.exports = { generateOtp, verifyOtp, otpStatus, MESSAGE };
