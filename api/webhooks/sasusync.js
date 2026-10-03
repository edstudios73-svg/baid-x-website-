// POST /api/webhooks/sasusync   (the URL to enter in the SasuSync portal)
// STAGE 0: secure receiving infrastructure only. It verifies the signature on the raw body and acknowledges.
// It does not store, process or act on events yet. It fails closed until SASUSYNC_WEBHOOK_SECRET exists.
const { readRawBody, signatureMatches } = require("../_lib/sasusync-webhook");

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

  try { JSON.parse(raw.toString("utf8")); }
  catch { return res.status(400).end(); } // signed but not JSON: nothing is logged about the body

  // Stage 0 stops here: acknowledge within SasuSync's 10 second window. No storage, no business processing.
  return res.status(200).json({ received: true });
};

// The signature covers the exact bytes, so Vercel must not parse the body first.
module.exports.config = { api: { bodyParser: false } };
