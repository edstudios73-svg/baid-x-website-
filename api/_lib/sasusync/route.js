// Small helpers shared by the SasuSync routes: client IP, audit trail (no codes, no full numbers) and admin gate.
const { env } = require("../paystack");
// Service-role REST helper that (unlike the Paystack one) accepts extra headers such as Prefer. Reads env at call time.
async function supa(path, { method = "GET", body, token, headers = {} } = {}) {
  const e = env();
  const r = await fetch(`${e.supaUrl}${path}`, { method, headers: { apikey: e.serviceKey, authorization: `Bearer ${token || e.serviceKey}`, "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: r.ok, status: r.status, json };
}
const rpc = (fn, args) => supa(`/rest/v1/rpc/${fn}`, { method: "POST", body: args });
const { maskPhone } = require("./phone");
const ip = (req) => String((req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "unknown").trim().slice(0, 64);
async function audit(action, entityId, meta = {}, actor = null) {
  try { await supa("/rest/v1/audit_logs", { method: "POST", body: { action, entity_type: "sasusync", entity_id: entityId ? String(entityId) : null, actor_id: actor, meta } }); } catch { /* audit must not break the flow */ }
}
async function adminCan(req, perm) {
  const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
  if (!token) return false;
  const me = await supa("/rest/v1/rpc/platform_whoami", { method: "POST", body: {}, token });
  return !!(me.ok && me.json && Array.isArray(me.json.can) && me.json.can.includes(perm)) ;
}
module.exports = { ip, audit, adminCan, rpc, supa, maskPhone };
