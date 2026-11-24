// POST /api/sms-scheduler — runs due messaging jobs: scheduled announcements and automated welcome messages.
// Called by the database every minute (pg_cron) and right after a new account is created (same shared secret as push/sms-notify).
// Each job is claimed atomically (SKIP LOCKED) so it can only run once, and every provider call is attempted ONCE (never resent).
// Sent through Zend; nothing goes out until MESSAGING_LIVE is true (jobs then fail with LIVE_DISABLED, nothing is faked).
const crypto = require("crypto");
const { supa, rpc, audit, maskPhone } = require("./_lib/messaging/route");
const { configured, liveAllowed } = require("./_lib/messaging/config");
const { sendMessage } = require("./_lib/messaging/messages");
const { normalizeGhanaPhone } = require("./_lib/messaging/phone");
const { renderTemplate } = require("./_lib/messaging/templates");
const { CHANNELS, plan, execute } = require("./_lib/messaging/broadcast");

const done = (id, status, result, error) => supa(`/rest/v1/sms_jobs?id=eq.${id}`, { method: "PATCH", body: { status, result: result || null, error: error || null, finished_at: new Date().toISOString() } });
const posInt = (v, d) => (v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);

async function welcome(job) {
  const { user_id: uid, role } = job.payload || {};
  const master = (await supa("/rest/v1/platform_settings?key=eq.sms_automations_enabled&select=value")).json?.[0]?.value === true;
  const auto = (await supa(`/rest/v1/sms_automations?role=eq.${encodeURIComponent(role || "")}&select=enabled,template`)).json?.[0];
  if (!master || !auto || !auto.enabled) return done(job.id, "skipped", null, "AUTOMATION_OFF");
  const ctx = (await rpc("sms_welcome_context", { p_user: uid })).json;
  if (!ctx || !ctx.phone) return done(job.id, "skipped", null, "NO_PHONE");
  if (ctx.opted_out) return done(job.id, "skipped", null, "OPTED_OUT");
  const phone = normalizeGhanaPhone(ctx.phone); if (!phone) return done(job.id, "skipped", null, "INVALID_NUMBER");
  if (!configured()) return done(job.id, "failed", null, "NOT_CONFIGURED");
  if (!liveAllowed()) return done(job.id, "failed", null, "LIVE_DISABLED");
  const message = renderTemplate(auto.template, { name: ctx.name, role: ctx.role });
  const cap = await rpc("rl_hit", { p_key: "sms:auto:all", p_window_s: 86400, p_max: posInt(process.env.MESSAGING_AUTO_DAILY_CAP, 100) });
  if (cap.ok && cap.json && cap.json.allowed === false) return done(job.id, "skipped", null, "DAILY_CAP");
  try {
    const r = await sendMessage({ to: phone, message, whatsapp: { kind: "announce", params: { message } } });
    await supa("/rest/v1/notification_logs", { method: "POST", body: { user_id: uid, channel: "sms", provider: "zend", status: r.queued ? "queued" : "sent", provider_ref: r.jobId, meta: { automation: "welcome", role, channels: r.channels, to: maskPhone(phone) } } });
    return done(job.id, "sent", { message_id: r.jobId, channels: r.channels }, null);
  } catch (e) { const k = (e && e.kind) || "ERROR"; return done(job.id, "failed", null, k + (k === "TIMEOUT" || k === "NETWORK" ? " (may have been sent)" : "")); }
}

async function scheduledBroadcast(job) {
  const p = job.payload || {}, actor = job.created_by || null; let res = null, inapp = null;
  const channel = CHANNELS.includes(p.channel) ? p.channel : "sms";
  if (p.sms) { // "sms" in the payload means "send outside the app": by SMS, WhatsApp or email (p.channel)
    if (!configured()) res = { status: "failed", error: "NOT_CONFIGURED" };
    else if (!liveAllowed()) res = { status: "failed", error: "LIVE_DISABLED" };
    else {
      let pl; try { pl = await plan(p.roles || [], p.message, p.parts, channel); } catch (e) { pl = { error: (e && e.kind) || "ERROR" }; }
      if (pl.error) res = { status: "failed", error: pl.error };
      else if (!pl.preview.channel_ready) res = { status: "failed", error: "CHANNEL_NOT_SET_UP" };
      else if (!pl.aud.list.length) res = { status: "skipped", error: "NO_RECIPIENTS" };
      else if (!pl.preview.within_limit) res = { status: "failed", error: "OVER_LIMIT" };
      else { const r = await execute({ roles: p.roles || [], message: p.message, parts: p.parts, list: pl.aud.list, requestId: job.id, actor, channel, subject: p.subject }); res = r.duplicate ? { status: "failed", error: "DUPLICATE" } : { status: r.status, error: r.error, accepted: r.accepted, recipients: pl.aud.list.length, channel }; }
    }
  }
  if (p.in_app) { const n = await rpc("sched_broadcast_inapp", { p_title: p.in_app.title, p_body: p.in_app.body, p_href: p.in_app.href || null, p_roles: p.roles || [], p_by: actor, p_channels: p.channels || ["in_app"] }); inapp = n.ok ? n.json : null; }
  const status = !p.sms ? (inapp !== null ? "sent" : "failed") : res ? res.status : "failed";
  await audit("sms.scheduled_run", job.id, { status, roles: p.roles || [], channel, accepted: res && res.accepted, error: res && res.error, in_app: inapp }, actor);
  return done(job.id, ["sent", "partial", "failed", "skipped"].includes(status) ? status : "failed", { sms: res, in_app: inapp }, res && res.error ? res.error : null);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const sec = (await supa("/rest/v1/app_secrets?k=eq.push_secret&select=v")).json?.[0]?.v, got = String(req.headers["x-push-secret"] || "");
    if (!sec || got.length !== sec.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(sec))) return res.status(401).end();
    const claimed = await rpc("sms_jobs_claim", { p_limit: 20 });
    const jobs = claimed.ok && Array.isArray(claimed.json) ? claimed.json : [];
    for (const job of jobs) {
      try { if (job.kind === "welcome") await welcome(job); else if (job.kind === "broadcast") await scheduledBroadcast(job); else await done(job.id, "failed", null, "UNKNOWN_KIND"); }
      catch { await done(job.id, "failed", null, "INTERNAL"); } // never leaves a job 'running'; never retried (it may already have been sent)
    }
    return res.status(200).json({ ran: jobs.length });
  } catch { return res.status(500).end(); }
};
module.exports.config = { maxDuration: 60 };
