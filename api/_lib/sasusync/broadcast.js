// Bulk SMS announcement engine shared by the admin route (send now) and the scheduler (send later).
// Audience = active accounts (all, or chosen roles) with a usable Ghana number who have not switched off SMS/announcements.
// Chunks of 200 are sent in order, each attempted ONCE: a failure stops the run and is never resent.
const { cfg, liveAllowed } = require("./config");
const { sendBulkSms, smsParts } = require("./sms");
const { getBalance } = require("./balance");
const { normalizeGhanaPhone } = require("./phone");
const { supa, rpc } = require("./route");

const ROLES = ["worker", "company", "project-manager", "business", "individual-employer"];
const posInt = (v, d) => (v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
const limits = () => ({ max: posInt(process.env.SASUSYNC_BROADCAST_MAX, 500), reserve: process.env.SASUSYNC_OTP_RESERVE !== undefined && process.env.SASUSYNC_OTP_RESERVE !== "" && Number.isInteger(Number(process.env.SASUSYNC_OTP_RESERVE)) && Number(process.env.SASUSYNC_OTP_RESERVE) >= 0 ? Number(process.env.SASUSYNC_OTP_RESERVE) : 30 });

function cleanText(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 440) return { error: "Write a message of 3 to 440 characters." };
  const message = `BAID X: ${text}`;
  return { message, parts: smsParts(message) };
}

async function audience(roles) {
  const rec = await rpc("sms_broadcast_recipients", { p_roles: roles });
  if (!rec.ok || !Array.isArray(rec.json)) return null;
  const phones = new Set(); let noPhone = 0, invalid = 0, dup = 0;
  for (const r of rec.json) { if (!r.phone) { noPhone++; continue; } const n = normalizeGhanaPhone(r.phone); if (!n) { invalid++; continue; } if (phones.has(n)) dup++; else phones.add(n); }
  return { list: [...phones], skipped: { no_phone: noPhone, invalid_number: invalid, duplicate: dup } };
}

// Counts, cost and whether it may be sent. Throws only if the balance can't be read in live mode (nothing is sent then).
async function plan(roles, message, parts) {
  const aud = await audience(roles); if (!aud) return { error: "Couldn't load recipients." };
  const live = liveAllowed(), { max, reserve } = limits(), n = aud.list.length, estimate = n * parts;
  const sendable = live ? (await getBalance()).smsSendable : null;
  return { aud, live, label: live ? "LIVE — REAL SMS" : "SANDBOX — NO DELIVERY", preview: { result: live ? "LIVE — REAL SMS" : "SANDBOX — NO DELIVERY", mode: live ? "live" : "sandbox", recipients: n, skipped: aud.skipped, parts, credits_estimate: estimate, sms_sendable: sendable, otp_reserve: reserve, max_recipients: max, enough_credit: !live || sendable - estimate >= reserve, within_limit: n <= max, characters: message.length } };
}

// Sends the whole audience. requestId makes it idempotent (unique row in sms_broadcasts).
async function execute({ roles, message, parts, list, requestId, actor }) {
  const live = liveAllowed();
  const row = await supa("/rest/v1/sms_broadcasts", { method: "POST", headers: { Prefer: "return=representation" }, body: { request_id: requestId, created_by: actor && actor !== "unknown" ? actor : null, message, parts, target_roles: roles, mode: live ? "live" : "sandbox", recipients: list.length } });
  if (!row.ok || !Array.isArray(row.json) || !row.json[0]) return { duplicate: true };
  const bid = row.json[0].id; let accepted = 0, credits = 0, status = "sent", error = null; const chunks = [];
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    try {
      const r = await sendBulkSms({ recipients: part, message }, { retries: 0 });
      if (r.accepted) { accepted += part.length; if (r.deducted !== null && !Number.isNaN(Number(r.deducted))) credits += Number(r.deducted); }
      chunks.push({ n: part.length, job_id: r.jobId, queued: r.queued, deducted: r.deducted, ok: r.accepted });
      if (!r.accepted) { status = accepted ? "partial" : "failed"; error = "PROVIDER_REJECTED"; break; }
    } catch (e) {
      const k = (e && e.kind) || "ERROR"; chunks.push({ n: part.length, error: k });
      status = accepted ? "partial" : "failed"; error = k + (k === "TIMEOUT" || k === "NETWORK" ? " (may have been sent)" : ""); break; // never resend
    }
  }
  await supa(`/rest/v1/sms_broadcasts?id=eq.${bid}`, { method: "PATCH", body: { status, accepted, credits_used: live ? credits : 0, chunks, error, finished_at: new Date().toISOString() } });
  return { bid, status, accepted, credits: live ? credits : 0, error, live };
}
module.exports = { ROLES, limits, cleanText, audience, plan, execute };
