// SMS and WhatsApp through Zend's POST /messages and POST /messages/bulk. One call per send, never resent (see client.js).
// WhatsApp needs an approved template; Zend tries the channels in order, so WhatsApp always falls back to SMS.
// The returned id is Zend's message id (or bulk id), kept as a STRING in notification_logs.provider_ref.
const { cfg, requireLive, channelsFor } = require("./config");
const { request } = require("./client");
const { MessagingError } = require("./errors");
const { normalizeGhanaPhone } = require("./phone");

const e164 = (canonical) => `+${canonical}`;
function checkMessage(message) {
  if (typeof message !== "string" || !message.trim() || message.length > 1600) throw new MessagingError("BAD_MESSAGE", 0, "message must be 1-1600 characters"); // Zend: 10 SMS parts
}

// One message. whatsapp: { kind: "announce" | "notify", params } tries WhatsApp first when that template is configured.
async function sendMessage({ to, message, whatsapp }) {
  requireLive("Sending");
  const phone = normalizeGhanaPhone(to);
  if (!phone) throw new MessagingError("BAD_PHONE", 0, "invalid recipient");
  checkMessage(message);
  const { channels, templateId } = channelsFor(whatsapp && whatsapp.kind, !!whatsapp);
  const body = { to: e164(phone), body: message, preferred_channels: channels };
  if (templateId) { body.template_id = templateId; body.template_params = whatsapp.params || {}; }
  if (cfg().sender) body.sender_id = cfg().sender;
  const r = await request("/messages", { method: "POST", body });
  const j = r.json;
  if (j.id === undefined || j.id === null) throw new MessagingError("UNEXPECTED", r.status, "no message id returned");
  return { mode: "live", accepted: true, queued: j.status === "pending", jobId: String(j.id), status: j.status || null, channels, estimatedCost: j.estimated_cost ?? null };
}

// Many recipients in one call (Zend: up to 10,000; one bad number rejects the whole request, so numbers are checked first).
async function sendBulk({ recipients, message, whatsapp }) {
  requireLive("Sending");
  const list = (recipients || []).map(normalizeGhanaPhone);
  if (!list.length || list.some((x) => !x)) throw new MessagingError("BAD_PHONE", 0, "invalid recipient");
  checkMessage(message);
  const { channels, templateId } = channelsFor(whatsapp && whatsapp.kind, !!whatsapp);
  const body = { messages: list.map((p) => ({ to: e164(p), body: message, ...(templateId ? { template_params: whatsapp.params || {} } : {}) })), preferred_channels: channels };
  if (templateId) body.template_id = templateId;
  const r = await request("/messages/bulk", { method: "POST", body });
  const j = r.json;
  if (j.id === undefined || j.id === null) throw new MessagingError("UNEXPECTED", r.status, "no bulk id returned");
  return { mode: "live", accepted: true, jobId: String(j.id), recipients: Number(j.recipients) || list.length, channels, estimatedCost: j.estimated_cost ?? null };
}

// Read-only: where one message or one bulk batch stands.
async function messageStatus(id) {
  const s = String(id);
  if (s.startsWith("bulk_")) {
    const j = (await request(`/messages?bulk_id=${encodeURIComponent(s)}&limit=50&offset=0`)).json;
    return { deliveryStatus: j.status || "unknown", totals: { sent: j.sent ?? null, delivered: j.delivered ?? null, failed: j.failed ?? null, pending: j.pending ?? null },
      messages: Array.isArray(j.messages) ? j.messages.map((m) => ({ messageId: String(m.id), status: m.status, channel: m.channel_used || null })) : [] };
  }
  const j = (await request(`/messages/${encodeURIComponent(s)}`)).json;
  return { deliveryStatus: j.status || "unknown", channelUsed: j.channel_used || null, messages: [{ messageId: String(j.id ?? s), status: j.status || "unknown", channel: j.channel_used || null }] };
}

// Message parts an SMS will bill: GSM-7 text is 160 (153 per part when split); anything else (emoji, curly quotes, accents) is 70 (67).
const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\r\n^{}\\[~\]|€]*$/;
function smsParts(message) {
  const m = String(message || ""), gsm = GSM.test(m), single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  return m.length === 0 ? 0 : m.length <= single ? 1 : Math.ceil(m.length / multi);
}
module.exports = { sendMessage, sendBulk, messageStatus, smsParts };
