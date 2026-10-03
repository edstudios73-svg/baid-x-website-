// SMS sending. Sandbox endpoint unless live is explicitly allowed. job_id is always stored/returned as a STRING.
const { cfg, liveAllowed, configured, requireLive } = require("./config");
const { request } = require("./client");
const { SasuError } = require("./errors");
const { normalizeGhanaPhone } = require("./phone");

async function sendSms({ to, message, metadata }, deps = {}) {
  if (!configured()) throw new SasuError("NOT_CONFIGURED", 0, "provider credentials missing");
  const phone = normalizeGhanaPhone(to);
  if (!phone) throw new SasuError("BAD_PHONE", 0, "invalid recipient");
  if (typeof message !== "string" || !message.trim() || message.length > 650) throw new SasuError("BAD_MESSAGE", 0, "message must be 1-650 characters");
  if (cfg().mode === "live") requireLive("Live SMS");   // live requested but not approved: refuse, never fall back to sandbox
  const live = liveAllowed();
  const path = live ? "/api/v1/send" : "/smssandbox/v1/send";
  const body = { sender: cfg().sender, recipients: [phone], message };
  if (metadata && typeof metadata === "object") body.metadata = metadata;
  const r = await request(path, { method: "POST", body, resendOnNetworkError: !live, ...deps });
  const j = r.json, d = j.data || {};
  const queued = j.queued === true;
  return {
    mode: live ? "live" : "sandbox",
    accepted: j.success === true,
    queued,                                        // accepted-not-error; never resend
    jobId: d.job_id === undefined || d.job_id === null ? null : String(d.job_id),
    status: d.status || null,
    deducted: j.balance && j.balance.deducted !== undefined ? j.balance.deducted : null, // trust the provider's number
    remaining: j.balance && j.balance.remaining !== undefined ? j.balance.remaining : null,
  };
}

// Poll delivery state. delivery_status is "the one field to read".
async function smsStatus(jobId) {
  const r = await request(`/api/v1/status/${encodeURIComponent(String(jobId))}`);
  const j = r.json;
  return { deliveryStatus: j.delivery_status || "unknown", sandbox: j.sandbox === true, messages: Array.isArray(j.messages) ? j.messages.map((m) => ({ messageId: String(m.message_id), status: m.status })) : [] };
}
module.exports = { sendSms, smsStatus };
