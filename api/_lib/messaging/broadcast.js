// Announcements to registered members, shared by the admin route (send now) and the scheduler (send later).
// Channels: "sms"; "whatsapp" (approved template, falls back to SMS for anyone not on WhatsApp); "email".
// Audience = active accounts (all, or chosen roles) who have not switched off announcements. Each provider call is made ONCE:
// a failure stops the run and is never resent. sms_broadcasts keeps its old name; its `mode` column now holds the channel.
const { cfg, liveAllowed, emailReady } = require("./config");
const { sendBulk, smsParts } = require("./messages");
const { sendEmail, validEmail } = require("./email");
const { normalizeGhanaPhone } = require("./phone");
const { supa, rpc } = require("./route");
const { env } = require("../paystack");

const ROLES = ["worker", "company", "project-manager", "business", "individual-employer"];
const CHANNELS = ["sms", "whatsapp", "email"];
const posInt = (v, d) => (v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
const limits = () => ({ max: posInt(process.env.MESSAGING_BROADCAST_MAX, 500), emailMax: posInt(process.env.MESSAGING_EMAIL_BROADCAST_MAX, 300) });
const STOP = new Set(["AUTH", "FORBIDDEN", "INSUFFICIENT_CREDIT", "RATE_LIMITED", "EMAIL_DOMAIN", "EMAIL_NOT_SET_UP", "SERVER", "TIMEOUT", "NETWORK", "LIVE_DISABLED", "NOT_CONFIGURED", "UNEXPECTED"]);

function cleanText(raw, channel = "sms") {
  const text = String(raw || "").replace(channel === "email" ? /[ \t]+/g : /\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const max = channel === "email" ? 3000 : 440;
  if (text.length < 3 || text.length > max) return { error: `Write a message of 3 to ${max} characters.` };
  const message = channel === "email" ? text : `BAID X: ${text}`;
  return { message, parts: channel === "email" ? 0 : smsParts(message) };
}
function cleanSubject(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim() || "News from BAID X";
  return s.length > 120 ? { error: "Keep the subject under 120 characters." } : { subject: s };
}

// The login emails of these accounts, read with the service key. Phone-login placeholders (.invalid) are skipped.
async function emailsOf(ids) {
  const want = new Set(ids), out = new Map(), e = env();
  for (let page = 1; page <= 50 && out.size < want.size; page++) {
    const r = await fetch(`${e.supaUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: e.serviceKey, authorization: `Bearer ${e.serviceKey}` } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({})), users = Array.isArray(j.users) ? j.users : [];
    for (const u of users) if (want.has(u.id) && u.email_confirmed_at !== null && validEmail(u.email)) out.set(u.id, u.email.trim().toLowerCase());
    if (users.length < 1000) break;
  }
  return out;
}

async function audience(roles, channel = "sms") {
  const rec = await rpc("sms_broadcast_recipients", { p_roles: roles });
  if (!rec.ok || !Array.isArray(rec.json)) return null;
  const seen = new Set(); let noContact = 0, invalid = 0, dup = 0;
  if (channel === "email") {
    const emails = await emailsOf([...new Set(rec.json.map((r) => r.user_id))]);
    if (!emails) return null;
    for (const r of rec.json) { const m = emails.get(r.user_id); if (!m) { noContact++; continue; } if (seen.has(m)) dup++; else seen.add(m); }
    return { list: [...seen], skipped: { no_email: noContact, duplicate: dup } };
  }
  for (const r of rec.json) { if (!r.phone) { noContact++; continue; } const n = normalizeGhanaPhone(r.phone); if (!n) { invalid++; continue; } if (seen.has(n)) dup++; else seen.add(n); }
  return { list: [...seen], skipped: { no_phone: noContact, invalid_number: invalid, duplicate: dup } };
}

const labelFor = (channel) => (!liveAllowed() ? "NOT LIVE — NOTHING WILL BE SENT" : channel === "email" ? "LIVE — REAL EMAILS" : channel === "whatsapp" ? "LIVE — REAL WHATSAPP (SMS FALLBACK)" : "LIVE — REAL SMS");

// Counts and whether it may be sent. Zend has no balance endpoint: credit is checked by Zend itself, which refuses the send.
async function plan(roles, message, parts, channel = "sms") {
  if (!CHANNELS.includes(channel)) return { error: "Unknown channel." };
  const aud = await audience(roles, channel); if (!aud) return { error: "Couldn't load recipients." };
  const live = liveAllowed(), { max, emailMax } = limits(), n = aud.list.length, cap = channel === "email" ? emailMax : max;
  const ready = channel === "email" ? emailReady() : channel === "whatsapp" ? !!cfg().wa.announce : true;
  return { aud, live, label: labelFor(channel), preview: { result: labelFor(channel), mode: live ? "live" : "off", channel, recipients: n, skipped: aud.skipped, parts, max_recipients: cap,
    within_limit: n <= cap, channel_ready: ready, whatsapp_template: channel === "whatsapp" ? !!cfg().wa.announce : undefined, characters: message.length } };
}

// Sends to the whole audience. requestId makes it idempotent (unique row in sms_broadcasts).
async function execute({ roles, message, parts, list, requestId, actor, channel = "sms", subject }) {
  if (!liveAllowed()) return { status: "failed", error: "LIVE_DISABLED", accepted: 0, live: false };
  const row = await supa("/rest/v1/sms_broadcasts", { method: "POST", headers: { Prefer: "return=representation" }, body: { request_id: requestId, created_by: actor && actor !== "unknown" ? actor : null, message: channel === "email" ? `[${subject}] ${message}`.slice(0, 4000) : message, parts, target_roles: roles, mode: channel, recipients: list.length } });
  if (!row.ok || !Array.isArray(row.json) || !row.json[0]) return { duplicate: true };
  const bid = row.json[0].id; let accepted = 0, status = "sent", error = null; const chunks = [];
  if (channel === "email") {
    let failed = 0;
    for (let i = 0; i < list.length && !error; i += 8) {
      const part = list.slice(i, i + 8);
      const out = await Promise.allSettled(part.map((to) => sendEmail({ to, subject, text: message })));
      for (const o of out) {
        if (o.status === "fulfilled") accepted++;
        else { failed++; const k = (o.reason && o.reason.kind) || "ERROR"; if (STOP.has(k) && !error) error = k + (k === "TIMEOUT" || k === "NETWORK" ? " (may have been sent)" : ""); }
      }
    }
    chunks.push({ channel, n: list.length, accepted, failed });
    status = accepted === list.length ? "sent" : accepted ? "partial" : "failed";
    if (!error && failed) error = "SOME_EMAILS_FAILED";
  } else {
    const whatsapp = channel === "whatsapp" ? { kind: "announce", params: { message } } : null;
    for (let i = 0; i < list.length; i += 1000) {
      const part = list.slice(i, i + 1000);
      try {
        const r = await sendBulk({ recipients: part, message, whatsapp });
        accepted += part.length; chunks.push({ channel, n: part.length, bulk_id: r.jobId, channels: r.channels, estimated_cost: r.estimatedCost });
      } catch (e) {
        const k = (e && e.kind) || "ERROR"; chunks.push({ channel, n: part.length, error: k });
        status = accepted ? "partial" : "failed"; error = k + (k === "TIMEOUT" || k === "NETWORK" ? " (may have been sent)" : ""); break; // never resend
      }
    }
  }
  await supa(`/rest/v1/sms_broadcasts?id=eq.${bid}`, { method: "PATCH", body: { status, accepted, credits_used: null, chunks, error, finished_at: new Date().toISOString() } });
  return { bid, status, accepted, error, live: true };
}
module.exports = { ROLES, CHANNELS, limits, cleanText, cleanSubject, audience, plan, execute, emailsOf };
