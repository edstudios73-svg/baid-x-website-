// POST /api/webhooks/zend   (the URL to add in the Zend dashboard: Settings -> Webhooks -> Add endpoint)
// Verifies Zend's signature on the raw body, then records the delivery state (idempotent, newest event timestamp wins).
// Fails closed until ZEND_WEBHOOK_SECRET exists. Nothing from the body is logged.
const { readRawBody, signatureMatches, parseEvent } = require("../_lib/messaging/webhook");
const { rpc } = require("../_lib/messaging/route");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }

  const secret = process.env.ZEND_WEBHOOK_SECRET;
  if (!secret) return res.status(503).end(); // not configured yet: never accept unsigned traffic

  const type = String(req.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("application/json")) return res.status(415).end();

  let raw;
  try { raw = await readRawBody(req); }
  catch (e) { return res.status(e && e.code === "TOO_LARGE" ? 413 : 400).end(); }

  if (!signatureMatches(raw, secret, req.headers["x-zend-signature-256"], req.headers["x-zend-timestamp"])) return res.status(401).end();

  let obj;
  try { obj = JSON.parse(raw.toString("utf8")); }
  catch { return res.status(400).end(); }

  const ev = parseEvent(obj, req.headers["x-zend-timestamp"]);
  if (!ev) return res.status(200).json({ received: true, ignored: true }); // unknown event: acknowledge, apply nothing
  try {
    // the table and function keep their SasuSync-era names; they hold any provider's message states
    const r = await rpc("sasusync_apply_event", { p_message_id: ev.messageId, p_status: ev.status, p_ts: ev.timestamp, p_recipient: ev.recipient });
    if (!r.ok) return res.status(500).end(); // storage failed: non-2xx so Zend redelivers
    return res.status(200).json({ received: true, result: r.json });
  } catch { return res.status(500).end(); }
};

// The signature covers the exact bytes, so Vercel must not parse the body first.
module.exports.config = { api: { bodyParser: false } };
