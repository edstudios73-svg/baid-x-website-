// Parses a signed webhook body into a normalised event, or null when it is not one we can apply (ignored, still acknowledged).
const STATUSES = new Set(["sent", "delivered", "failed", "expired"]);
function parseEvent(obj) {
  if (!obj || typeof obj !== "object") return null;
  const d = obj.data;
  if (!d || typeof d !== "object") return null;
  const status = String(d.status || obj.event || "").toLowerCase();
  const messageId = d.message_id === undefined || d.message_id === null ? "" : String(d.message_id);
  const ts = obj.timestamp ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(obj.timestamp)) ? obj.timestamp : `${obj.timestamp}Z`) : null; // provider timestamps carry no zone: treat as UTC
  if (!messageId || !STATUSES.has(status) || !ts || Number.isNaN(ts.getTime())) return null;
  return { messageId, status, timestamp: ts.toISOString(), recipient: typeof d.recipient === "string" ? d.recipient : null };
}
module.exports = { parseEvent };
