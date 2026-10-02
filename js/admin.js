/* BAID X staff console: platform-level view of organizations and the audit trail.
   Staff sign in with their staff email. Every call is a server function that checks the caller
   is an active staff member whose role holds the needed permission; nothing is trusted here. */
(() => {
  "use strict";
  const { sb, esc, pretty, ago, toast } = window.BX;
  const root = document.getElementById("adm");
  const state = { tab: "overview" };
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };
  const pill = (s) => `<span class="pill ${s === "ACTIVE" ? "ok" : "warn"}">${esc(pretty(String(s).toLowerCase()))}</span>`;
  const top = (me) => `<div class="adm-top"><img src="assets/icon-192.png" alt="" /><span class="tx"><b>Staff console</b><small>${esc(me.name || "Staff")} · ${esc(me.label)}</small></span><button class="btn-dark sm" id="out">Sign out</button></div>`;

  function login(msg) {
    root.innerHTML = `<form class="adm-login" id="lf"><img src="assets/icon-192.png" width="44" height="44" alt="" style="border-radius:11px" /><h1>Staff sign in</h1><p>For BAID X staff only. Customers sign in on the main site.</p>
      <input class="in" type="email" name="email" placeholder="Staff email" required autocomplete="username" /><input class="in" type="password" name="password" placeholder="Password" required autocomplete="current-password" />
      <button class="btn-light" type="submit">Sign in</button>${msg ? `<p style="margin-top:12px;color:#e6a3a3">${esc(msg)}</p>` : ""}</form>`;
    document.getElementById("lf").addEventListener("submit", async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); const b = e.target.querySelector("button"); b.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: d.email, password: d.password });
      if (error) return login("Those details didn't match.");
      boot();
    });
  }

  async function boot() {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return login();
    let me = null;
    try { me = await rpc("platform_whoami"); } catch { /* not staff */ }
    if (!me) { await sb.auth.signOut(); return login("This account does not have staff access."); }
    state.me = me; render();
  }

  async function render() {
    const me = state.me, can = (k) => me.can.includes(k);
    const tabs = [["overview", "Overview"], ["orgs", "Organizations"], ...(can("audit:VIEW") ? [["audit", "Activity"]] : []), ["access", "Roles"]];
    let body = "";
    try {
      if (state.tab === "overview") {
        const o = await rpc("platform_overview");
        body = `<div class="stats">${[[o.orgs_active + "/" + o.orgs, "Organizations"], [o.members, "People in orgs"], [o.projects, "Projects"], [o.invites_open, "Open invites"], [o.staff, "Staff"]].map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><small>${esc(l)}</small></div>`).join("")}</div>`;
      } else if (state.tab === "orgs") {
        const list = await rpc("platform_orgs");
        body = list.length ? list.map((o) => `<div class="row org-row"><span class="tx"><b>${esc(o.name)}</b><small><span class="code">${esc(o.public_code)}</span> ${esc(o.owner)} · ${o.members} people · ${esc(pretty(o.org_type))}</small></span>${pill(o.status)}${can("organizations:EDIT") ? `<button class="btn-dark sm" data-org="${esc(o.org_id)}" data-s="${o.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"}">${o.status === "ACTIVE" ? "Suspend" : "Restore"}</button>` : ""}</div>`).join("") : `<div class="d-empty"><h3>No organizations yet</h3></div>`;
      } else if (state.tab === "audit") {
        const rows = await rpc("platform_audit");
        body = rows.map((a) => `<div class="tl"><b>${esc(pretty(a.action.replace(".", " · ")))}</b><small>${esc(a.actor)} · ${esc(pretty(a.entity))} · ${esc(ago(a.at))}</small></div>`).join("") || `<div class="d-empty"><h3>No activity yet</h3></div>`;
      } else {
        const m = await rpc("access_matrix");
        body = m.roles.filter((r) => r.tier === "platform").map((r) => { const g = m.grants.filter((x) => x.role === r.key); const by = {}; g.forEach((x) => (by[x.resource] = by[x.resource] || []).push(x.action.toLowerCase()));
          return `<details class="dcard rl"><summary><span><b>${esc(r.label)}</b><small>${esc(r.description)}</small></span>${r.privileged ? `<span class="pill warn">2-step</span>` : ""}${r.key === me.role ? `<span class="pill ok">You</span>` : ""}</summary>${Object.keys(by).sort().map((k) => `<div class="acc-line"><div><b>${esc(pretty(k))}</b></div><div class="acs">${by[k].map((a) => `<span class="ac">${esc(a)}</span>`).join("")}</div></div>`).join("")}</details>`; }).join("");
      }
    } catch (e) { body = `<div class="state"><b>Not available</b>${esc(e.message || "Your role does not include this view.")}</div>`; }
    root.innerHTML = top(me) + `<div class="segs">${tabs.map(([k, l]) => `<button class="${k === state.tab ? "on" : ""}" data-t="${k}">${esc(l)}</button>`).join("")}</div>` + body;
  }

  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-t]"); if (t) { state.tab = t.dataset.t; return render(); }
    if (e.target.closest("#out")) { await sb.auth.signOut(); return login(); }
    const b = e.target.closest("[data-org]");
    if (b) {
      const reason = b.dataset.s === "SUSPENDED" ? window.prompt("Reason for suspending this organization", "") : "";
      if (reason === null) return;
      try { await rpc("platform_set_org_status", { p_org: b.dataset.org, p_status: b.dataset.s, p_reason: reason || null }); toast(b.dataset.s === "ACTIVE" ? "Organization restored" : "Organization suspended. Members lose access now."); render(); }
      catch (err) { toast(err.message || "Not allowed"); }
    }
  });
  boot();
})();
