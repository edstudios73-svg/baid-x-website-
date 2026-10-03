// Phone identities WITHOUT Supabase's native Phone provider. A phone user is a normal Supabase user whose login email is an
// internal synthetic address; the verified number lives in public.phone_identities. Sessions come from the email/password grant.
// The synthetic domain is reserved (.invalid): no mailbox can exist there, and nothing is ever emailed to it.
const crypto = require("crypto");
const { env } = require("../paystack");

const syntheticEmail = (phone) => `p${String(phone).replace(/\D/g, "")}@phone.baidx.invalid`;
const tempPassword = () => crypto.randomBytes(24).toString("base64url") + "aA1!"; // 36 chars: under the 72-byte bcrypt limit

async function auth(path, { method = "GET", body, anon = false } = {}) {
  const e = env();
  const key = anon ? (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || PUBLISHABLE) : e.serviceKey;
  const r = await fetch(`${e.supaUrl}/auth/v1${path}`, { method, headers: { apikey: key, ...(anon ? {} : { authorization: `Bearer ${e.serviceKey}` }), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}
// The publishable key is public by design (it ships in every page of the site); used only for the password grant.
const PUBLISHABLE = "sb_publishable_lOw6Te3MRrvkpHt1V-WTmg_Albcae3P";

const createUser = (email, password, meta) => auth("/admin/users", { method: "POST", body: { email, password, email_confirm: true, user_metadata: meta || {} } });
const getUser = (id) => auth(`/admin/users/${encodeURIComponent(id)}`);
const updateUser = (id, body) => auth(`/admin/users/${encodeURIComponent(id)}`, { method: "PUT", body });
const deleteUser = (id) => auth(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
const passwordGrant = (email, password) => auth("/token?grant_type=password", { method: "POST", body: { email, password }, anon: true });
const sessionOf = (t) => ({ access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, token_type: t.token_type });

module.exports = { syntheticEmail, tempPassword, createUser, getUser, updateUser, deleteUser, passwordGrant, sessionOf };
