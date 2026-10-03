// POST /api/webhooks/sasusync   (the URL to enter in the SasuSync portal)
// Verifies the signature on the raw body, then records the delivery state (idempotent, newest event timestamp wins).
// Fails closed until SASUSYNC_WEBHOOK_SECRET exists. Nothing from the body is logged.
const { readRawBody, signatureMatches } = require("../_lib/sasusync-webhook");
const { parseEvent } = require("../_lib/sasusync/webhook-events");
const { rpc } = require("../_lib/sasusync/route");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }

  const secret = process.env.SASUSYNC_WEBHOOK_SECRET;
  if (!secret) return res.status(503).end(); // not configured yet: never accept unsigned traffic

  const type = String(req.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("application/json")) return res.status(415).end();

  let raw;
  try { raw = await readRawBody(req); }
  catch (e) { return res.status(e && e.code === "TOO_LARGE" ? 413 : 400).end(); }

  if (!signatureMatches(raw, secret, req.headers["x-webhook-signature"])) return res.status(401).end();

  let obj;
  try { obj = JSON.parse(raw.toString("utf8")); }
  catch { return res.status(400).end(); } // signed but not JSON: nothing is logged about the body

  const ev = parseEvent(obj);
  if (!ev) return res.status(200).json({ received: true, ignored: true }); // unknown shape / no message_id: acknowledge, apply nothing
  try {
    const r = await rpc("sasusync_apply_event", { p_message_id: ev.messageId, p_status: ev.status, p_ts: ev.timestamp, p_recipient: ev.recipient });
    if (!r.ok) return res.status(500).end(); // storage failed: non-2xx so the provider may redeliver
    return res.status(200).json({ received: true, result: r.json });
  } catch { return res.status(500).end(); }
};

// The signature covers the exact bytes, so Vercel must not parse the body first.
module.exports.config = { api: { bodyParser: false } };
