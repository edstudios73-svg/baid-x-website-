// POST /api/sms-notify { notification_id }  — called by the database trigger (same shared secret as push) when
// platform_settings.sms_notifications_enabled is true. Sends ONE transactional SMS if the user opted in (preferences),
// has an OTP-verified phone, and the category allows it. Sent through Zend: on WhatsApp first when the notify template is set up
// (ZEND_WA_TEMPLATE_NOTIFY, variable {{title}}), otherwise or as a fallback by SMS. Nothing is sent until MESSAGING_LIVE is true.
// Result is written to notification_logs.
const { sendMessage } = require("./_lib/messaging/messages");
const { liveAllowed } = require("./_lib/messaging/config");
const { maskPhone } = require("./_lib/messaging/phone");
const { supa, rpc } = require("./_lib/messaging/route");

const TEMPLATES = { payments: "BAID X: {t}. Open BAID X to view.", wallet: "BAID X: {t}. Open BAID X to view.", account: "BAID X: {t}. Open BAID X to view.", jobs: "BAID X: {t}. Open BAID X to view.", projects: "BAID X: {t}. Open BAID X to view." };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const sec = (await supa("/rest/v1/app_secrets?k=eq.push_secret&select=v")).json?.[0]?.v;
    const got = String(req.headers["x-push-secret"] || "");
    if (!sec || got.length !== sec.length || !require("crypto").timingSafeEqual(Buffer.from(got), Buffer.from(sec))) return res.status(401).end();
    const flag = (await supa("/rest/v1/platform_settings?key=eq.sms_notifications_enabled&select=value")).json?.[0]?.value;
    if (flag !== true) return res.status(200).json({ skipped: "disabled" });
    if (!liveAllowed()) return res.status(200).json({ skipped: "not_live" });

    const id = String(req.body && req.body.notification_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).end();
    const n = (await supa(`/rest/v1/notifications?id=eq.${id}&select=id,user_id,category,title`)).json?.[0];
    if (!n || !TEMPLATES[n.category]) return res.status(200).json({ skipped: "category" });
    const dup = (await supa(`/rest/v1/notification_logs?notification_id=eq.${id}&channel=eq.sms&select=id&limit=1`)).json;
    if (Array.isArray(dup) && dup.length) return res.status(200).json({ skipped: "duplicate" });
    const ph = await rpc("sms_recipient", { p_user: n.user_id, p_category: n.category });
    const phone = ph.ok && typeof ph.json === "string" ? ph.json : null;
    if (!phone) return res.status(200).json({ skipped: "not_opted_in" });

    const title = String(n.title || "You have an update").slice(0, 90);
    const text = TEMPLATES[n.category].replace("{t}", title);
    const log = { notification_id: id, user_id: n.user_id, channel: "sms", provider: "zend", meta: { mode: "live", to: maskPhone(phone) } };
    try {
      const r = await sendMessage({ to: phone, message: text, whatsapp: { kind: "notify", params: { title } } });
      await supa("/rest/v1/notification_logs", { method: "POST", body: { ...log, status: r.queued ? "queued" : "sent", provider_ref: r.jobId, meta: { ...log.meta, channels: r.channels, estimated_cost: r.estimatedCost } } });
      return res.status(200).json({ ok: true });
    } catch (e) {
      await supa("/rest/v1/notification_logs", { method: "POST", body: { ...log, status: "failed", error: String(e && e.kind || "ERROR") } });
      return res.status(200).json({ ok: false, kind: e && e.kind }); // 200: the trigger must not retry a send
    }
  } catch { return res.status(500).end(); }
};
