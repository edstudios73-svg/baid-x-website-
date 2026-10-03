// POST /api/paystack-initialize  { reference }
// The amount is read from the database for a payment the signed-in user already created. The browser never sends an amount.
const { configured, supa, rpc, paystack } = require("./_lib/paystack");

// Paystack needs a syntactically valid email. Phone sign-ups have an internal ".invalid" address, so they get a stable, valid
// placeholder (receipts are shown in the app; nothing is ever mailed to it).
const payerEmail = (u) => (u.email && !/\.invalid$/i.test(u.email) ? u.email : `payer-${String(u.id).replace(/-/g, "").slice(0, 16)}@pay.baid-x-website.vercel.app`);

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!configured()) return res.status(503).json({ error: "Payments are not switched on yet." });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    const u = await supa("/auth/v1/user", { token });
    if (!u.ok || !u.json?.id) return res.status(401).json({ error: "Please sign in again." });
    const reference = String(req.body?.reference || "");
    if (!/^BXP-[A-Z0-9]{16}$/.test(reference)) return res.status(400).json({ error: "Bad reference." });

    // Return from Paystack: confirm the charge with Paystack itself, then let the database apply it (it re-checks amount, currency
    // and reference, and ignores a charge it has already applied). This grants access even if the webhook is late or not set up.
    if (req.body?.action === "verify") {
      const own = await supa(`/rest/v1/billing_payments?provider_reference=eq.${reference}&user_id=eq.${u.json.id}&select=id,status`);
      const row = own.json?.[0];
      if (!row) return res.status(404).json({ error: "Payment not found." });
      if (["successful", "partially_refunded", "refunded"].includes(row.status)) return res.status(200).json({ status: "successful" });
      const v = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
      const t = v.json?.data;
      if (!v.ok || !t) return res.status(502).json({ status: "unknown", error: "We couldn't reach Paystack to confirm. We'll keep checking." });
      if (t.status !== "success") return res.status(200).json({ status: ["failed", "reversed"].includes(t.status) ? "failed" : "pending" });
      const r = await rpc("billing_apply_charge", { p_reference: t.reference, p_amount_minor: t.amount, p_currency: t.currency, p_tx_id: String(t.id), p_customer_code: t.customer?.customer_code || null, p_auth_code: t.authorization?.authorization_code || null, p_dedupe_key: `charge.success:${t.id}`, p_payload: { event: "charge.success", via: "return_verify", reference: t.reference, amount: t.amount, currency: t.currency } });
      if (!r.ok) return res.status(502).json({ status: "unknown", error: "Paid, but we couldn't activate it yet. It will activate shortly." });
      const after = await supa(`/rest/v1/billing_payments?id=eq.${row.id}&select=status`);
      return res.status(200).json({ status: after.json?.[0]?.status === "successful" ? "successful" : "pending" });
    }

    const q = await supa(`/rest/v1/billing_payments?provider_reference=eq.${reference}&user_id=eq.${u.json.id}&status=eq.pending&select=id,expected_amount_minor,currency,purpose,target`);
    const pay = q.json?.[0];
    if (!pay) return res.status(404).json({ error: "Checkout not found." });

    const body = { email: payerEmail(u.json), amount: pay.expected_amount_minor, currency: pay.currency, reference, callback_url: `${req.headers.origin || "https://baid-x-website.vercel.app"}/#/${pay.purpose === "wallet_deposit" ? "wallet" : "billing"}`, metadata: { baidx_payment: pay.id, purpose: pay.purpose } };
    // recurring plans: the plan code must be a plan we created for this exact BAID X plan
    if (pay.purpose === "subscription" && pay.target?.plan_id) {
      const p = await supa(`/rest/v1/membership_plans?id=eq.${pay.target.plan_id}&select=paystack_plan_code,price_minor`);
      const code = p.json?.[0]?.paystack_plan_code;
      if (code && p.json[0].price_minor === pay.expected_amount_minor) body.plan = code;
    }
    const r = await paystack("/transaction/initialize", { method: "POST", body });
    if (!r.ok || !r.json?.data?.authorization_url) return res.status(502).json({ error: "Couldn't start the payment. Nothing was charged." });
    return res.status(200).json({ authorization_url: r.json.data.authorization_url });
  } catch {
    return res.status(500).json({ error: "Something went wrong. Nothing was charged." });
  }
};
