// POST /api/paystack-initialize  { reference }
// The amount is read from the database for a payment the signed-in user already created. The browser never sends an amount.
const { configured, supa, paystack } = require("./_lib/paystack");

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

    const q = await supa(`/rest/v1/billing_payments?provider_reference=eq.${reference}&user_id=eq.${u.json.id}&status=eq.pending&select=id,expected_amount_minor,currency,purpose,target`);
    const pay = q.json?.[0];
    if (!pay) return res.status(404).json({ error: "Checkout not found." });

    const body = { email: u.json.email, amount: pay.expected_amount_minor, currency: pay.currency, reference, callback_url: `${req.headers.origin || "https://baid-x-website.vercel.app"}/#/billing`, metadata: { baidx_payment: pay.id, purpose: pay.purpose } };
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
