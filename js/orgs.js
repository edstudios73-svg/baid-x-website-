/* BAID X organizations (Phase 2): organizations, people, credential profiles (roles), access matrix,
   invitations, immediate revocation, audit trail and two-step verification. The screens only
   reflect what the database allows: every action is a server function that re-checks the caller's
   membership, role rank, status and permissions, and denies by default. */
(() => {
  "use strict";
  const { esc, pretty, icon, ago } = window.BX;
  const U = () => window.DASH.ui;

  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const act = async (c, fn, args, okMsg) => {
    try { const data = await rpc(c, fn, args); if (okMsg) c.toast(okMsg); return { ok: true, data }; }
    catch (e) { c.toast(e.message || "Something went wrong. Please try again."); return { ok: false }; }
  };
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const STATUS_KIND = { ACTIVE: "ok", INVITED: "warn", PENDING_VERIFICATION: "warn", SUSPENDED: "warn", DISABLED: "bad", REVOKED: "bad", EXPIRED: "bad", ACCEPTED: "ok" };
  const pill = (s) => `<span class="pill ${STATUS_KIND[s] || ""}">${esc(pretty(String(s).toLowerCase()))}</span>`;
  const ACTIONS = ["VIEW", "CREATE", "EDIT", "ASSIGN", "APPROVE", "DELETE", "EXPORT", "ADMINISTER"];
  const SCOPE = { SELF: "Own items", TEAM: "Their team", DEPARTMENT: "Their department", PROJECT: "Their projects", ORGANIZATION: "Whole organization", GLOBAL_PLATFORM: "Whole platform" };
  const refresh = () => window.APP.route();

  /* ---------- bottom sheet ---------- */
  function openSheet(title, html) {
    const root = document.getElementById("sheetRoot");
    root.innerHTML = `<div class="sx-bg" data-close></div><div class="sx" role="dialog" aria-label="${esc(title)}"><div class="sx-h"><b>${esc(title)}</b><button class="sx-x" data-close aria-label="Close">${icon("plus", 18)}</button></div><div class="sx-b">${html}</div></div>`;
    document.body.classList.add("sx-open");
  }
  function closeSheet() { const root = document.getElementById("sheetRoot"); if (root) root.innerHTML = ""; document.body.classList.remove("sx-open"); }
  const fld = (label, inner, hint) => `<label class="fl"><span>${esc(label)}</span>${inner}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;

  /* ---------- shared data ---------- */
  let matrixCache = null;
  async function matrix(c) { return matrixCache || (matrixCache = await rpc(c, "access_matrix")); }
  const roleLabel = (m, key) => m.roles.find((r) => r.key === key)?.label || pretty(key);
  const grantsFor = (m, role) => m.grants.filter((g) => g.role === role);
  function grouped(grants) {
    const by = {};
    grants.forEach((g) => { (by[g.resource] = by[g.resource] || { scope: g.scope, acts: [] }).acts.push(g.action); });
    return by;
  }
  const chips = (acts) => ACTIONS.filter((a) => acts.includes(a)).map((a) => `<span class="ac">${esc(a.toLowerCase())}</span>`).join("");
  const accessList = (grants) => {
    const by = grouped(grants), keys = Object.keys(by).sort();
    if (!keys.length) return `<div class="cap2">No access. Deny by default.</div>`;
    return keys.map((k) => `<div class="acc-line"><div><b>${esc(pretty(k))}</b><small>${esc(SCOPE[by[k].scope] || by[k].scope)}</small></div><div class="acs">${chips(by[k].acts)}</div></div>`).join("");
  };

  /* ======================================================================
     Organizations list
     ====================================================================== */
  async function orgsView(c) {
    const { head, empty } = U();
    const list = (await rpc(c, "my_orgs")) || [];
    const m = await matrix(c);
    const cards = list.map((o) => `<button class="dcard org-card" data-oact="open-org" data-id="${esc(o.org_id)}"><div class="who"><span class="av sq">${esc(initials(o.name))}</span><span><b>${esc(o.name)}</b><small><span class="code">${esc(o.public_code)}</span> ${esc(roleLabel(m, o.role_key))}</small></span>${pill(o.status)}</div></button>`).join("");
    return head("Organizations", `<button class="btn-light sm" data-oact="new-org">New</button>`)
      + (list.length ? cards : empty("team", "No organization yet", "Create one for your company or crew, then invite people with the right access. Or open an invitation link someone sent you."))
      + `<div class="dcard"><h4><span>Have an invitation?</span></h4><form class="inline-f" data-oform="join"><input class="in" name="token" placeholder="Paste your invitation link or code" autocomplete="off" required /><button class="btn-light sm" type="submit">Join</button></form></div>`
      + await securityCard(c);
  }

  async function securityCard(c) {
    const { data } = await c.sb.auth.mfa.listFactors();
    const on = (data?.totp || []).some((f) => f.status === "verified");
    return `<div class="dcard"><h4><span>Two-step verification</span>${on ? pill("ACTIVE") : ""}</h4><p class="cap2">${on ? "An authenticator app protects your sign-in. Privileged roles will require it." : "Add an authenticator app. Roles that manage people or money will require it."}</p>${on ? "" : `<button class="btn-dark sm" data-oact="mfa-start">Set up authenticator</button>`}</div>`;
  }

  /* ======================================================================
     One organization
     ====================================================================== */
  async function orgView(c, arg) {
    const { head, segs, empty } = U();
    const orgs = (await rpc(c, "my_orgs")) || [];
    const id = arg || c.state.orgId || orgs[0]?.org_id;
    const org = orgs.find((o) => o.org_id === id);
    if (!org) return head("Organization") + empty("team", "Organization not found", "You are not a member of this organization.", `<button class="btn-light sm" data-go="orgs">All organizations</button>`);
    c.state.orgId = id;
    const tab = c.state.orgTab || "people", m = await matrix(c);
    const sw = orgs.length > 1 ? `<select class="in org-sw" id="orgPick">${orgs.map((o) => `<option value="${esc(o.org_id)}" ${o.org_id === id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>` : "";
    const can = (res, a) => grantsFor(m, org.role_key).some((g) => g.resource === res && g.action === a) && org.status === "ACTIVE";
    const tabs = [["people", "People"], ["invites", "Invitations"], ["roles", "Roles & access"], ["audit", "Activity"]];
    let body = "";
    if (org.status !== "ACTIVE") body = empty("lock", "Access paused", `Your access is ${org.status.toLowerCase()}. Contact an organization owner.`);
    else if (tab === "people") body = await peopleTab(c, id, m, can);
    else if (tab === "invites") body = await invitesTab(c, id, m, can);
    else if (tab === "roles") body = rolesTab(m, org.role_key);
    else body = can("audit", "VIEW") ? await auditTab(c, id) : empty("lock", "Not available", "Your role does not include the activity log.");
    return `<div class="d-head"><div><h1>${esc(org.name)}</h1><p class="sub"><span class="code">${esc(org.public_code)}</span> You are ${esc(roleLabel(m, org.role_key))}</p></div></div>${sw}`
      + `<div class="ws-tabs">${`<div class="segs">${tabs.map(([k, l]) => `<button class="${k === tab ? "on" : ""}" data-oact="org-tab" data-t="${k}">${esc(l)}</button>`).join("")}</div>`}</div>` + body;
  }

  async function peopleTab(c, id, m, can) {
    const { empty } = U();
    let rows;
    try { rows = await rpc(c, "org_members_list", { p_org: id }); } catch { return empty("lock", "Not available", "Your role does not include the people list."); }
    const add = can("invitations", "CREATE") ? `<button class="btn-light sm" data-oact="invite" data-org="${esc(id)}">Invite person</button>` : "";
    return `<div class="sec-row"><div class="sec">${rows.length} ${rows.length === 1 ? "person" : "people"}</div>${add}</div>`
      + rows.map((p) => `<button class="row" data-oact="member" data-org="${esc(id)}" data-user="${esc(p.user_id)}" data-mid="${esc(p.member_id)}"><span class="av">${esc(initials(p.name))}</span><span class="tx"><b>${esc(p.name)}${p.user_id === c.uid ? " (you)" : ""}</b><small>${esc(p.role_label)}</small></span>${pill(p.status)}</button>`).join("");
  }

  async function invitesTab(c, id, m, can) {
    const { empty } = U();
    let rows;
    try { rows = await rpc(c, "org_invitations_list", { p_org: id }); } catch { return empty("lock", "Not available", "Your role does not include invitations."); }
    const add = can("invitations", "CREATE") ? `<button class="btn-light sm" data-oact="invite" data-org="${esc(id)}">Invite person</button>` : "";
    return `<div class="sec-row"><div class="sec">Invitations</div>${add}</div>` + (rows.length ? rows.map((i) => `<div class="row"><span class="ic">${icon("mail", 17)}</span><span class="tx"><b>${esc(i.contact)}</b><small>${esc(i.role_label)} · expires ${esc(new Date(i.expires_at).toLocaleDateString("en-GH", { day: "numeric", month: "short" }))}</small></span>${pill(i.status)}${i.status === "INVITED" && can("invitations", "EDIT") ? `<button class="btn-dark sm" data-oact="revoke-inv" data-id="${esc(i.id)}">Cancel</button>` : ""}</div>`).join("") : empty("mail", "No invitations", "Invite people by email or phone. They set their own sign-in. No password is ever shared."));
  }

  function rolesTab(m, mine) {
    const org = m.roles.filter((r) => r.tier === "organization");
    return `<p class="cap2">Every role below is a credential profile. Access is deny-by-default: anything not listed is blocked.</p>`
      + org.map((r) => `<details class="dcard rl" ${r.key === mine ? "open" : ""}><summary><span><b>${esc(r.label)}</b><small>${esc(r.description)}</small></span>${r.privileged ? `<span class="pill warn">2-step</span>` : ""}${r.key === mine ? `<span class="pill ok">You</span>` : ""}</summary>${accessList(grantsFor(m, r.key))}</details>`).join("");
  }

  async function auditTab(c, id) {
    const { empty } = U();
    const rows = (await rpc(c, "org_audit", { p_org: id })) || [];
    if (!rows.length) return empty("rep", "No activity yet", "Every change to people, roles and access is recorded here.");
    return rows.map((a) => `<div class="tl"><b>${esc(pretty(a.action.replace(".", " · ")))}</b><small>${esc(a.actor)} · ${esc(ago(a.at))}${a.detail?.role ? ` · ${esc(pretty(a.detail.role))}` : ""}${a.detail?.status ? ` · ${esc(pretty(String(a.detail.status).toLowerCase()))}` : ""}</small></div>`).join("");
  }

  /* ======================================================================
     Join by link
     ====================================================================== */
  async function joinView(c, arg) {
    const { head, empty } = U();
    if (!arg) return head("Join") + empty("mail", "Invitation missing", "Open the full link you were sent.");
    const r = await act(c, "accept_org_invitation", { p_token: arg });
    if (!r.ok) return head("Join") + empty("lock", "Couldn't accept", "This invitation is invalid, expired, used, or sent to a different account.", `<button class="btn-light sm" data-go="orgs">My organizations</button>`);
    c.state.orgId = r.data; location.replace("#/org/" + r.data); return "";
  }

  /* ======================================================================
     Sheets
     ====================================================================== */
  async function memberSheet(c, el) {
    const m = await matrix(c);
    let a;
    try { a = await rpc(c, "org_user_access", { p_org: el.dataset.org, p_user: el.dataset.user }); } catch (e) { return c.toast(e.message); }
    const self = el.dataset.user === c.uid;
    const roles = m.roles.filter((r) => r.tier === "organization");
    const actions = self ? "" : `<div class="fs"><h3>Manage</h3>
      <form data-oform="role" data-mid="${esc(el.dataset.mid)}" class="inline-f"><select class="in" name="role">${roles.map((r) => `<option value="${esc(r.key)}" ${r.key === a.role ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select><button class="btn-light sm" type="submit">Change role</button></form>
      <div class="btn-row">${a.status === "ACTIVE" ? `<button class="btn-dark sm" data-oact="set-status" data-mid="${esc(el.dataset.mid)}" data-s="SUSPENDED">Suspend</button>` : a.status !== "REVOKED" ? `<button class="btn-light sm" data-oact="set-status" data-mid="${esc(el.dataset.mid)}" data-s="ACTIVE">Reactivate</button>` : ""}${a.status !== "REVOKED" ? `<button class="btn-dark sm danger" data-oact="set-status" data-mid="${esc(el.dataset.mid)}" data-s="REVOKED">Remove access</button>` : ""}</div><small class="cap2">Suspending or removing takes effect immediately.</small></div>`;
    openSheet(a.name || "Member", `<div class="kv"><span>Role</span><b>${esc(roleLabel(m, a.role))}</b></div><div class="kv"><span>Status</span><b>${pill(a.status)}</b></div>${a.status_reason ? `<div class="kv"><span>Reason</span><b>${esc(a.status_reason)}</b></div>` : ""}
      <div class="fs"><h3>What can this person access?</h3>${accessList(a.effective)}</div>${actions}
      ${a.recent?.length ? `<div class="fs"><h3>Recent changes</h3>${a.recent.map((r) => `<div class="tl"><b>${esc(pretty(r.action.replace(".", " · ")))}</b><small>${esc(ago(r.created_at))}</small></div>`).join("")}</div>` : ""}`);
  }

  async function inviteSheet(c, orgId) {
    const m = await matrix(c);
    const orgs = await rpc(c, "my_orgs"), mine = orgs.find((o) => o.org_id === orgId)?.role_key;
    const roles = m.roles.filter((r) => r.tier === "organization" && (mine === "org_owner" || r.rank > (m.roles.find((x) => x.key === mine)?.rank ?? 99)));
    openSheet("Invite person", `<form data-oform="invite" data-org="${esc(orgId)}">${fld("Email or phone", `<input class="in" name="contact" required placeholder="name@email.com or 055…" autocomplete="off" />`, "They must sign in with this email or phone to accept.")}
      ${fld("Role", `<select class="in" name="role">${roles.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}</select>`, "You can only grant roles below your own.")}
      <button class="btn-light" type="submit" style="width:100%">Create invitation</button></form>`);
  }

  function linkSheet(link) {
    openSheet("Invitation ready", `<p class="cap2">Send this private link to the person. It works once, expires in 7 days, and only the invited email or phone can accept it. They create their own sign-in. Never share a password.</p><input class="in" id="invLink" value="${esc(link)}" readonly /><div class="btn-row"><button class="btn-light sm" data-oact="copy-link">Copy link</button>${navigator.share ? `<button class="btn-dark sm" data-oact="share-link">Share</button>` : ""}<button class="btn-dark sm" data-close>Done</button></div>`);
  }

  async function mfaStart(c) {
    const { data, error } = await c.sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "BAID X " + Date.now() });
    if (error) return c.toast(error.message);
    openSheet("Set up authenticator", `<p class="cap2">Scan with Google Authenticator, Authy or similar, then enter the 6-digit code.</p><div class="qr"><img alt="QR code" src="${esc(data.totp.qr_code)}" /></div><small class="cap2">Or enter this key: <b>${esc(data.totp.secret)}</b></small>
      <form data-oform="mfa" data-factor="${esc(data.id)}">${fld("6-digit code", `<input class="in" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required autocomplete="one-time-code" />`)}<button class="btn-light" type="submit" style="width:100%">Verify and turn on</button></form>`);
  }

  /* ======================================================================
     Events
     ====================================================================== */
  const ACT = {
    "new-org": () => openSheet("New organization", `<form data-oform="new-org">${fld("Organization name", `<input class="in" name="name" required minlength="2" maxlength="120" placeholder="e.g. Mensah Builders Ltd" autocomplete="off" />`)}${fld("Type", `<select class="in" name="type"><option value="company">Company</option><option value="crew">Crew or contractor</option><option value="supplier">Supplier</option></select>`)}<button class="btn-light" type="submit" style="width:100%">Create organization</button><small class="cap2">You become the owner. Invite others with the right access.</small></form>`),
    "open-org": (c, el) => { c.state.orgId = el.dataset.id; c.state.orgTab = "people"; c.go("org/" + el.dataset.id); },
    "org-tab": (c, el) => { c.state.orgTab = el.dataset.t; refresh(); },
    member: (c, el) => memberSheet(c, el),
    invite: (c, el) => inviteSheet(c, el.dataset.org),
    "revoke-inv": async (c, el) => { if ((await act(c, "org_revoke_invitation", { p_invitation: el.dataset.id }, "Invitation cancelled")).ok) refresh(); },
    "set-status": async (c, el) => {
      const s = el.dataset.s; let reason = null;
      if (s !== "ACTIVE") { reason = window.prompt(s === "SUSPENDED" ? "Reason for suspending (optional)" : "Reason for removing access (optional)", ""); if (reason === null) return; }
      if ((await act(c, "org_set_member_status", { p_member: el.dataset.mid, p_status: s, p_reason: reason || null }, s === "ACTIVE" ? "Access restored" : "Access changed immediately")).ok) { closeSheet(); refresh(); }
    },
    "copy-link": async (c) => { const i = document.getElementById("invLink"); try { await navigator.clipboard.writeText(i.value); } catch { i.select(); document.execCommand("copy"); } c.toast("Link copied"); },
    "share-link": () => navigator.share({ title: "BAID X invitation", url: document.getElementById("invLink").value }).catch(() => {}),
    "mfa-start": (c) => mfaStart(c),
  };
  document.addEventListener("click", async (e) => {
    if (!window.APP?.state.me?.role) return;
    if (e.target.closest("[data-close]")) { closeSheet(); return; }
    const el = e.target.closest("[data-oact]"); if (!el) return;
    const fn = ACT[el.dataset.oact]; if (!fn) return;
    e.preventDefault();
    try { await fn(window.APP.dashCtx(), el); } catch (err) { console.error(err); window.BX.toast(err.message || "Something went wrong"); }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "orgPick") { const c = window.APP.dashCtx(); c.state.orgId = e.target.value; c.go("org/" + e.target.value); } });
  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("form[data-oform]"); if (!f || !window.APP?.state.me?.role) return;
    e.preventDefault();
    const c = window.APP.dashCtx(), d = Object.fromEntries(new FormData(f)), btn = f.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const k = f.dataset.oform;
      if (k === "new-org") { const r = await act(c, "create_org", { p_name: d.name, p_type: d.type }, "Organization created"); if (r.ok) { closeSheet(); c.state.orgId = r.data; c.go("org/" + r.data); } }
      else if (k === "invite") { const r = await act(c, "org_invite", { p_org: f.dataset.org, p_contact: d.contact, p_role: d.role }); if (r.ok) { linkSheet(`${location.origin}/#/join/${r.data}`); } }
      else if (k === "role") { if ((await act(c, "org_set_member_role", { p_member: f.dataset.mid, p_role: d.role }, "Role updated")).ok) { closeSheet(); refresh(); } }
      else if (k === "join") { const t = String(d.token).trim().split("/join/").pop(); if (t) c.go("join/" + encodeURIComponent(t)); }
      else if (k === "mfa") {
        const ch = await c.sb.auth.mfa.challenge({ factorId: f.dataset.factor });
        if (ch.error) c.toast(ch.error.message);
        else { const v = await c.sb.auth.mfa.verify({ factorId: f.dataset.factor, challengeId: ch.data.id, code: d.code }); if (v.error) c.toast("That code didn't match. Try again."); else { c.toast("Two-step verification is on"); closeSheet(); refresh(); } }
      }
    } catch (err) { c.toast(err.message || "Something went wrong"); }
    if (btn) btn.disabled = false;
  });
  window.addEventListener("hashchange", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  window.DASH.register("orgs", orgsView);
  window.DASH.register("org", orgView);
  window.DASH.register("join", joinView);
})();
