// POST /api/paystack-admin { action: "status" | "create_plans" }  — staff only (Super Admin with finance:ADMINISTER).
// Lets the owner check the Paystack connection and create the Paystack plans without ever exposing a key.
const { configured, env, mode, supa, rpc, paystack } = require("./_lib/paystack");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!token) return res.status(401).json({ error: "Sign in again." });
    // ask the database who this is (as them) and what they may do
    const me = await supa("/rest/v1/rpc/platform_whoami", { method: "POST", body: {}, token });
    if (!me.ok || !me.json?.can?.includes("finance:ADMINISTER")) return res.status(403).json({ error: "Not allowed." });

    const action = req.body?.action || "status";
    const plans = await supa("/rest/v1/membership_plans?select=id,role,tier,billing_interval,price_minor,currency,is_founding,paystack_plan_code");
    const list = plans.json || [];
    if (action === "status") {
      return res.status(200).json({ configured: configured(), mode: mode(), plans: list.length, plans_with_code: list.filter((p) => p.paystack_plan_code).length, webhook_url: `${req.headers.origin || "https://baid-x-website.vercel.app"}/api/paystack-webhook` });
    }
    if (action === "create_plans") {
      if (!configured()) return res.status(503).json({ error: "Paystack keys are not set." });
      let created = 0, failed = 0;
      for (const p of list.filter((x) => !x.paystack_plan_code)) {
        const name = `BAID X ${p.role} ${p.tier} ${p.billing_interval}${p.is_founding ? " founding" : ""} (${mode()})`;
        const r = await paystack("/plan", { method: "POST", body: { name, amount: p.price_minor, interval: p.billing_interval === "annual" ? "annually" : "monthly", currency: p.currency } });
        const code = r.json?.data?.plan_code;
        if (!r.ok || !code) { failed++; continue; }
        const w = await supa(`/rest/v1/membership_plans?id=eq.${p.id}&paystack_plan_code=is.null`, { method: "PATCH", body: { paystack_plan_code: code, updated_at: new Date().toISOString() } });
        if (w.ok) created++; else failed++;
      }
      await rpc("billing_apply_event", { p_type: "admin.plans_created", p_dedupe_key: `plans:${Date.now()}`, p_subscription_code: null, p_reference: null, p_amount_minor: null, p_payload: { created, failed, mode: mode() } });
      return res.status(200).json({ created, failed });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch {
    return res.status(500).json({ error: "Something went wrong." });
  }
};
