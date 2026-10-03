// Typed provider errors. Messages never contain the API key, the request body, phone numbers or OTP codes.
class SasuError extends Error {
  constructor(kind, status, detail) { super(kind); this.name = "SasuError"; this.kind = kind; this.status = status || 0; this.detail = detail ? String(detail).slice(0, 200) : ""; }
}
const kindFor = (s) => s === 400 ? "BAD_REQUEST" : s === 401 ? "AUTH" : s === 402 ? "INSUFFICIENT_CREDIT" : s === 403 ? "FORBIDDEN" : s === 404 ? "NOT_FOUND" : s === 422 ? "VALIDATION" : s === 429 ? "RATE_LIMITED" : s >= 500 ? "SERVER" : "UNEXPECTED";
module.exports = { SasuError, kindFor };
