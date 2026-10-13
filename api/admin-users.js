// POST /api/admin-users — Super Admin only (checked by the database as the caller).
//   { action: "create_staff", name, email, role, password }  adds a Mission Control login (two-step is set up at first sign-in)
//   { action: "remove", role, id, confirm: "REMOVE" }          removes a member
// The database checks permission, wallet and escrow first (admin_remove_prepare, run as the caller), then the
// account and everything that belongs only to it is deleted with the service key. Removal can't be undone.
const { supa, env } = require("./_lib/paystack");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// rows that point at the member without cascading; everything else is removed with the auth user
const LEFTOVERS = [
  ["project_invitations", ["invited_by", "invitee_id"]], ["task_updates", ["author_id"]], ["project_reports", ["author_id"]],
  ["project_requests", ["requester_id"]], ["project_payments", ["requested_by", "payee_id"]], ["project_completion_requests", ["requested_by"]],
  ["project_reviews", ["reviewer_id", "reviewee_id"]], ["company_pm_links", ["requested_by"]],
];

const STAFF_ROLES = ["super", "platform", "ops", "finance", "auditor"];
async function createStaff(req, res, token) {
  const b = req.body || {}, email = String(b.email || "").trim().toLowerCase(), name = String(b.name || "").trim(), role = String(b.role || ""), password = String(b.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter their name." });
  if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: "Choose a role." });
  if (password.length < 10 || password.length > 72) return res.status(400).json({ error: "The password needs at least 10 characters." });
  if (!env().serviceKey) return res.status(503).json({ error: "Adding staff isn't configured on the server." });
  // the database decides: only a Super Admin who has passed two-step (when it is on) gets true
  const ok = await supa("/rest/v1/rpc/admin_can_add_staff", { method: "POST", body: {}, token });
  if (!ok.ok || ok.json !== true) return res.status(403).json({ error: ok.json?.message || "Only a Super Admin can add staff." });
  const e = env();
  const made = await fetch(`${e.supaUrl}/auth/v1/admin/users`, { method: "POST", headers: { apikey: e.serviceKey, authorization: `Bearer ${e.serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name, staff: true } }) });
  const u = await made.json().catch(() => ({}));
  if (!made.ok || !u.id) return res.status(made.status === 422 ? 409 : 500).json({ error: made.status === 422 ? "That email already has a BAID X account. Use another email." : "The login couldn't be created." });
  const row = await supa("/rest/v1/admin_users", { method: "POST", body: { id: u.id, email, full_name: name, admin_role: role, is_active: true } });
  if (!row.ok) {
    await fetch(`${e.supaUrl}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: { apikey: e.serviceKey, authorization: `Bearer ${e.serviceKey}` } });
    return res.status(500).json({ error: "The staff record couldn't be saved. Nothing was created." });
  }
  return res.status(200).json({ created: true, email });
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!token) return res.status(401).json({ error: "Sign in again." });
    const { action, role, id, confirm } = req.body || {};
    if (action === "create_staff") return createStaff(req, res, token);
    if (action !== "remove") return res.status(400).json({ error: "Unknown action." });
    if (!UUID.test(String(id || ""))) return res.status(400).json({ error: "Choose a member." });
    if (!env().serviceKey) return res.status(503).json({ error: "Removal isn't configured on the server." });

    const prep = await supa("/rest/v1/rpc/admin_remove_prepare", { method: "POST", body: { p_role: role, p_id: id, p_confirm: confirm }, token });
    if (!prep.ok) return res.status(prep.status === 401 ? 401 : 400).json({ error: prep.json?.message || "Not allowed." });

    for (const [table, cols] of LEFTOVERS) {
      const filter = cols.length === 1 ? `${cols[0]}=eq.${id}` : `or=(${cols.map((c) => `${c}.eq.${id}`).join(",")})`;
      const r = await supa(`/rest/v1/${table}?${filter}`, { method: "DELETE" });
      if (!r.ok) return res.status(500).json({ error: `Couldn't clear ${table.replace(/_/g, " ")}. Nothing else was removed.` });
    }
    const e = env();
    const del = await fetch(`${e.supaUrl}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: e.serviceKey, authorization: `Bearer ${e.serviceKey}` } });
    if (!del.ok && del.status !== 404) return res.status(500).json({ error: "The account couldn't be deleted. Try again." });
    return res.status(200).json({ removed: true, name: prep.json?.name || "Member" });
  } catch {
    return res.status(500).json({ error: "Something went wrong." });
  }
};
