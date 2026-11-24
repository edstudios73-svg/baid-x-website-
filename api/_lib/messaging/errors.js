// Typed provider errors. Messages never contain the API key, request bodies, phone numbers, emails or OTP codes.
// Zend has no error codes: errors are { statusCode, message, error } and differ only by message, so 400s are sorted by wording.
class MessagingError extends Error {
  constructor(kind, status, detail) { super(kind); this.name = "MessagingError"; this.kind = kind; this.status = status || 0; this.detail = scrub(detail); }
}
// Zend's messages can echo recipients ("Invalid phone numbers found: ..."): numbers and addresses are blanked before storing.
const scrub = (d) => (d ? String(d).replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]").replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]").slice(0, 200) : "");
function kindFor(status, message) {
  const m = String(message || "").toLowerCase();
  if (status === 400) {
    if (m.includes("insufficient credit")) return "INSUFFICIENT_CREDIT";
    if (m.includes("not on whatsapp")) return "NOT_ON_WHATSAPP";
    if (m.includes("sender id")) return "SENDER_NOT_APPROVED";
    if (m.includes("template")) return "TEMPLATE";
    if (m.includes("phone")) return "BAD_PHONE";
    if (m.includes("domain") || m.includes("from")) return "EMAIL_DOMAIN";
    return "BAD_REQUEST";
  }
  return status === 401 ? "AUTH" : status === 402 ? "INSUFFICIENT_CREDIT" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND"
    : status === 422 ? "VALIDATION" : status === 429 ? "RATE_LIMITED" : status >= 500 ? "SERVER" : "UNEXPECTED";
}
module.exports = { MessagingError, kindFor };
