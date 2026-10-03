// POST /api/sasusync-admin { action: "status" | "refresh" } — staff only. Reads provider capacity and sender status (read-only,
// spends no credits) and caches a safe summary in platform_settings.sasusync_health. Never returns keys, secrets or codes.
const { cfg, configured, liveAllowed } = require("./_lib/sasusync/config");
const { sendSms } = require("./_lib/sasusync/sms");
const { getBalance, getSenderStatus } = require("./_lib/sasusync/balance");
const { adminCan, supa, rpc, audit, maskPhone } = require("./_lib/sasusync/route");
const { sendSandboxSms, smsStatus } = require("./_lib/sasusync/sms");
const { ROLES, cleanText, plan, execute: execBroadcast } = require("./_lib/sasusync/broadcast");
const { validateTemplate } = require("./_lib/sasusync/templates");
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
    if (act === "sms_broadcast") {
      // Admin SMS announcement to registered users (all, or by role). Staff only (finance:ADMINISTER: it spends credits).
      // Two steps: dry_run returns the exact recipient count and credit cost; the send then needs the typed confirmation, the same
      // recipient count back (so a changed audience is never sent blind), a unique request_id (double-submit safe), enough credit
      // to cover it while keeping an OTP reserve, and the caps below. Chunks are sent in order, each attempted ONCE (never resent).
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const roles = Array.isArray(req.body.roles) ? req.body.roles.filter((r) => ROLES.includes(r)) : [];
      if (Array.isArray(req.body.roles) && roles.length !== req.body.roles.length) return res.status(400).json({ error: "Unknown role." });
      const t = cleanText(req.body.message); if (t.error) return res.status(400).json({ error: t.error });
      if (!configured()) return res.status(503).json({ error: "SMS provider is not configured." });
      if (cfg().mode === "live" && !liveAllowed()) return res.status(409).json({ error: "Live sending is not enabled." });
      let pl; try { pl = await plan(roles, t.message, t.parts); } catch (e) { return res.status(200).json({ result: liveAllowed() ? "LIVE — REAL SMS" : "SANDBOX — NO DELIVERY", error_category: (e && e.kind) || "ERROR", note: "Couldn't read the balance, so nothing was sent." }); }
      if (pl.error) return res.status(503).json({ error: pl.error });
      const { preview, aud, label } = pl, n = aud.list.length;
      if (req.body.dry_run === true) return res.status(200).json({ ...preview, dry_run: true });

      if (req.body.confirm !== "SEND SMS BROADCAST") return res.status(400).json({ error: "Sending needs explicit confirmation." });
      if (!/^[0-9a-f-]{36}$/i.test(String(req.body.request_id || ""))) return res.status(400).json({ error: "Missing request id." });
      if (n === 0) return res.status(409).json({ error: "No recipients with a phone number." });
      if (req.body.expected_recipients !== n) return res.status(409).json({ error: "The audience changed. Preview again.", ...preview });
      if (!preview.within_limit) return res.status(409).json({ error: `Too many recipients (limit ${preview.max_recipients}).`, ...preview });
      if (!preview.enough_credit) return res.status(409).json({ error: "Not enough SMS credit (an OTP reserve is kept).", ...preview });
      const me = await supa("/auth/v1/user", { token });
      const actor = me.ok && me.json && me.json.id ? me.json.id : "unknown";
      const [la, lg] = await Promise.all([rpc("rl_hit", { p_key: `sms:broadcast:a:${actor}`, p_window_s: 3600, p_max: 5 }), rpc("rl_hit", { p_key: "sms:broadcast:all", p_window_s: 86400, p_max: 10 })]);
      if (!la.ok || !lg.ok) return res.status(503).json({ error: "Try again shortly." });
      if (la.json.allowed === false || lg.json.allowed === false) return res.status(429).json({ error: "Broadcast limit reached. Try again later." });

      const r = await execBroadcast({ roles, message: t.message, parts: t.parts, list: aud.list, requestId: req.body.request_id, actor });
      if (r.duplicate) return res.status(409).json({ error: "This broadcast was already submitted." });
      await audit("sms.broadcast", r.bid, { recipients: n, accepted: r.accepted, status: r.status, roles, parts: t.parts, mode: r.live ? "live" : "sandbox", credits: r.credits }, actor);
      return res.status(200).json({ result: label, broadcast_id: r.bid, status: r.status, recipients: n, accepted: r.accepted, credits_used: r.credits, error_category: r.error, ...(r.error && r.accepted < n ? { note: r.accepted ? "Some messages went out before it stopped. Nothing was resent." : "Nothing was sent." } : {}) });
    }
    if (act === "sms_schedule") {
      // Schedule an announcement (SMS and/or in-app) for later. The audience is re-resolved when it runs, and the run re-checks the
      // sender, credit, reserve and size limits, so a scheduled send can never overspend. Staff only (finance:ADMINISTER).
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const roles = Array.isArray(req.body.roles) ? req.body.roles.filter((r) => ROLES.includes(r)) : [];
      if (Array.isArray(req.body.roles) && roles.length !== req.body.roles.length) return res.status(400).json({ error: "Unknown role." });
      const when = new Date(req.body.run_at), ms = when.getTime() - Date.now();
      if (Number.isNaN(ms) || ms < 60 * 1000 || ms > 90 * 86400 * 1000) return res.status(400).json({ error: "Pick a time between 1 minute and 90 days from now." });
      const sms = req.body.sms === true, ia = req.body.in_app && typeof req.body.in_app === "object" ? req.body.in_app : null;
      if (!sms && !ia) return res.status(400).json({ error: "Choose SMS, in-app, or both." });
      if (sms && req.body.confirm !== "SCHEDULE SMS") return res.status(400).json({ error: "Scheduling an SMS needs explicit confirmation." });
      if (ia && (String(ia.title || "").trim().length < 2 || String(ia.body || "").trim().length < 2)) return res.status(400).json({ error: "Write a title and a message." });
      let t = { message: null, parts: 0 };
      if (sms) { t = cleanText(req.body.message); if (t.error) return res.status(400).json({ error: t.error }); if (cfg().mode === "live" && !liveAllowed()) return res.status(409).json({ error: "Live sending is not enabled." }); }
      const me = await supa("/auth/v1/user", { token }), actor = me.ok && me.json && me.json.id ? me.json.id : null;
      const lim = await rpc("rl_hit", { p_key: `sms:schedule:${actor || "x"}`, p_window_s: 86400, p_max: 20 });
      if (!lim.ok) return res.status(503).json({ error: "Try again shortly." }); if (lim.json.allowed === false) return res.status(429).json({ error: "Too many scheduled messages today." });
      const channels = ["in_app", ...(sms ? ["sms"] : [])];
      const payload = { roles, sms, message: t.message, parts: t.parts, in_app: ia ? { title: String(ia.title).trim().slice(0, 100), body: String(ia.body).trim().slice(0, 1000), href: ia.href ? String(ia.href).slice(0, 200) : null } : null, channels, estimate_recipients: Number.isInteger(req.body.expected_recipients) ? req.body.expected_recipients : null };
      const ins = await supa("/rest/v1/sms_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: { kind: "broadcast", run_at: when.toISOString(), payload, created_by: actor } });
      if (!ins.ok || !Array.isArray(ins.json) || !ins.json[0]) return res.status(500).json({ error: "Couldn't schedule it." });
      await audit("sms.scheduled", ins.json[0].id, { run_at: when.toISOString(), roles, sms, in_app: !!ia }, actor);
      return res.status(200).json({ ok: true, job_id: ins.json[0].id, run_at: when.toISOString(), sms, in_app: !!ia });
    }
    if (act === "sms_job_cancel") {
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const id = String(req.body.job_id || ""); if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Bad job id." });
      const r = await supa(`/rest/v1/sms_jobs?id=eq.${id}&status=eq.queued&kind=eq.broadcast`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: "cancelled", finished_at: new Date().toISOString() } });
      if (!r.ok || !Array.isArray(r.json) || !r.json.length) return res.status(409).json({ error: "It already ran, is running, or was cancelled." });
      await audit("sms.schedule_cancelled", id, {}); return res.status(200).json({ ok: true });
    }
    if (act === "sms_automation_save") {
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const role = req.body.role; if (!ROLES.includes(role)) return res.status(400).json({ error: "Unknown role." });
      const bad = validateTemplate(req.body.template); if (bad) return res.status(400).json({ error: bad });
      if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "Say whether it is on or off." });
      const me = await supa("/auth/v1/user", { token });
      const r = await supa(`/rest/v1/sms_automations?role=eq.${role}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { template: String(req.body.template).trim(), enabled: req.body.enabled, updated_at: new Date().toISOString(), updated_by: me.ok && me.json ? me.json.id : null } });
      if (!r.ok || !Array.isArray(r.json) || !r.json.length) return res.status(500).json({ error: "Couldn't save." });
      await audit("sms.automation_saved", role, { enabled: req.body.enabled }); return res.status(200).json({ ok: true });
    }
    if (act === "sms_automations_master") {
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "Say whether it is on or off." });
      const r = await supa("/rest/v1/platform_settings?key=eq.sms_automations_enabled", { method: "PATCH", headers: { Prefer: "return=representation" }, body: { value: req.body.enabled } });
      if (!r.ok || !Array.isArray(r.json) || !r.json.length) return res.status(500).json({ error: "Couldn't save." });
      await audit("sms.automations_master", null, { enabled: req.body.enabled }); return res.status(200).json({ ok: true, enabled: req.body.enabled });
    }
    if (act === "live_test") {
      // ONE real SMS per click. Needs: finance:ADMINISTER, live mode + sender-approved env, an explicit live_test flag and typed
      // confirmation, the provider itself reporting the sender as approved, credit available, and the per-admin/global caps below.
      // Single attempt only (retries: 0): a failure is never resent. The message is fixed and is never echoed back.
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      if (!liveAllowed()) return res.status(409).json({ error: "Live sending is not enabled." });
      if (req.body.live_test !== true || req.body.confirm !== "SEND ONE LIVE SMS") return res.status(400).json({ error: "Live test needs explicit confirmation." });
      const phone = normalizeGhanaPhone(req.body.to);
      if (!phone) return res.status(400).json({ error: "Enter a valid Ghana mobile number." });
      const me = await supa("/auth/v1/user", { token });
      const actor = me.ok && me.json && me.json.id ? me.json.id : "unknown";
      const a = await rpc("rl_hit", { p_key: `sms:livetest:a:${actor}`, p_window_s: 3600, p_max: 3 });
      const g = await rpc("rl_hit", { p_key: "sms:livetest:all", p_window_s: 86400, p_max: 10 });
      if (!a.ok || !g.ok) return res.status(503).json({ error: "Try again shortly." });
      if (a.json.allowed === false || g.json.allowed === false) return res.status(429).json({ error: "Live test limit reached. Try again later." });
      const label = "LIVE — REAL SMS";
      try {
        const [sender, bal] = await Promise.all([getSenderStatus(), getBalance()]);
        if (sender.status !== "approved") { await audit("sms.live_test_refused", null, { reason: "sender_" + sender.status }, actor); return res.status(200).json({ result: label, sent: false, error_category: "SENDER_NOT_APPROVED", sender_status: sender.status }); }
        if (!(bal.smsSendable > 0)) { await audit("sms.live_test_refused", null, { reason: "no_credit" }, actor); return res.status(200).json({ result: label, sent: false, error_category: "NO_CREDIT" }); }
        const r = await sendSms({ to: phone, message: "BAID X test message: live SMS is working." }, { retries: 0 });
        await audit("sms.live_test", r.jobId, { to: maskPhone(phone), queued: r.queued, success: r.accepted, deducted: r.deducted, remaining: r.remaining }, actor);
        return res.status(200).json({ result: label, sent: r.accepted, queued: r.queued, job_id: r.jobId, status: r.status, credits_used: r.deducted, credits_remaining: r.remaining, sandbox: r.mode === "sandbox" });
      } catch (e) {
        await audit("sms.live_test_failed", null, { to: maskPhone(phone), kind: e && e.kind }, actor);
        return res.status(200).json({ result: label, sent: false, error_category: (e && e.kind) || "ERROR", http_status: (e && e.status) || 0, note: e && (e.kind === "TIMEOUT" || e.kind === "NETWORK") ? "No response: it may still have been sent. Check the job lookup before trying again." : undefined });
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
