// Zend webhook helpers. Zend signs every delivery to a dashboard endpoint:
//   X-Zend-Signature-256: sha256=<hex HMAC-SHA256 of `${X-Zend-Timestamp}.${raw body}`, keyed by the endpoint's signing secret>
//   X-Zend-Timestamp: Unix milliseconds. Events: message.sent | message.delivered | message.failed | message.read (WhatsApp).
// Nothing here logs a body or a secret.
const crypto = require("crypto");

const MAX_BODY_BYTES = 256 * 1024;

// Reads the request's exact bytes from the stream (Vercel's body parser is switched off for the webhook route).
function readRawBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded === true) {
      const b = req.body;
      if (Buffer.isBuffer(b)) return resolve(b);
      if (typeof b === "string") return resolve(Buffer.from(b, "utf8"));
      return reject(Object.assign(new Error("body already consumed"), { code: "PARSED" }));
    }
    const chunks = []; let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" })); try { req.destroy(); } catch { /* closed */ } return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const one = (v) => (Array.isArray(v) ? v[0] : v);
const expectedSignature = (rawBody, timestamp, secret) => crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
function signatureMatches(rawBody, secret, sigHeader, tsHeader) {
  const sig = one(sigHeader), ts = one(tsHeader);
  if (!secret || typeof sig !== "string" || typeof ts !== "string" || !/^\d{10,16}$/.test(ts.trim())) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(sig.trim());
  if (!m) return false;
  const a = Buffer.from(expectedSignature(rawBody, ts.trim(), secret), "hex"), b = Buffer.from(m[1].toLowerCase(), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b); // equal lengths checked first; constant-time
}

// A signed body -> the state we keep (sent | delivered | failed). "read" means it was delivered; null = acknowledge and ignore.
const STATE = { sent: "sent", delivered: "delivered", read: "delivered", failed: "failed" };
function parseEvent(obj, tsHeader) {
  if (!obj || typeof obj !== "object") return null;
  const ev = String(obj.event || "").toLowerCase().replace(/^message\./, "");
  const status = STATE[ev] || STATE[String(obj.status || "").toLowerCase()];
  const messageId = obj.message_id === undefined || obj.message_id === null ? "" : String(obj.message_id);
  const raw = obj.timestamp || obj.delivered_at || (one(tsHeader) && Number(one(tsHeader)));
  const ts = raw ? new Date(typeof raw === "number" || /^\d+$/.test(String(raw)) ? Number(raw) : /[zZ]|[+-]\d\d:?\d\d$/.test(String(raw)) ? raw : `${raw}Z`) : null;
  if (!messageId || !/^[A-Za-z0-9_.:-]{1,100}$/.test(messageId) || !status || !ts || Number.isNaN(ts.getTime())) return null;
  const to = typeof obj.to === "string" ? obj.to : typeof obj.recipient === "string" ? obj.recipient : null;
  return { messageId, status, timestamp: ts.toISOString(), recipient: to, channel: typeof obj.channel === "string" ? obj.channel : null };
}
module.exports = { readRawBody, signatureMatches, expectedSignature, parseEvent, MAX_BODY_BYTES };
