// Sign-in codes through Zend OTP (POST /otp/send, POST /otp/{id}/verify). BAID X never generates, stores, compares or expires
// codes: only Zend's OTP id is kept (sasusync_otp_requests.otp_id; the table keeps its old name). There is no test mode.
// Channel: SMS by default; ZEND_OTP_CHANNEL=whatsapp sends codes on WhatsApp instead.
const { cfg, requireLive } = require("./config");
const { request } = require("./client");
const { MessagingError } = require("./errors");
const { normalizeGhanaPhone } = require("./phone");

const APP = "BAID X";
const EXPIRY_MIN = 5, LENGTH = 6;

async function generateOtp({ to }) {
  requireLive("Sign-in codes");
  const phone = normalizeGhanaPhone(to);
  if (!phone) throw new MessagingError("BAD_PHONE", 0, "invalid number");
  const r = await request("/otp/send", { method: "POST", body: { phone_number: `+${phone}`, app: APP, channel: cfg().otpChannel, expiry: EXPIRY_MIN, length: LENGTH } });
  if (r.json.id === undefined || r.json.id === null) throw new MessagingError("UNEXPECTED", r.status, "no OTP id returned");
  return { otpId: String(r.json.id) };
}

// Success ONLY when Zend answers success === true. A wrong code is an answer, not an exception.
// Reasons match what the phone sign-in routes already handle: verified | wrong_code | expired | no_pending_code.
async function verifyOtp({ otpId, code }) {
  requireLive("Sign-in codes");
  if (!/^\d{4,8}$/.test(String(code || ""))) return { verified: false, reason: "wrong_code", attemptsRemaining: null };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(otpId || ""))) return { verified: false, reason: "no_pending_code", attemptsRemaining: null };
  const r = await request(`/otp/${encodeURIComponent(String(otpId))}/verify`, { method: "POST", body: { code: String(code) }, answer4xx: true });
  const j = r.json || {}, verified = r.status < 300 && j.success === true;
  const left = Number.isInteger(j.attempts_remaining) ? j.attempts_remaining : null;
  const msg = String(j.message || "").toLowerCase();
  const reason = verified ? "verified" : r.status === 404 ? "no_pending_code" : msg.includes("expire") || left === 0 ? "expired" : msg.includes("already") ? "already_verified" : "wrong_code";
  return { verified, reason, attemptsRemaining: left };
}

async function otpStatus(otpId) { requireLive("Sign-in codes"); return (await request(`/otp/${encodeURIComponent(String(otpId))}/status`)).json; }
module.exports = { generateOtp, verifyOtp, otpStatus, APP, EXPIRY_MIN };
