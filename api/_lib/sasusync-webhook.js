// SasuSync webhook helpers (Stage 0: receiving infrastructure only).
// Nothing here calls SasuSync, stores anything, or logs a body or a secret.
const crypto = require("crypto");

const MAX_BODY_BYTES = 256 * 1024; // webhook payloads are tiny; refuse anything unreasonable

// Reads the request's exact bytes. The stream is read before anything touches req.body, so no parser can
// re-encode the payload. (A body someone already buffered is accepted as-is; a parsed object is refused.)
function readRawBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === "string") return resolve(Buffer.from(req.body, "utf8"));
    if (req.body && typeof req.body === "object") return reject(Object.assign(new Error("body already parsed"), { code: "PARSED" }));
    const chunks = []; let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" })); try { req.destroy(); } catch { /* already closed */ } return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// PROVIDER-SPECIFIC DETAIL, ISOLATED HERE.
// Documented by SasuSync: header `X-Webhook-Signature` = hex HMAC-SHA256 of the exact request body, keyed by the signing secret.
// STILL UNCONFIRMED (the docs show no sample header value): letter case of the hex, and whether any prefix is added.
// We therefore accept exactly 64 hex characters (either case, since hex case carries no meaning) and nothing else.
// If SasuSync's real header differs, change ONLY this function.
function expectedSignature(rawBody, secret) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}
function parseSignatureHeader(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[0-9a-fA-F]{64}$/.test(s) ? s.toLowerCase() : null;
}
function signatureMatches(rawBody, secret, headerValue) {
  const got = parseSignatureHeader(headerValue);
  if (!got || !secret) return false;
  const a = Buffer.from(expectedSignature(rawBody, secret), "hex"), b = Buffer.from(got, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b); // constant-time
}

module.exports = { readRawBody, signatureMatches, expectedSignature, parseSignatureHeader, MAX_BODY_BYTES };
