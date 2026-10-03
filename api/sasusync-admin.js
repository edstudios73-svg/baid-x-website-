// POST /api/sasusync-admin { action: "status" | "refresh" } — staff only. Reads provider capacity and sender status (read-only,
// spends no credits) and caches a safe summary in platform_settings.sasusync_health. Never returns keys, secrets or codes.
const { cfg, configured, liveAllowed } = require("./_lib/sasusync/config");
const { getBalance, getSenderStatus } = require("./_lib/sasusync/balance");
const { adminCan, supa, rpc, audit, maskPhone } = require("./_lib/sasusync/route");
const { sendSandboxSms, smsStatus } = require("./_lib/sasusync/sms");
const { normalizeGhanaPhone } = require("./_lib/sasusync/phone");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!token) return res.status(401).json({ error: "Sign in again." });
    const ov = await supa("/rest/v1/rpc/admin_sms_overview", { method: "POST", body: {}, token }); // fails unless an active admin
    if (!ov.ok) return res.status(403).json({ error: "Not allowed." });
    const act = req.body && req.body.action;
    if (act === "sandbox_test") {
      // Staff-only sandbox SMS test. Needs finance:ADMINISTER (same gate as the Paystack admin), SASUSYNC_MODE exactly "sandbox",
      // and an explicit sandbox_test:true in the request. Only /smssandbox/v1/send can be reached: nothing is delivered or charged.
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      if (process.env.SASUSYNC_MODE !== "sandbox") return res.status(409).json({ error: "Sandbox tests only run while SASUSYNC_MODE is sandbox." });
      if (req.body.sandbox_test !== true) return res.status(400).json({ error: "This must be flagged as a sandbox test." });
      const phone = normalizeGhanaPhone(req.body.to);
      if (!phone) return res.status(400).json({ error: "Enter a valid Ghana mobile number." });
      const label = "SANDBOX — NO DELIVERY";
      try {
        const r = await sendSandboxSms({ to: phone, message: "BAID X sandbox test message" });
        await audit("sms.sandbox_test", r.jobId, { to: maskPhone(phone), queued: r.queued, success: r.accepted });
        return res.status(200).json({ result: label, success: r.accepted, queued: r.queued, job_id: r.jobId, status: r.status, delivered: false, charged: false });
      } catch (e) {
        await audit("sms.sandbox_test_failed", null, { to: maskPhone(phone), kind: e && e.kind });
        return res.status(200).json({ result: label, success: false, error_category: (e && e.kind) || "ERROR", http_status: (e && e.status) || 0, delivered: false, charged: false });
      }
    }
    if (act === "sms_status") {
      // Read-only reconciliation: asks the provider's status endpoint (free, GET) which message_id(s) belong to a send's job_id,
      // then shows what our webhook-fed table and notification log already hold for them. Changes nothing, spends nothing.
      const jobId = String((req.body && req.body.job_id) || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return res.status(400).json({ error: "Enter a valid job id." });
      if (!configured()) return res.status(503).json({ error: "Provider not configured." });
      try {
        const st = await smsStatus(jobId);
        const ids = st.messages.map((m) => m.messageId).filter((m) => /^[A-Za-z0-9_-]{1,64}$/.test(m));
        const states = ids.length ? await supa(`/rest/v1/sasusync_message_state?message_id=in.(${ids.join(",")})&select=message_id,status,event_ts,events_seen`) : { ok: true, json: [] };
        const logs = await supa(`/rest/v1/notification_logs?provider_ref=eq.${encodeURIComponent(jobId)}&channel=eq.sms&select=id,status,created_at&limit=5`);
        return res.status(200).json({ job_id: jobId, delivery_status: st.deliveryStatus, sandbox: st.sandbox,
          messages: st.messages.map((m) => ({ message_id: m.messageId, provider_status: m.status, webhook_state: ((states.json || []).find((x) => x.message_id === m.messageId) || {}).status || null })),
          matched_log: Array.isArray(logs.json) && logs.json[0] ? { id: logs.json[0].id, status: logs.json[0].status } : null });
      } catch (e) { return res.status(200).json({ job_id: jobId, error_category: (e && e.kind) || "ERROR", http_status: (e && e.status) || 0 }); }
    }
    const out = { configured: configured(), mode: cfg().mode, live_allowed: liveAllowed(), sender_id: cfg().sender || null, phone_auth: cfg().phoneAuth, overview: ov.json, capacity: null, sender: null, error: null };
    if ((req.body && req.body.action) === "refresh" && configured()) {
      const finance = await adminCan(req, "finance:ADMINISTER");
      try {
        const [b, s] = await Promise.all([getBalance(), getSenderStatus()]);
        out.capacity = { sms_sendable: b.smsSendable, otp_sendable: b.otpSendable, credits_per_otp: b.creditsPerOtp, sms_credits: b.smsCredits, level: b.level, ...(finance ? { main_balance: b.mainBalance, currency: b.currency } : {}) };
        out.sender = s;
        await supa("/rest/v1/platform_settings?key=eq.sasusync_health", { method: "PATCH", headers: { Prefer: "return=representation" }, body: { value: { checked_at: new Date().toISOString(), level: b.level, sender_status: s.status, otp_sendable: b.otpSendable, sms_sendable: b.smsSendable, last_success_at: new Date().toISOString() } } }).then(async (r) => {
          if (r.ok && Array.isArray(r.json) && r.json.length) return;
          await supa("/rest/v1/platform_settings", { method: "POST", body: { key: "sasusync_health", value: { checked_at: new Date().toISOString(), level: b.level, sender_status: s.status } }, headers: { Prefer: "resolution=merge-duplicates" } });
        });
      } catch (e) { out.error = { kind: e && e.kind || "ERROR", status: e && e.status || 0 }; }
    }
    return res.status(200).json(out);
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
