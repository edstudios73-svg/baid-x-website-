// Read-only balance + sender reads. These spend nothing. Capacity numbers come from the provider, never hard-coded.
const { request } = require("./client");
const { cfg, configured } = require("./config");

async function getBalance() {
  const r = (await request("/api/v1/balance")).json;
  const credits = Number(r.sms_credits), otp = Number(r.otp_sendable), sms = Number(r.sms_sendable);
  let level = "OK";
  if (sms === 0 || otp === 0) level = "EXHAUSTED"; else if (otp < 20 || sms < 50) level = "LOW";
  return { smsCredits: credits, smsSendable: sms, otpSendable: otp, otpVoiceSendable: Number(r.otp_voice_sendable), creditsPerOtp: r.rates && r.rates.otp_sms_credits !== undefined ? Number(r.rates.otp_sms_credits) : null, currency: r.currency || null, mainBalance: r.main_balance === undefined ? null : String(r.main_balance), level };
}
async function getSenderStatus(name) {
  const n = name || cfg().sender;
  const r = (await request(`/sender/id/status?sender_name=${encodeURIComponent(n)}`)).json;
  const raw = String(r.status || r.sender_status || "unknown").toLowerCase();
  return { sender: n, status: ["pending", "approved", "rejected", "not_found"].includes(raw) ? raw : "unknown", reason: r.reason || r.rejection_reason || null };
}
module.exports = { getBalance, getSenderStatus, configured };
