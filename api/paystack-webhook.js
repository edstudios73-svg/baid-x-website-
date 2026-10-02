// POST /api/paystack-webhook  (set this URL in the Paystack dashboard)
// 1 verify signature on the RAW body  2 dedupe  3 verify with Paystack  4 hand to the database function that checks
// amount/currency/reference and activates. Replies 200 once handled so Paystack stops retrying; 5xx makes it retry.
const { configured, env, validSignature, readRaw, rpc, paystack, dedupeKey } = require("./_lib/paystack");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  if (!configured()) return res.status(503).end();
  const raw = await readRaw(req);
  if (!validSignature(raw, req.headers["x-paystack-signature"], env().secret)) return res.status(401).end();
  let ev; try { ev = JSON.parse(raw); } catch { return res.status(400).end(); }
  const d = ev.data || {};
  const key = dedupeKey(ev);
  try {
    let out;
    if (ev.event === "charge.success") {
      // defence in depth: ask Paystack, not just the webhook body, whether this charge really succeeded
      const v = await paystack(`/transaction/verify/${encodeURIComponent(d.reference)}`);
      const t = v.json?.data;
      if (!v.ok || t?.status !== "success") { await rpc("billing_apply_event", { p_type: "charge.unverified", p_dedupe_key: key, p_subscription_code: null, p_reference: d.reference || null, p_amount_minor: null, p_payload: { event: ev.event } }); return res.status(200).end(); }
      const r = await rpc("billing_apply_charge", { p_reference: t.reference, p_amount_minor: t.amount, p_currency: t.currency, p_tx_id: String(t.id), p_customer_code: t.customer?.customer_code || null, p_auth_code: t.authorization?.authorization_code || null, p_dedupe_key: key, p_payload: { event: ev.event, reference: t.reference, amount: t.amount, currency: t.currency } });
      if (!r.ok) return res.status(500).end();
      out = r.json;
    } else {
      const sub = d.subscription?.subscription_code || d.subscription_code || null;
      const r = await rpc("billing_apply_event", { p_type: ev.event, p_dedupe_key: key, p_subscription_code: sub, p_reference: d.transaction?.reference || d.transaction_reference || d.reference || null, p_amount_minor: d.amount ?? null, p_payload: { event: ev.event, data: { customer: { customer_code: d.customer?.customer_code }, plan: { plan_code: d.plan?.plan_code } } } });
      if (!r.ok) return res.status(500).end();
      out = r.json;
    }
    return res.status(200).json({ ok: true, result: out });
  } catch {
    return res.status(500).end(); // Paystack will retry; the database makes retries harmless
  }
};
// Paystack's signature covers the raw bytes, so the body must not be parsed first.
module.exports.config = { api: { bodyParser: false } };
