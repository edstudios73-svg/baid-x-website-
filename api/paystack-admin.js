// POST /api/paystack-admin { action: "status" | "money" | "create_plans" }  — staff only (Super Admin with finance:ADMINISTER).
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
      // a harmless read-only call proves the secret key is accepted by Paystack (it never returns or logs the key)
      let reachable = null; if (configured()) { const ping = await paystack("/balance").catch(() => null); reachable = ping ? (ping.ok ? "ok" : ping.status === 401 ? "key_rejected" : "error") : "unreachable"; }
      return res.status(200).json({ reachable, configured: configured(), mode: mode(), plans: list.length, plans_with_code: list.filter((p) => p.paystack_plan_code).length, webhook_url: `${req.headers.origin || "https://www.baid-x.com"}/api/paystack-webhook` });
    }
    if (action === "money") {
      // what is in the Paystack account: balance, lifetime totals, transactions (newest first) and payouts to the bank
      if (!configured()) return res.status(503).json({ error: "Paystack keys are not set." });
      const page = Math.max(1, Math.min(500, parseInt(req.body?.page, 10) || 1));
      const status = ["success", "failed", "abandoned"].includes(req.body?.status) ? `&status=${req.body.status}` : "";
      const [bal, tot, tx, st] = await Promise.all([paystack("/balance"), paystack("/transaction/totals"), paystack(`/transaction?perPage=50&page=${page}${status}`), paystack("/settlement?perPage=10")]);
      if (!bal.ok && bal.status === 401) return res.status(502).json({ error: "Paystack rejected the secret key." });
      const by = (arr) => (Array.isArray(arr) ? arr.map((x) => ({ currency: x.currency, amount: x.amount ?? x.balance ?? 0 })) : []);
      return res.status(200).json({
        mode: mode(),
        balance: (bal.json?.data || []).map((b) => ({ currency: b.currency, amount: b.balance })),
        totals: tot.ok ? { count: tot.json?.data?.total_transactions || 0, volume: by(tot.json?.data?.total_volume_by_currency), pending_payout: by(tot.json?.data?.pending_transfers_by_currency) } : null,
        transactions: (tx.json?.data || []).map((t) => ({ id: t.id, ref: t.reference, amount: t.amount, currency: t.currency, status: t.status, channel: t.channel, fees: t.fees, paid_at: t.paid_at, created_at: t.created_at || t.createdAt, note: t.gateway_response })),
        page, pages: tx.json?.meta?.pageCount || 1,
        settlements: (st.json?.data || []).map((x) => ({ id: x.id, amount: x.total_amount ?? x.effective_amount, currency: x.currency, status: x.status, date: x.settlement_date || x.settled_by || x.createdAt })),
      });
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
