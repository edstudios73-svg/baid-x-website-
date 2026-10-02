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
    const tabs = [["overview", "Overview"], ["verify", "Verification"], ["money", "Money"], ["orgs", "Organizations"], ...(can("finance:VIEW") ? [["finance", "Finance"]] : []), ...(can("audit:VIEW") ? [["audit", "Activity"]] : []), ["access", "Roles"]];
    let body = "";
    try {
      if (state.tab === "overview") {
        const o = await rpc("platform_overview");
        body = `<div class="stats">${[[o.orgs_active + "/" + o.orgs, "Organizations"], [o.members, "People in orgs"], [o.projects, "Projects"], [o.invites_open, "Open invites"], [o.staff, "Staff"]].map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><small>${esc(l)}</small></div>`).join("")}</div>`;
      } else if (state.tab === "orgs") {
        const list = await rpc("platform_orgs");
        body = list.length ? list.map((o) => `<div class="row org-row"><span class="tx"><b>${esc(o.name)}</b><small><span class="code">${esc(o.public_code)}</span> ${esc(o.owner)} · ${o.members} people · ${esc(pretty(o.org_type))}</small></span>${pill(o.status)}${can("organizations:EDIT") ? `<button class="btn-dark sm" data-org="${esc(o.org_id)}" data-s="${o.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"}">${o.status === "ACTIVE" ? "Suspend" : "Restore"}</button>` : ""}</div>`).join("") : `<div class="d-empty"><h3>No organizations yet</h3></div>`;
      } else if (state.tab === "verify") {
        body = await verifyTab();
      } else if (state.tab === "money") {
        body = await moneyTab();
      } else if (state.tab === "finance") {
        body = await financeTab(can("finance:ADMINISTER"));
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

  /* ---------- verification review ---------- */
  const BUCKET = { ghana_card_front_url: "ghana-cards", ghana_card_back_url: "ghana-cards", contact_ghana_card_url: "ghana-cards", business_registration_doc_url: "business-docs", trade_license_url: "trade-licenses", qualification_doc_url: "trade-licenses", certification_doc_url: "trade-licenses", application_letter_url: "application-letters", ghana_card_front: "ghana-cards", ghana_card_back: "ghana-cards" };
  const LABEL = (k) => pretty(k.replace(/_url$/, "").replace(/_/g, " "));
  const ROLE_NAME = { worker: "Professional", "project-manager": "Project manager", company: "Company", business: "Supplier", "individual-employer": "Client" };
  async function verifyTab() {
    const f = state.vf || "pending_verification";
    const list = await rpc("admin_verification_queue", { p_status: f });
    const chips = [["pending_verification", "Waiting"], ["resubmit_required", "Needs action"], ["rejected", "Rejected"], ["verified", "Verified"]];
    let html = `<div class="segs">${chips.map(([k, l]) => `<button class="${k === f ? "on" : ""}" data-vf="${k}">${l}</button>`).join("")}</div>`;
    if (!list.length) return html + `<div class="d-empty"><h3>Nothing here</h3><p>${f === "pending_verification" ? "No profiles are waiting for review." : "No profiles with this status."}</p></div>`;
    state.vq = list;
    return html + list.map((x, i) => {
      const docs = Object.entries(x.docs || {}).flatMap(([k, v]) => {
        if (k === "profile_sections" && v && typeof v === "object") return Object.entries(v).filter(([kk]) => kk.startsWith("ghana_card")).map(([kk, vv]) => [kk, vv]);
        return [[k, v]];
      }).filter(([, v]) => v && typeof v === "string");
      return `<div class="dcard"><h4><span>${esc(x.name || "Unnamed")}</span><span class="pill warn">${esc(ROLE_NAME[x.role] || x.role)}</span></h4><p class="cap2">${esc(x.phone || "")} ${x.region ? "· " + esc(x.region) : ""} · updated ${esc(ago(x.updated_at))}</p>
        ${docs.map(([k, v]) => (BUCKET[k] || /^https?:/.test(v)) ? `<div class="kv"><span>${esc(LABEL(k))}</span><b><button class="btn-dark sm" data-doc="${esc(BUCKET[k] || "")}" data-path="${esc(v)}">View</button></b></div>` : `<div class="kv"><span>${esc(LABEL(k))}</span><b>${esc(v)}</b></div>`).join("") || `<p class="cap2">No documents on file.</p>`}
        ${x.rejection_reason ? `<div class="req"><small>Last note</small><p>${esc(x.rejection_reason)}</p></div>` : ""}
        <div class="btn-row">${f !== "verified" ? `<button class="btn-light sm" data-vd="verified" data-i="${i}">Approve</button>` : ""}<button class="btn-dark sm" data-vd="resubmit_required" data-i="${i}">Ask to resubmit</button>${f !== "rejected" ? `<button class="btn-dark sm" data-vd="rejected" data-i="${i}">Reject</button>` : ""}${f === "verified" ? `<button class="btn-dark sm" data-vd="pending_verification" data-i="${i}">Reset to review</button>` : ""}</div></div>`;
    }).join("");
  }
  async function moneyTab() {
    const q = await rpc("admin_money_queue");
    const dep = q.deposits.map((d) => `<div class="dcard"><h4><span>Deposit · ${esc(cediW(d.amount))}</span><span class="pill warn">${esc(pretty(d.status))}</span></h4><p class="cap2">${esc(d.owner_name)} · ${esc(pretty(d.role))} · ${esc(d.ref)} · ${esc(ago(d.created_at))}${d.note ? " · " + esc(d.note) : ""}</p>
      <div class="btn-row">${d.proof ? `<button class="btn-dark sm" data-doc="payment-proofs" data-path="${esc(d.proof)}">View proof</button>` : ""}<button class="btn-light sm" data-dd="1" data-id="${esc(d.id)}">Confirm received</button><button class="btn-dark sm" data-dd="0" data-id="${esc(d.id)}">Reject</button></div></div>`).join("");
    const wd = q.withdrawals.map((w) => `<div class="dcard"><h4><span>Withdrawal · ${esc(cediW(w.amount))}</span><span class="pill warn">${esc(pretty(w.status))}</span></h4><p class="cap2">${esc(w.owner_name)} · ${esc(pretty(w.role))} · ${esc(w.ref)} · ${esc(ago(w.created_at))}</p><div class="kv"><span>Pay to</span><b>${esc(w.name || "")} · ${esc(w.network || "")} ${esc(w.account || "")}</b></div>
      <div class="btn-row"><button class="btn-light sm" data-wd="completed" data-id="${esc(w.id)}">Mark as paid</button><button class="btn-dark sm" data-wd="rejected" data-id="${esc(w.id)}">Return to wallet</button></div></div>`).join("");
    return `<div class="sec">Deposits waiting</div>${dep || `<div class="cap2">None waiting.</div>`}<div class="sec">Withdrawals waiting</div>${wd || `<div class="cap2">None waiting.</div>`}`;
  }
  const cediW = (n) => `GH₵${Number(n).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  async function openDoc(bucket, path) {
    if (/^https?:/.test(path)) return window.open(path, "_blank", "noopener");
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) return toast("Couldn't open that file.");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const cedi = (m) => `GH₵${(m / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  async function api(action) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/paystack-admin", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action }) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }
  async function financeTab(admin) {
    const f = await rpc("platform_finance");
    const conn = admin ? await api("status") : null, c = conn?.json || {};
    const modeP = c.mode === "test" ? `<span class="pill warn">Test mode</span>` : c.mode === "live" ? `<span class="pill ok">Live</span>` : `<span class="pill bad">Not connected</span>`;
    const tiles = [[cedi(f.revenue_minor), "Revenue (net)"], [cedi(f.refunded_minor), "Refunded"], [f.pending, "Pending"], [f.failed, "Failed"], [f.flagged, "Needs review"], [Object.values(f.subs_by_status).reduce((a, b) => a + b, 0), "Subscriptions"]];
    let html = `<div class="stats">${tiles.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><small>${esc(l)}</small></div>`).join("")}</div>`;
    if (admin) html += `<div class="dcard"><h4><span>Paystack connection</span>${modeP}</h4>
      <div class="kv"><span>Plans linked</span><b>${c.plans_with_code ?? 0} of ${c.plans ?? 0}</b></div>
      <div class="kv"><span>Webhook URL</span><b style="word-break:break-all;font-size:12px">${esc(c.webhook_url || "")}</b></div>
      <p class="cap2">Paste the webhook URL into Paystack → Settings → API Keys &amp; Webhooks. The secret key stays in Vercel and is never shown here.</p>
      ${c.mode && c.mode !== "none" && c.plans_with_code < c.plans ? `<button class="btn-light sm" id="mkPlans">Create Paystack plans</button>` : ""}</div>`;
    html += `<div class="sec">Founding program</div>` + f.founding.map((x) => `<div class="row"><span class="tx"><b>${esc(pretty(x.role))}</b><small>${x.started ? "Started " + esc(ago(x.started)) : "Not started"}</small></span><span class="amt">${x.claimed}/${x.total}</span></div>`).join("");
    html += `<div class="sec">Recent payments</div>` + (f.recent.length ? f.recent.map((p) => `<div class="row"><span class="tx"><b>${esc(pretty(p.purpose))} · ${cedi(p.amount_minor)}</b><small>${esc(p.provider_reference)} · ${esc(ago(p.created_at))}${p.discrepancy ? " · " + esc(p.discrepancy) : ""}</small></span><span class="pill ${p.discrepancy ? "warn" : p.status === "successful" ? "ok" : ""}">${esc(pretty(p.status))}</span></div>`).join("") : `<div class="cap2">No payments yet. Nothing here is sample data.</div>`);
    return html;
  }

  root.addEventListener("click", async (e) => {
    const vf = e.target.closest("[data-vf]"); if (vf) { state.vf = vf.dataset.vf; return render(); }
    const dc = e.target.closest("[data-doc]"); if (dc) return openDoc(dc.dataset.doc, dc.dataset.path);
    const vd = e.target.closest("[data-vd]");
    if (vd) {
      const x = state.vq[+vd.dataset.i], st = vd.dataset.vd; let reason = null;
      if (st === "rejected" || st === "resubmit_required") { reason = window.prompt(st === "rejected" ? "Why is this not approved? The member will see this." : "What should they fix? The member will see this.", ""); if (reason === null) return; }
      try { await rpc("admin_decide_verification", { p_role: x.role, p_id: x.id, p_status: st, p_reason: reason || null }); toast("Decision saved. The member was notified."); render(); } catch (err) { toast(err.message || "Failed"); }
      return;
    }
    const dd = e.target.closest("[data-dd]");
    if (dd) { try { await rpc("admin_decide_deposit", { p_id: dd.dataset.id, p_approve: dd.dataset.dd === "1", p_note: null }); toast(dd.dataset.dd === "1" ? "Deposit credited to the wallet" : "Deposit rejected"); render(); } catch (err) { toast(err.message || "Failed"); } return; }
    const wdb = e.target.closest("[data-wd]");
    if (wdb) { try { await rpc("admin_decide_withdrawal", { p_id: wdb.dataset.id, p_status: wdb.dataset.wd, p_note: null }); toast(wdb.dataset.wd === "completed" ? "Marked as paid" : "Returned to the wallet"); render(); } catch (err) { toast(err.message || "Failed"); } return; }
    if (e.target.closest("#mkPlans")) { const b = e.target.closest("#mkPlans"); b.disabled = true; b.textContent = "Creating…"; const r = await api("create_plans"); toast(r.ok ? `Created ${r.json.created} plans${r.json.failed ? `, ${r.json.failed} failed` : ""}` : r.json.error || "Failed"); return render(); }
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
