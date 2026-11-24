// POST /api/messaging-admin — staff only. Messaging through Zend (https://tryzend.com/docs): SMS, WhatsApp (approved templates,
// SMS fallback) and email. Actions: status/refresh, live_test, message_status, sms_broadcast (any channel), sms_schedule,
// sms_job_cancel, sms_automation_save, sms_automations_master. Never returns keys, secrets, codes or full numbers.
const { cfg, configured, liveAllowed, emailReady } = require("./_lib/messaging/config");
const { request } = require("./_lib/messaging/client");
const { sendMessage, messageStatus } = require("./_lib/messaging/messages");
const { sendEmail, validEmail } = require("./_lib/messaging/email");
const { adminCan, supa, rpc, audit, maskPhone } = require("./_lib/messaging/route");
const { ROLES, CHANNELS, cleanText, cleanSubject, plan, execute: execBroadcast } = require("./_lib/messaging/broadcast");
const { validateTemplate } = require("./_lib/messaging/templates");
const { normalizeGhanaPhone } = require("./_lib/messaging/phone");

const maskEmail = (e) => String(e).replace(/^(.).*(@.*)$/, "$1***$2");
const settings = () => ({ configured: configured(), live: liveAllowed(), sender_id: cfg().sender || null, phone_auth: cfg().phoneAuth, otp_channel: cfg().otpChannel,
  whatsapp: { announce: !!cfg().wa.announce, notify: !!cfg().wa.notify }, email_from: cfg().emailFrom || null, email_ready: emailReady(), webhook_secret: !!process.env.ZEND_WEBHOOK_SECRET });

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!token) return res.status(401).json({ error: "Sign in again." });
    const ov = await supa("/rest/v1/rpc/admin_sms_overview", { method: "POST", body: {}, token }); // fails unless an active admin
    if (!ov.ok) return res.status(403).json({ error: "Not allowed." });
    const act = req.body && req.body.action;
    const actorOf = async () => { const me = await supa("/auth/v1/user", { token }); return me.ok && me.json && me.json.id ? me.json.id : null; };

    if (act === "live_test") {
      // ONE real message per click to the admin's own number or email. Needs finance:ADMINISTER, live mode, the typed
      // confirmation and the caps below. Attempted once (never resent). The message is fixed and never echoed back.
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      if (!liveAllowed()) return res.status(409).json({ error: "Live sending is not switched on (MESSAGING_LIVE)." });
      const channel = CHANNELS.includes(req.body.channel) ? req.body.channel : "sms";
      if (req.body.live_test !== true || req.body.confirm !== "SEND ONE LIVE TEST") return res.status(400).json({ error: "A live test needs explicit confirmation." });
      const phone = channel === "email" ? null : normalizeGhanaPhone(req.body.to);
      const email = channel === "email" && validEmail(req.body.to) ? String(req.body.to).trim() : null;
      if (channel === "email" ? !email : !phone) return res.status(400).json({ error: channel === "email" ? "Enter a valid email address." : "Enter a valid Ghana mobile number." });
      if (channel === "email" && !emailReady()) return res.status(409).json({ error: "Email isn't set up yet (ZEND_EMAIL_FROM on a domain verified in Zend)." });
      if (channel === "whatsapp" && !cfg().wa.announce) return res.status(409).json({ error: "WhatsApp needs an approved template (ZEND_WA_TEMPLATE_ANNOUNCE)." });
      const actor = (await actorOf()) || "unknown";
      const [a, g] = await Promise.all([rpc("rl_hit", { p_key: `sms:livetest:a:${actor}`, p_window_s: 3600, p_max: 3 }), rpc("rl_hit", { p_key: "sms:livetest:all", p_window_s: 86400, p_max: 10 })]);
      if (!a.ok || !g.ok) return res.status(503).json({ error: "Try again shortly." });
      if (a.json.allowed === false || g.json.allowed === false) return res.status(429).json({ error: "Live test limit reached. Try again later." });
      const to = channel === "email" ? maskEmail(email) : maskPhone(phone);
      try {
        const text = "BAID X test message: live messaging through Zend is working.";
        const r = channel === "email" ? await sendEmail({ to: email, subject: "BAID X test email", text, footer: "Sent from BAID X Mission Control as a test." })
          : await sendMessage({ to: phone, message: text, whatsapp: channel === "whatsapp" ? { kind: "announce", params: { message: text } } : null });
        const ref = r.jobId || r.id;
        await audit("msg.live_test", ref, { channel, to }, actor);
        return res.status(200).json({ result: "LIVE", channel, sent: true, message_id: ref, status: r.status || null, channels: r.channels || null });
      } catch (e) {
        await audit("msg.live_test_failed", null, { channel, to, kind: e && e.kind }, actor);
        return res.status(200).json({ result: "LIVE", channel, sent: false, error_category: (e && e.kind) || "ERROR", http_status: (e && e.status) || 0, note: e && (e.kind === "TIMEOUT" || e.kind === "NETWORK") ? "No response: it may still have been sent. Look it up before trying again." : undefined });
      }
    }

    if (act === "message_status") {
      // Read-only: what Zend reports for a message or bulk id, beside what our webhook table and logs hold. Spends nothing.
      const mid = String((req.body && req.body.id) || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(mid)) return res.status(400).json({ error: "Enter a valid message id." });
      if (!configured()) return res.status(503).json({ error: "Zend is not configured." });
      try {
        const st = await messageStatus(mid);
        const ids = st.messages.map((m) => m.messageId).filter((m) => /^[A-Za-z0-9_-]{1,64}$/.test(m));
        const states = ids.length ? await supa(`/rest/v1/sasusync_message_state?message_id=in.(${ids.join(",")})&select=message_id,status,event_ts,events_seen`) : { ok: true, json: [] };
        const logs = await supa(`/rest/v1/notification_logs?provider_ref=eq.${encodeURIComponent(mid)}&select=id,status,created_at&limit=5`);
        return res.status(200).json({ id: mid, delivery_status: st.deliveryStatus, channel_used: st.channelUsed || null, totals: st.totals || null,
          messages: st.messages.map((m) => ({ message_id: m.messageId, provider_status: m.status, channel: m.channel, webhook_state: ((states.json || []).find((x) => x.message_id === m.messageId) || {}).status || null })),
          matched_log: Array.isArray(logs.json) && logs.json[0] ? { id: logs.json[0].id, status: logs.json[0].status } : null });
      } catch (e) { return res.status(200).json({ id: mid, error_category: (e && e.kind) || "ERROR", http_status: (e && e.status) || 0 }); }
    }

    if (act === "sms_broadcast") {
      // Announcement to members (all, or by role) by SMS, WhatsApp (SMS fallback) or email. Staff only (finance:ADMINISTER: it costs money).
      // Two steps: dry_run returns the exact recipient count; the send then needs the typed confirmation, the same recipient count back
      // (so a changed audience is never sent blind), a unique request_id (double-submit safe) and the caps below. Each call is made once.
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const channel = req.body.channel === undefined ? "sms" : req.body.channel;
      if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Unknown channel." });
      const roles = Array.isArray(req.body.roles) ? req.body.roles.filter((r) => ROLES.includes(r)) : [];
      if (Array.isArray(req.body.roles) && roles.length !== req.body.roles.length) return res.status(400).json({ error: "Unknown role." });
      const t = cleanText(req.body.message, channel); if (t.error) return res.status(400).json({ error: t.error });
      const sj = channel === "email" ? cleanSubject(req.body.subject) : { subject: null }; if (sj.error) return res.status(400).json({ error: sj.error });
      if (!configured()) return res.status(503).json({ error: "Zend is not configured." });
      const pl = await plan(roles, t.message, t.parts, channel);
      if (pl.error) return res.status(503).json({ error: pl.error });
      const { preview, aud, label } = pl, n = aud.list.length;
      if (req.body.dry_run === true) return res.status(200).json({ ...preview, dry_run: true });

      if (!liveAllowed()) return res.status(409).json({ error: "Live sending is not switched on (MESSAGING_LIVE). Nothing was sent.", ...preview });
      if (!preview.channel_ready) return res.status(409).json({ error: channel === "email" ? "Email isn't set up yet." : "WhatsApp needs an approved template first.", ...preview });
      if (req.body.confirm !== "SEND BROADCAST") return res.status(400).json({ error: "Sending needs explicit confirmation." });
      if (!/^[0-9a-f-]{36}$/i.test(String(req.body.request_id || ""))) return res.status(400).json({ error: "Missing request id." });
      if (n === 0) return res.status(409).json({ error: channel === "email" ? "No recipients with an email address." : "No recipients with a phone number." });
      if (req.body.expected_recipients !== n) return res.status(409).json({ error: "The audience changed. Preview again.", ...preview });
      if (!preview.within_limit) return res.status(409).json({ error: `Too many recipients (limit ${preview.max_recipients}).`, ...preview });
      const actor = (await actorOf()) || "unknown";
      const [la, lg] = await Promise.all([rpc("rl_hit", { p_key: `sms:broadcast:a:${actor}`, p_window_s: 3600, p_max: 5 }), rpc("rl_hit", { p_key: "sms:broadcast:all", p_window_s: 86400, p_max: 10 })]);
      if (!la.ok || !lg.ok) return res.status(503).json({ error: "Try again shortly." });
      if (la.json.allowed === false || lg.json.allowed === false) return res.status(429).json({ error: "Broadcast limit reached. Try again later." });

      const r = await execBroadcast({ roles, message: t.message, parts: t.parts, list: aud.list, requestId: req.body.request_id, actor, channel, subject: sj.subject });
      if (r.duplicate) return res.status(409).json({ error: "This broadcast was already submitted." });
      await audit("msg.broadcast", r.bid, { channel, recipients: n, accepted: r.accepted, status: r.status, roles, parts: t.parts }, actor);
      return res.status(200).json({ result: label, broadcast_id: r.bid, channel, status: r.status, recipients: n, accepted: r.accepted, error_category: r.error, ...(r.error && r.accepted < n ? { note: r.accepted ? "Some messages went out before it stopped. Nothing was resent." : "Nothing was sent." } : {}) });
    }

    if (act === "sms_schedule") {
      // Schedule an announcement (SMS / WhatsApp / email and/or in-app) for later. The audience is re-resolved when it runs, and the run
      // re-checks live mode, channel set-up and size limits. Staff only (finance:ADMINISTER).
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const channel = req.body.channel === undefined ? "sms" : req.body.channel;
      if (!CHANNELS.includes(channel)) return res.status(400).json({ error: "Unknown channel." });
      const roles = Array.isArray(req.body.roles) ? req.body.roles.filter((r) => ROLES.includes(r)) : [];
      if (Array.isArray(req.body.roles) && roles.length !== req.body.roles.length) return res.status(400).json({ error: "Unknown role." });
      const when = new Date(req.body.run_at), ms = when.getTime() - Date.now();
      if (Number.isNaN(ms) || ms < 60 * 1000 || ms > 90 * 86400 * 1000) return res.status(400).json({ error: "Pick a time between 1 minute and 90 days from now." });
      const out = req.body.sms === true, ia = req.body.in_app && typeof req.body.in_app === "object" ? req.body.in_app : null;
      if (!out && !ia) return res.status(400).json({ error: "Choose a channel, in-app, or both." });
      if (out && req.body.confirm !== "SCHEDULE BROADCAST") return res.status(400).json({ error: "Scheduling a message needs explicit confirmation." });
      if (ia && (String(ia.title || "").trim().length < 2 || String(ia.body || "").trim().length < 2)) return res.status(400).json({ error: "Write a title and a message." });
      let t = { message: null, parts: 0 }, subject = null;
      if (out) {
        t = cleanText(req.body.message, channel); if (t.error) return res.status(400).json({ error: t.error });
        if (channel === "email") { const sj = cleanSubject(req.body.subject); if (sj.error) return res.status(400).json({ error: sj.error }); subject = sj.subject; }
      }
      const actor = await actorOf();
      const lim = await rpc("rl_hit", { p_key: `sms:schedule:${actor || "x"}`, p_window_s: 86400, p_max: 20 });
      if (!lim.ok) return res.status(503).json({ error: "Try again shortly." }); if (lim.json.allowed === false) return res.status(429).json({ error: "Too many scheduled messages today." });
      const channels = ["in_app", ...(out ? [channel] : [])];
      const payload = { roles, sms: out, channel, subject, message: t.message, parts: t.parts, in_app: ia ? { title: String(ia.title).trim().slice(0, 100), body: String(ia.body).trim().slice(0, 1000), href: ia.href ? String(ia.href).slice(0, 200) : null } : null, channels, estimate_recipients: Number.isInteger(req.body.expected_recipients) ? req.body.expected_recipients : null };
      const ins = await supa("/rest/v1/sms_jobs", { method: "POST", headers: { Prefer: "return=representation" }, body: { kind: "broadcast", run_at: when.toISOString(), payload, created_by: actor } });
      if (!ins.ok || !Array.isArray(ins.json) || !ins.json[0]) return res.status(500).json({ error: "Couldn't schedule it." });
      await audit("msg.scheduled", ins.json[0].id, { run_at: when.toISOString(), roles, channel: out ? channel : null, in_app: !!ia }, actor);
      return res.status(200).json({ ok: true, job_id: ins.json[0].id, run_at: when.toISOString(), channel: out ? channel : null, in_app: !!ia, live: liveAllowed() });
    }

    if (act === "sms_job_cancel") {
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const id = String(req.body.job_id || ""); if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Bad job id." });
      const r = await supa(`/rest/v1/sms_jobs?id=eq.${id}&status=eq.queued&kind=eq.broadcast`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: "cancelled", finished_at: new Date().toISOString() } });
      if (!r.ok || !Array.isArray(r.json) || !r.json.length) return res.status(409).json({ error: "It already ran, is running, or was cancelled." });
      await audit("msg.schedule_cancelled", id, {}); return res.status(200).json({ ok: true });
    }
    if (act === "sms_automation_save") {
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      const role = req.body.role; if (!ROLES.includes(role)) return res.status(400).json({ error: "Unknown role." });
      const bad = validateTemplate(req.body.template); if (bad) return res.status(400).json({ error: bad });
      if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "Say whether it is on or off." });
      const r = await supa(`/rest/v1/sms_automations?role=eq.${role}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { template: String(req.body.template).trim(), enabled: req.body.enabled, updated_at: new Date().toISOString(), updated_by: await actorOf() } });
      if (!r.ok || !Array.isArray(r.json) || !r.json.length) return res.status(500).json({ error: "Couldn't save." });
      await audit("msg.automation_saved", role, { enabled: req.body.enabled }); return res.status(200).json({ ok: true });
    }
    if (act === "sms_automations_master") {
      if (!(await adminCan(req, "finance:ADMINISTER"))) return res.status(403).json({ error: "Not allowed." });
      if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "Say whether it is on or off." });
      const r = await supa("/rest/v1/platform_settings?key=eq.sms_automations_enabled", { method: "PATCH", headers: { Prefer: "return=representation" }, body: { value: req.body.enabled } });
      if (!r.ok || !Array.isArray(r.json) || !r.json.length) return res.status(500).json({ error: "Couldn't save." });
      await audit("msg.automations_master", null, { enabled: req.body.enabled }); return res.status(200).json({ ok: true, enabled: req.body.enabled });
    }

    // status (default) and refresh. Zend has no balance endpoint, so refresh only checks that the API key works (a free read).
    const out = { provider: "zend", ...settings(), overview: ov.json, key_check: null };
    if (act === "refresh" && configured()) {
      try { await request("/messages?limit=1&offset=0"); out.key_check = { ok: true }; }
      catch (e) { out.key_check = { ok: false, kind: (e && e.kind) || "ERROR", status: (e && e.status) || 0 }; }
      const value = { provider: "zend", checked_at: new Date().toISOString(), key_ok: out.key_check.ok, live: out.live, email_ready: out.email_ready, whatsapp: out.whatsapp };
      const up = await supa("/rest/v1/platform_settings?key=eq.messaging_health", { method: "PATCH", headers: { Prefer: "return=representation" }, body: { value } });
      if (!(up.ok && Array.isArray(up.json) && up.json.length)) await supa("/rest/v1/platform_settings", { method: "POST", body: { key: "messaging_health", value }, headers: { Prefer: "resolution=merge-duplicates" } });
    }
    return res.status(200).json(out);
  } catch { return res.status(500).json({ error: "Something went wrong." }); }
};
module.exports.config = { maxDuration: 60 };
