/* BAID X Super Admin. Every read and every action goes through a server function that checks the caller is an
   active staff member (and, for the sensitive ones, a Super Admin). Nothing here is trusted by the database. */
(() => {
  "use strict";
  const cfg = window.BAIDX_CONFIG, sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = (s) => String(s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  const ago = (iso) => { if (!iso) return "—"; const s = Math.max(1, Math.floor((Date.now() - new Date(iso)) / 1000)); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 2592000) return `${Math.floor(s / 86400)}d ago`; return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }); };
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const cedi = (n) => `GH₵${Number(n || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const minor = (m) => cedi((m || 0) / 100);
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const avatar = (name, photo) => `<span class="av" ${photo ? `style="background-image:url('${esc(photo)}')"` : ""}>${photo ? "" : esc(initials(name))}</span>`;
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let toastT; const toast = (m) => { const t = document.getElementById("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200); };
  const S = { me: null, tab: {}, q: "", vf: "pending_verification", role: "", msgConv: null };

  const I = {
    dash: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    fin: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 15h2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.5 3.2-5 6.5-5s5.8 1.5 6.500 5M16 5.500a3.500 3.500 0 0 1 0 6.500M18 15c2 .6 3.200 2 3.500 5"/>',
    ver: '<path d="M12 3 4.500 6v5.500c0 4.500 3 7.800 7.500 9.500 4.500-1.700 7.500-5 7.500-9.500V6z"/><path d="m9 12 2 2 4-4"/>',
    jobs: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
    proj: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    app: '<rect x="5" y="3" width="14" height="18" rx="2.500"/><path d="M9 3h6v3H9zM9 11h6M9 15h6"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.500 2h-15zM10 21h4"/>',
    rep: '<path d="M12 3 4.500 6v5.500c0 4.500 3 7.800 7.500 9.500 4.500-1.700 7.500-5 7.500-9.500V6z"/><path d="M12 9v4M12 16h.01"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.500" cy="8.500" r="1.200"/>',
    audit: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    heart: '<path d="M12 20s-7-4.500-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.500-9 9-9 9z"/>',
    set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.200 4.200l2.100 2.100M17.700 17.700l2.100 2.100M2 12h3M19 12h3M4.200 19.800l2.100-2.100M17.700 6.300l2.100-2.100"/>',
    org: '<path d="M4 20V8l8-4 8 4v12M9 20v-5h6v5M8 11h2M14 11h2"/>',
    plan: '<path d="M12 3v18M17 7.500c0-1.900-2.200-3-5-3s-5 1.100-5 3 2.200 3 5 3 5 1.100 5 3-2.200 3-5 3-5-1.100-5-3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
    out: '<path d="M10 4H5v16h5M16 8l4 4-4 4M20 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const ic = (k, s = 17) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k] || ""}</svg>`;

  const NAV = [
    ["dashboard", "Dashboard", "dash"], ["finance", "Finance", "fin"], ["users", "Users", "users"], ["verification", "Verification", "ver"], ["jobs", "Jobs", "jobs"], ["projects", "Projects", "proj"], ["applications", "Applications", "app"], ["messages", "Messages", "msg"], ["notifications", "Notifications", "bell"], ["reports", "Reports", "rep"], ["analytics", "Analytics", "chart"], ["categories", "Categories", "tag"], ["audit", "Audit", "audit"], ["health", "Health", "heart"], ["settings", "Settings", "set"],
    "Business", ["organizations", "Organizations", "org", 1], ["plans", "Plans & billing", "plan", 1], ["roles", "Roles & access", "key", 1],
  ];
  const TITLES = { dashboard: ["EXECUTIVE DASHBOARD", "Mission Control", "Live platform overview for BAID X: users, hiring, verification, money and system signals in one place."], finance: ["FINANCE", "BAID X Payments", "Confirm Mobile Money deposits, hold and release escrow, pay withdrawals, and manage Paystack."], users: ["USER MANAGEMENT", "All users", ""], verification: ["VERIFICATION CENTER", "Unified queue", "Identity and business documents in one place. Documents are private and open in a secure window."], jobs: ["", "Jobs management", ""], projects: ["", "Project management", ""], applications: ["", "Applications", ""], messages: ["", "Messages", "Message any platform user. Conversations update every few seconds."], notifications: ["COMMUNICATIONS", "Notifications", "Send announcements, broadcast by role, and review delivery history."], reports: ["", "Moderation & reports", ""], analytics: ["ANALYTICS", "Platform trends", ""], categories: ["", "Categories & skills", ""], audit: ["", "Audit logs", "Every sensitive action by staff and the system."], health: ["SYSTEM", "Platform health", "Live signals from the database, payments and review queues."], settings: ["SYSTEM", "Settings", ""], organizations: ["BUSINESS", "Organizations", "Every company or crew workspace, its people and its access."], plans: ["BUSINESS", "Plans & billing", "Prices live in the database. Changing one takes effect without a redeploy."], roles: ["BUSINESS", "Roles & access", "Credential profiles. Access is deny-by-default and every change is audited."] };

  /* ---------------- modal ---------------- */
  const modal = (html) => { closeModal(); const d = document.createElement("div"); d.className = "mo"; d.id = "mo"; d.innerHTML = `<div class="md">${html}</div>`; d.addEventListener("mousedown", (e) => { if (e.target === d) closeModal(); }); document.body.appendChild(d); const f = d.querySelector("input,textarea,select"); if (f) setTimeout(() => f.focus(), 40); return d; };
  const closeModal = () => document.getElementById("mo")?.remove();
  const ask = (title, desc, { field = false, label = "Confirm", danger = false, ph = "" } = {}) => new Promise((res) => {
    const d = modal(`<h3>${esc(title)}</h3>${desc ? `<p class="d">${esc(desc)}</p>` : ""}${field ? `<textarea class="in" id="askv" placeholder="${esc(ph)}"></textarea>` : ""}<div class="acts"><button class="btn gh" data-x="0">Cancel</button><button class="btn ${danger ? "rj" : "ap"}" data-x="1">${esc(label)}</button></div>`);
    d.addEventListener("click", (e) => { const b = e.target.closest("[data-x]"); if (!b) return; const v = d.querySelector("#askv")?.value || ""; closeModal(); res(b.dataset.x === "1" ? { value: v } : null); });
  });

  /* ---------------- login ---------------- */
  function login(msg) {
    app.innerHTML = `<div class="lg"><form class="lg-card" id="lf"><img src="assets/logo.png" alt="BAID X" /><h1>Super Admin</h1><p>For BAID X staff only. Customers sign in on the main site.</p><input class="in" type="email" name="email" placeholder="Staff email" required autocomplete="username" /><input class="in" type="password" name="password" placeholder="Password" required autocomplete="current-password" /><button class="btn-or" type="submit">Sign in</button><div class="lg-err">${esc(msg || "")}</div></form></div>`;
    document.getElementById("lf").addEventListener("submit", async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)), b = e.target.querySelector("button"); b.disabled = true; b.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
      if (error) return login("Those details didn't match.");
      boot();
    });
  }

  async function boot() {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return login();
    let me = null; try { me = await rpc("platform_whoami"); } catch { /* not staff */ }
    if (!me) { await sb.auth.signOut(); return login("This account does not have staff access."); }
    S.me = me; S.email = s.session.user.email; shell(); route();
  }

  /* ---------------- shell ---------------- */
  function shell() {
    const nav = NAV.map((n) => (typeof n === "string" ? `<div class="grp">${esc(n.toUpperCase())}</div>` : `<button class="nv" data-go="${n[0]}">${ic(n[2])}<span>${esc(n[1])}</span>${n[3] ? '<span class="new">NEW</span>' : `<span class="dot" data-badge="${n[0]}" hidden></span>`}</button>`)).join("");
    app.innerHTML = `<aside class="side" id="side"><img class="logo" src="assets/logo.png" alt="BAID X" /><div class="mc">MISSION CONTROL</div><nav class="snav"><div class="grp">PLATFORM</div>${nav}</nav><div class="me"><b>${esc(S.me.label)}</b><small>${esc(S.me.admin_id || "BAID-SUPER-000001")}</small></div><button class="out" id="out">${ic("out")}Log out</button></aside>
      <header class="top"><button class="menu" id="menu" aria-label="Menu">${ic("menu", 20)}</button><div class="t"><small>BAID X SUPER ADMIN</small><span>${esc(S.me.admin_id || "BAID-SUPER-000001")} · platform operating system</span></div><div class="srch"><input id="gs" placeholder="Search people on BAID X…" autocomplete="off" /><div class="res" id="gres"></div></div><div class="bell" id="bell" title="Open queues">${ic("bell", 18)}<i id="belld" hidden></i></div><div class="who"><b>${esc(S.me.name || "BAID X Super Admin")}</b><small>${esc(S.email || "")}</small></div></header>
      <main class="main" id="main"></main>`;
    refreshBadges();
  }
  async function refreshBadges() {
    try {
      const d = await rpc("admin_dashboard"), set = (k, n) => { const e = document.querySelector(`[data-badge="${k}"]`); if (e) { e.hidden = !n; e.textContent = n; } };
      set("verification", d.pending_verification); set("finance", d.deposits_waiting + d.withdrawals_waiting); set("reports", d.reports_open);
      document.getElementById("belld").hidden = !(d.pending_verification + d.deposits_waiting + d.withdrawals_waiting + d.reports_open);
      S.queues = d;
    } catch { /* ignore */ }
  }

  /* ---------------- router ---------------- */
  const parse = () => { const [p, sub] = (location.hash || "#/dashboard").replace(/^#\/?/, "").split("/"); return { p: TITLES[p] ? p : "dashboard", sub: sub || "" }; };
  async function route() {
    if (!S.me) return;
    const { p } = parse(); S.page = p;
    document.querySelectorAll(".nv").forEach((b) => b.classList.toggle("on", b.dataset.go === p));
    document.getElementById("side")?.classList.remove("open");
    const m = document.getElementById("main"), [eb, title, sub] = TITLES[p], token = (S.tok = (S.tok || 0) + 1);
    m.innerHTML = `${eb ? `<div class="eb">${eb}</div>` : ""}<h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : '<div style="height:14px"></div>'}<div id="pg"><div class="skel"></div><div class="skel"></div></div>`;
    let html;
    try { html = await PAGES[p](); } catch (e) { console.error(e); html = `<div class="c empty"><b>Not available</b>${esc(e.message || "Something went wrong.")}</div>`; }
    if (token === S.tok) { const pg = document.getElementById("pg"); pg.innerHTML = html; AFTER[p]?.(); }
  }
  const go = (p, sub) => { location.hash = `#/${p}${sub ? "/" + sub : ""}`; };
  const rerender = () => route();
  const tabs = (key, items, cur) => `<div class="tabs">${items.map(([k, l, nw]) => `<button class="${k === cur ? "on" : ""} ${nw ? "new" : ""}" data-tab="${key}:${k}">${esc(l)}</button>`).join("")}</div>`;
  const tabOf = (key, def) => S.tab[key] || def;
  const tile = (l, n, hl, go2) => `<${go2 ? `button data-go="${go2}"` : "div"} class="c ${go2 ? "link" : ""}"><span class="l">${esc(l)}</span><b class="n ${hl ? "hl" : ""}">${esc(n)}</b></${go2 ? "button" : "div"}>`;
  const table = (heads, rows, empty = "Nothing here yet.") => `<div class="tb"><table><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.length ? rows.join("") : `<tr class="empty"><td colspan="${heads.length}">${esc(empty)}</td></tr>`}</table></div>`;
  const stPill = (s) => `<span class="pill ${["verified", "active", "open", "completed", "resolved", "accepted", "successful", "paid", "released", "processed"].includes(s) ? "ok" : ["rejected", "disabled", "cancelled", "failed", "dismissed", "refunded", "suspended"].includes(s) ? "b" : ["pending_verification", "resubmit_required", "planning", "on_hold", "reviewing", "submitted", "under_review", "locked", "disputed", "pending", "flagged", "grace_period"].includes(s) ? "w" : ""}">${esc(pretty(s))}</span>`;
  const isSuper = () => S.me?.role === "super_admin";

  /* ---------------- pages ---------------- */
  const PAGES = {
    async dashboard() {
      const d = await rpc("admin_dashboard"), r = d.by_role || {};
      const bullets = [
        `${d.signups_today} new registration${d.signups_today === 1 ? "" : "s"} today.`,
        d.pending_verification ? `${d.pending_verification} account${d.pending_verification === 1 ? "" : "s"} awaiting verification. <a data-go="verification">Review now</a>` : "0 accounts awaiting verification.",
        d.deposits_waiting + d.withdrawals_waiting ? `${d.deposits_waiting} deposit${d.deposits_waiting === 1 ? "" : "s"} and ${d.withdrawals_waiting} withdrawal${d.withdrawals_waiting === 1 ? "" : "s"} waiting in Finance. <a data-go="finance">Open</a>` : "No deposits or withdrawals waiting.",
        `${d.reports_open} open report${d.reports_open === 1 ? "" : "s"} need review.`,
        `${d.jobs_open} job${d.jobs_open === 1 ? "" : "s"} currently open across the platform.`,
      ];
      return `<div class="ai"><small>AI COMMAND CENTER</small><ul>${bullets.map((b) => `<li><span>${b}</span></li>`).join("")}</ul></div>
        <div class="g g4">${tile("Total users", d.users, 0, "users")}${tile("Workers", r.worker || 0)}${tile("Companies", r.company || 0)}${tile("Businesses", r.business || 0)}${tile("Project managers", r["project-manager"] || 0)}${tile("Active jobs", d.jobs_open, 0, "jobs")}${tile("Active projects", d.projects_active, 0, "projects")}${tile("Pending verification", d.pending_verification, d.pending_verification > 0, "verification")}${tile("Applications", d.applications, 0, "applications")}${tile("Signups today", d.signups_today)}${tile("Open reports", d.reports_open, d.reports_open > 0, "reports")}${tile("Clients", r["individual-employer"] || 0)}</div>
        <h2 class="sec">Business</h2><div class="g g4">${tile("Organizations", d.orgs, 0, "organizations")}${tile("Paid subscriptions", d.paid_subs, 0, "plans")}${tile("Revenue (net)", minor(d.revenue_minor), 1, "finance")}${tile("Needs review", d.needs_review, d.needs_review > 0, "finance")}</div>`;
    },

    async finance() {
      const [f, q] = await Promise.all([rpc("admin_finance"), rpc("admin_money_queue")]);
      S.fin = f; S.mq = q;
      const t = tabOf("finance", "overview");
      const items = [["overview", "Overview"], ["deposits", `Deposits (${q.deposits.length})`], ["escrow", `Escrow (${f.escrow_count})`], ["withdrawals", `Withdrawals (${q.withdrawals.length})`], ["disputes", `Disputes (${f.disputes_open})`], ["provider", "Provider"], ["paystack", "Paystack", 1], ["recon", "Reconciliation", 1]];
      let body = "";
      if (t === "overview") body = `<div class="g g4">${tile("Transaction volume", cedi(f.volume))}${tile("BAID X commission", cedi(f.commission), 1)}${tile("Platform wallet", cedi(f.platform_wallet), 1)}${tile("User balances", cedi(f.user_balances))}${tile("Active escrow", `${cedi(f.escrow_amount)} (${f.escrow_count})`)}${tile("Completed payments", f.completed_payments)}${tile("Pending deposits", f.deposits_waiting)}${tile("Fraud alerts", f.fraud)}</div>`;
      if (t === "deposits") body = table(["Member", "Reference", "Amount", "Proof", "Status", "Actions"], q.deposits.map((d) => `<tr><td>${avatar(d.owner_name)}<b>${esc(d.owner_name)}</b><div class="mono">${esc(pretty(d.role))}</div></td><td class="mono">${esc(d.ref)}<div class="mut">${esc(d.note || "")}</div></td><td><b>${cedi(d.amount)}</b></td><td>${d.proof ? `<button class="btn gh" data-doc="payment-proofs" data-path="${esc(d.proof)}">View</button>` : "—"}</td><td>${stPill(d.status)}</td><td><button class="btn ap" data-dd="1" data-id="${esc(d.id)}">Confirm received</button><button class="btn rj" data-dd="0" data-id="${esc(d.id)}">Reject</button></td></tr>`), "No deposits waiting.");
      if (t === "withdrawals") body = table(["Member", "Reference", "Amount", "Pay to", "Status", "Actions"], q.withdrawals.map((w) => `<tr><td>${avatar(w.owner_name)}<b>${esc(w.owner_name)}</b><div class="mono">${esc(pretty(w.role))}</div></td><td class="mono">${esc(w.ref)}</td><td><b>${cedi(w.amount)}</b></td><td>${esc(w.name || "")}<div class="mono">${esc(w.network || "")} ${esc(w.account || "")}</div></td><td>${stPill(w.status)}</td><td><button class="btn ap" data-wd="completed" data-id="${esc(w.id)}">Mark as paid</button><button class="btn gh" data-wd="rejected" data-id="${esc(w.id)}">Return to wallet</button></td></tr>`), "No withdrawals waiting.");
      if (t === "escrow") body = table(["Reference", "Payer", "Receiver", "Amount", "Status", "Actions"], f.escrow.map((e) => `<tr><td class="mono">${esc(e.ref || "")}<div class="mut">${esc(e.description || "")}</div></td><td>${esc(e.payer)}</td><td>${esc(e.receiver)}</td><td><b>${cedi(e.amount)}</b></td><td>${stPill(e.status)}</td><td>${["locked", "disputed"].includes(e.status) ? `<button class="btn ap" data-esc="release" data-id="${esc(e.id)}">Release 85 / 15</button><button class="btn gh" data-esc="refund" data-id="${esc(e.id)}">Refund payer</button>` : "—"}</td></tr>`), "No escrow holds yet.");
      if (t === "disputes") body = table(["Reference", "Raised by", "Reason", "Status", "Actions"], f.disputes.map((d) => `<tr><td class="mono">${esc(d.ref || "")}<div class="mut">${esc(ago(d.created_at))}</div></td><td>${esc(d.by)}</td><td>${esc(d.reason || "")}${d.resolution ? `<div class="mut">${esc(d.resolution)}</div>` : ""}</td><td>${stPill(d.status)}</td><td>${["open", "under_review"].includes(d.status) ? `<button class="btn gh" data-dp="under_review" data-id="${esc(d.id)}">Review</button><button class="btn ap" data-dp="resolved" data-id="${esc(d.id)}">Resolve</button><button class="btn rj" data-dp="rejected" data-id="${esc(d.id)}">Reject</button>` : "—"}</td></tr>`), "No disputes.");
      if (t === "provider") body = f.providers.length ? f.providers.map((p) => `<div class="c" style="margin-bottom:14px"><div class="row2"><b>${esc(p.display_name)}</b>${stPill(p.is_active ? "active" : "disabled")}<span class="mono">${esc(p.code)}</span>${isSuper() ? `<button class="btn gh ml" data-prov="${esc(p.id)}">Edit</button>` : ""}</div><div class="kv"><span>Number</span><b>${esc(p.account_number || "—")}</b></div><div class="kv"><span>Account name</span><b>${esc(p.account_name || "—")}</b></div><div class="kv"><span>Instructions shown to members</span><span style="max-width:60%;text-align:right">${esc(p.instructions || "—")}</span></div></div>`).join("") : `<div class="c empty"><b>No provider set up</b></div>`;
      if (t === "paystack") body = `<div class="c" id="psbox"><span class="l">Paystack connection</span><div class="mut" style="margin-top:10px">Checking…</div></div>`;
      if (t === "recon") { const r = await rpc("admin_reconciliation"); body = recon(r); }
      return tabs("finance", items, t) + body;
    },

    async users() {
      const list = await rpc("admin_users", { p_role: S.role || null, p_q: S.q || null });
      S.ulist = list;
      const chips = [["", "All Users"], ["worker", "Workers"], ["company", "Companies"], ["business", "Businesses"], ["project-manager", "Project Managers"], ["individual-employer", "Clients"]];
      return `<div class="chips">${chips.map(([k, l]) => `<button class="${k === S.role ? "on" : ""}" data-role="${k}">${l}</button>`).join("")}</div>
        <form class="row2" id="uq" style="margin-bottom:14px"><input class="in" style="flex:1;min-width:200px" id="uqi" placeholder="Search name, BAID ID, email, phone…" value="${esc(S.q)}" /><button class="btn-or" type="submit">Search</button></form>
        ${table(["User", "Role", "Verification", "Plan", "Account", "Actions"], list.map((u, i) => `<tr><td>${avatar(u.name, u.photo)}<b>${esc(u.name)}</b><div class="mono">${esc(u.baid || "")}${u.phone ? " · " + esc(u.phone) : ""}</div>${u.email ? `<div class="mono">${esc(u.email)}</div>` : ""}</td><td>${esc(pretty(u.role))}</td><td>${stPill(u.verification || "unverified")}</td><td><span class="pill">${esc(pretty(u.plan))}</span></td><td>${stPill(u.account_status || "active")}</td><td><button class="btn gh" data-prof="${i}">Profile</button>${(u.account_status || "active") === "active" ? `<button class="btn gh w" data-acct="suspended" data-i="${i}">Suspend</button>` : `<button class="btn gh ok" data-acct="active" data-i="${i}">Reactivate</button>`}${u.account_status !== "disabled" ? `<button class="btn gh b" data-acct="disabled" data-i="${i}">Ban</button>` : ""}<button class="btn gh" data-msg="${esc(u.id)}">Message</button></td></tr>`), "No users match.")}`;
    },

    async verification() {
      const st = ["pending_verification", "resubmit_required", "rejected", "verified"];
      const all = await Promise.all(st.map((s) => rpc("admin_verification_queue", { p_status: s })));
      S.vq = Object.fromEntries(st.map((s, i) => [s, all[i]]));
      const f = S.vf, list = S.vq[f] || [];
      const names = { pending_verification: "Waiting", resubmit_required: "Needs action", rejected: "Rejected", verified: "Verified" };
      return `<div class="tabs">${st.map((s) => `<button class="${s === f ? "on" : ""}" data-vf="${s}">${names[s]} ${S.vq[s].length}</button>`).join("")}</div>` + (list.length ? `<div class="g g2">${list.map((x, i) => vcard(x, i, f)).join("")}</div>` : `<div class="c empty"><b>Nothing here</b>${f === "pending_verification" ? "No profiles are waiting for review." : "No profiles with this status."}</div>`);
    },

    async jobs() {
      const l = await rpc("admin_jobs");
      return table(["Title", "Posted by", "Status", "Location", "Applicants", "Actions"], l.map((j) => `<tr><td><b>${esc(j.title)}</b><div class="mono">${esc(j.category || "")}${j.rate ? " · " + cedi(j.rate) + "/day" : ""}</div></td><td>${esc(j.poster)}</td><td>${stPill(j.status)}</td><td>${esc([j.city, j.region].filter(Boolean).join(", ") || "—")}</td><td>${j.applicants}</td><td>${j.status !== "open" ? `<button class="btn gh ok" data-job="open" data-id="${esc(j.id)}">Open</button>` : ""}${j.status === "open" ? `<button class="btn gh" data-job="closed" data-id="${esc(j.id)}">Close</button>` : ""}${j.status !== "cancelled" ? `<button class="btn gh b" data-job="cancelled" data-id="${esc(j.id)}">Cancel</button>` : ""}</td></tr>`), "No jobs yet.");
    },
    async projects() {
      const l = await rpc("admin_projects");
      return table(["Name", "Company", "Status", "Progress", "Actions"], l.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="mono">${esc(p.code || "")}${p.pm ? " · PM " + esc(p.pm) : ""}</div></td><td>${esc(p.company)}</td><td>${stPill(p.status)}</td><td style="min-width:130px"><div class="bar"><i style="width:${p.progress || 0}%"></i></div><div class="mono">${p.progress || 0}%</div></td><td>${[["on_hold", "On Hold"], ["cancelled", "Cancelled"], ["completed", "Completed"], ["active", "Active"]].filter(([k]) => k !== p.status).map(([k, v]) => `<button class="btn gh" data-proj="${k}" data-id="${esc(p.id)}">${v}</button>`).join("")}</td></tr>`), "No projects yet.");
    },
    async applications() {
      const l = await rpc("admin_applications");
      return table(["Worker", "Job", "Rate", "Status", "Applied"], l.map((a) => `<tr><td><b>${esc(a.worker)}</b></td><td>${esc(a.job || "—")}</td><td>${a.rate ? cedi(a.rate) : "—"}</td><td>${stPill(a.status)}</td><td class="mut">${esc(ago(a.created_at))}</td></tr>`), "No applications yet.");
    },

    async messages() {
      const list = (await rpc("admin_my_conversations").catch(() => rpc("my_conversations"))) || [];
      S.convs = list;
      return `<div class="msgs"><div class="lst"><div class="lh"><b>Messages</b><small>Direct chats with your network</small></div><div class="lh"><input class="in" id="mq" placeholder="Search a person to message…" style="background:#111827;border-color:#1f2937;color:#fff" /><div id="mres"></div></div>${list.length ? list.map((c) => `<button class="cv ${c.id === S.msgConv ? "on" : ""}" data-conv="${esc(c.id)}">${avatar(c.peer_name, c.peer_photo)}<span style="min-width:0"><b>${esc(c.peer_name)}</b><small>${esc(c.preview || "No messages yet")}</small></span>${c.unread ? `<span class="pill" style="margin-left:auto;background:var(--or);color:#fff">${c.unread}</span>` : ""}</button>`).join("") : `<div class="none"><b>No conversations yet</b>Use the search above to find someone and start messaging.</div>`}</div><div class="th" id="th">${S.msgConv ? "" : `<div class="none"><b>Select a conversation</b>Or search for a person to start a new chat.</div>`}</div></div>`;
    },

    async notifications() {
      const t = tabOf("notif", "broadcast");
      const items = [["broadcast", "Broadcast"], ["history", "History"], ["delivery", "Delivery"]];
      if (t === "broadcast") return tabs("notif", items, t) + `<form class="c" id="bf"><div class="row2" style="margin-bottom:14px;color:var(--or);font-weight:800">Compose announcement</div><label class="fl"><span>Title</span><input class="in" name="title" placeholder="Platform update" required maxlength="100" /></label><label class="fl"><span>Message</span><textarea class="in" name="body" placeholder="Tell members what's new…" required maxlength="1000"></textarea></label><label class="fl"><span>Link (optional)</span><input class="in" name="href" placeholder="#/billing" /></label>
        <div class="fl"><span>Target roles</span><div class="seg" id="roleseg">${[["", "All members"], ["worker", "Workers"], ["company", "Companies"], ["project-manager", "Project managers"], ["business", "Businesses"], ["individual-employer", "Clients"]].map(([k, l], i) => `<button type="button" class="${i === 0 ? "on" : ""}" data-r="${k}">${l}</button>`).join("")}</div></div>
        <div class="fl"><span>Channels</span><div class="seg"><button type="button" class="chan on" disabled>In-app</button><button type="button" class="chan" data-ch="email">Email</button><button type="button" class="chan" data-ch="sms">SMS</button><button type="button" class="chan" data-ch="push">Push</button></div><small>In-app delivers now. Tick SMS to also text everyone in the audience who has a phone number (you'll see the cost and confirm first). Email and push are recorded only.</small></div>
        <button class="btn-or" type="submit">Send broadcast</button></form>`;
      const b = await rpc("admin_broadcasts"), sb2 = t === "delivery" ? await rpc("admin_sms_broadcasts").catch(() => []) : [];
      if (t === "history") return tabs("notif", items, t) + table(["When", "Title", "To", "Recipients", "Channels"], b.history.map((x) => `<tr><td class="mut">${esc(when(x.created_at))}</td><td><b>${esc(x.title)}</b><div class="mut">${esc(x.body)}</div></td><td>${esc((x.target_roles || []).length ? x.target_roles.map(pretty).join(", ") : "All members")}</td><td>${x.recipient_count}</td><td>${(x.channels || []).map((c) => `<span class="pill ${c === "in_app" ? "ok" : "w"}">${esc(pretty(c))}</span>`).join(" ")}</td></tr>`), "No broadcasts yet.");
      return tabs("notif", items, t) + `<div class="c" style="margin-bottom:14px"><span class="l">Delivery</span><p class="mut" style="margin-top:8px">In-app announcements are delivered the moment you send. SMS announcements go out through SasuSync when SMS is ticked. Email has no provider connected.</p></div>` + `<h2 class="sec">SMS announcements</h2>` + table(["When", "Message", "To", "People", "Accepted", "Credits", "Status"], sb2.map((x) => `<tr><td class="mut">${esc(when(x.created_at))}</td><td>${esc(x.message)}${x.mode === "sandbox" ? ' <span class="pill b">sandbox</span>' : ""}</td><td>${esc((x.target_roles || []).length ? x.target_roles.map(pretty).join(", ") : "All members")}</td><td>${x.recipients}</td><td>${x.accepted}</td><td>${x.credits_used ?? "—"}</td><td>${stPill(x.status)}${x.error ? `<div class="mut">${esc(x.error)}</div>` : ""}</td></tr>`), "No SMS announcements yet.") + `<h2 class="sec" style="margin-top:18px">Other deliveries</h2>` + table(["When", "Channel", "Status", "Provider", "Note"], b.logs.map((l) => `<tr><td class="mut">${esc(when(l.created_at))}</td><td>${esc(pretty(l.channel))}</td><td>${stPill(l.status)}</td><td>${esc(l.provider || "—")}</td><td class="mut">${esc(l.error || "")}</td></tr>`), "No delivery logs yet.");
    },

    async reports() {
      const l = await rpc("admin_reports");
      return table(["Report", "Category", "Status", "Filed by", "Actions"], l.map((r) => `<tr><td><b>${esc(r.title || "Report")}</b><div class="mut">${esc(r.notes || "")}</div>${r.resolution ? `<div class="mono">Resolution: ${esc(r.resolution)}</div>` : ""}</td><td>${esc(pretty(r.category))}<div class="mono">${esc(pretty(r.target_type))}</div></td><td>${stPill(r.status)}</td><td>${esc(r.reporter)}<div class="mono">${esc(ago(r.created_at))}</div></td><td>${["open", "reviewing"].includes(r.status) ? `<button class="btn gh" data-rep="reviewing" data-id="${esc(r.id)}">Review</button><button class="btn ap" data-rep="resolved" data-id="${esc(r.id)}">Resolve</button><button class="btn gh" data-rep="dismissed" data-id="${esc(r.id)}">Dismiss</button>` : "—"}</td></tr>`), "No reports filed yet.");
    },

    async analytics() {
      const a = await rpc("admin_analytics"), max = Math.max(1, ...a.signups.map((x) => x.n)), w = 100 / a.signups.length;
      const bars = a.signups.map((x, i) => { const h = Math.round((x.n / max) * 130); return `<rect x="${i * w + w * 0.15}%" y="${150 - h}" width="${w * 0.7}%" height="${Math.max(h, x.n ? 2 : 0)}" rx="3" fill="#f97316" opacity="${x.n ? 1 : 0.25}"/>${x.n ? `<text x="${i * w + w / 2}%" y="${142 - h}" text-anchor="middle" font-size="10" font-weight="700" fill="#374151">${x.n}</text>` : ""}<text x="${i * w + w / 2}%" y="176" text-anchor="middle" font-size="9.5" fill="#6b7280">${x.day}</text>`; }).join("");
      const lst = (o) => Object.keys(o).length ? Object.entries(o).map(([k, v]) => `<div class="kv"><span>${esc(pretty(k))}</span><b>${v}</b></div>`).join("") : '<div class="mut">No data</div>';
      return `<div class="chart"><b>Daily signups (14 days)</b><svg viewBox="0 0 600 190" preserveAspectRatio="none" role="img" aria-label="Daily signups">${bars}</svg></div><div class="g g3" style="margin-top:14px"><div class="c"><b>Users by role</b>${lst(a.roles)}</div><div class="c"><b>Jobs by status</b>${lst(a.jobs)}</div><div class="c"><b>Applications by status</b>${lst(a.applications)}</div></div>`;
    },

    async categories() {
      const { data } = await sb.from("job_categories").select("id,name,phase,slug,is_active,sort_order").order("sort_order");
      S.cats = data || [];
      return `<div class="c"><div class="row2"><b>Job categories (${S.cats.length})</b><button class="btn-or ml" data-cat="new">Add category</button></div><div class="g g3" style="margin-top:14px">${S.cats.map((c, i) => `<div class="cat"><span><b>${esc(c.name)}</b><small>${esc(c.slug || "")} · ${esc(pretty(c.phase))} · ${c.is_active ? "active" : "hidden"}</small></span><span><button class="btn gh" data-cat="${i}">Edit</button></span></div>`).join("")}</div></div>`;
    },

    async audit() {
      const l = await rpc("admin_audit");
      return table(["When", "Actor", "Action", "Entity"], l.map((x) => `<tr><td class="mut">${esc(when(x.at))}</td><td class="mono">${esc(x.actor)}</td><td>${esc(x.action)}</td><td>${esc(pretty(x.entity))} <span class="mono">${esc(String(x.entity_id || "").slice(0, 8))}</span></td></tr>`), "No audit entries yet.");
    },

    async health() {
      const sms = await smsPanel();
      const h = await rpc("admin_health"), conn = await api("status").catch(() => ({ json: {} })), c = conn.json || {};
      const sig = (label, val, ok, note) => `<div class="c"><span class="l">${esc(label)}</span><b class="n ${ok === false ? "hl" : ""}">${esc(val)}</b><div class="mut" style="margin-top:6px;font-size:12px">${esc(note || "")}</div></div>`;
      return `<div class="g g4">${sig("Database", "Online", true, `Server time ${when(h.db_time)}`)}${sig("Paystack", c.mode ? pretty(c.mode) + " mode" : "Not connected", c.mode === "test" || c.mode === "live", c.plans ? `${c.plans_with_code} of ${c.plans} plans linked` : "Keys not detected")}${sig("Webhook problems", h.webhook_flagged + h.webhook_failed, h.webhook_flagged + h.webhook_failed === 0, h.webhook_last ? `Last event ${ago(h.webhook_last)}` : "No events received yet")}${sig("Payments to review", h.payments_flagged, h.payments_flagged === 0, "Amount or currency mismatches")}${sig("Verification waiting", h.unverified_waiting, true, "Open the Verification queue")}${sig("Deposits waiting", h.deposits_waiting, true, "Confirm in Finance")}${sig("Withdrawals waiting", h.withdrawals_waiting, true, "Pay out in Finance")}${sig("Two-step sign-in", h.mfa_enforced ? "Enforced" : "Not enforced", h.mfa_enforced, "Required for privileged roles")}${sig("Active staff", h.staff_active, h.staff_active <= 2, "Keep this number small")}${sig("Stale checkouts", h.pending_checkouts, true, "Pending for over a day")}${sig("Last audit entry", h.last_audit ? ago(h.last_audit) : "—", true, "")}</div>${sms}`;
    },

    async settings() {
      const s = await rpc("admin_settings");
      return `<div class="g g2"><div class="c"><b>Platform settings</b><p class="mut" style="margin:6px 0 12px">Escrow commission is applied when escrow is released.</p><form id="setf" class="row2"><label class="fl" style="flex:1;margin:0"><span>Commission rate</span><input class="in" name="rate" type="number" step="0.01" min="0" max="0.5" value="${esc(s.commission_rate)}" ${isSuper() ? "" : "disabled"} /></label>${isSuper() ? '<button class="btn-or" type="submit" style="margin-top:18px">Save</button>' : ""}</form>
        <h2 class="sec">All settings</h2>${s.platform.length ? s.platform.map((r) => `<div class="kv"><span class="mono">${esc(r.key)}</span><span>${esc(JSON.stringify(r.value))}</span></div>`).join("") : '<div class="mut">No other settings stored.</div>'}</div>
        <div><div class="c" style="margin-bottom:14px"><b>Security</b><div class="row2" style="margin:10px 0"><span class="pill ${s.mfa ? "ok" : ""}">${s.mfa ? "Two-step enforced" : "Two-step not enforced"}</span></div><p class="mut">Privileged roles need an authenticator code once this is on. Enrol your own authenticator first.</p>${isSuper() ? `<button class="btn-or" style="margin-top:12px" data-mfa="${s.mfa ? "0" : "1"}">${s.mfa ? "Turn off" : "Turn on"}</button>` : ""} <button class="btn gh" style="margin-top:12px" data-mfa-enrol>Set up my authenticator</button></div>
        <form class="c" id="pwf"><b>My account</b><p class="mut" style="margin:6px 0 12px">${esc(S.email)}</p><label class="fl"><span>New password</span><input class="in" type="password" name="pw" minlength="10" required autocomplete="new-password" /><small>At least 10 characters.</small></label><button class="btn-or" type="submit">Change password</button></form></div></div>`;
    },

    async organizations() {
      const [list, ov] = await Promise.all([rpc("platform_orgs"), rpc("platform_overview")]);
      return `<div class="g g4" style="margin-bottom:16px">${tile("Organizations", ov.orgs)}${tile("Active", ov.orgs_active)}${tile("People in orgs", ov.members)}${tile("Open invites", ov.invites_open)}</div>` + table(["Organization", "Owner", "People", "Type", "Status", "Actions"], list.map((o) => `<tr><td><b>${esc(o.name)}</b><div class="mono">${esc(o.public_code)}</div></td><td>${esc(o.owner)}</td><td>${o.members}</td><td>${esc(pretty(o.org_type))}</td><td>${stPill(o.status.toLowerCase())}</td><td>${o.status === "ACTIVE" ? `<button class="btn gh w" data-org="${esc(o.org_id)}" data-s="SUSPENDED">Suspend</button>` : `<button class="btn ap" data-org="${esc(o.org_id)}" data-s="ACTIVE">Restore</button>`}</td></tr>`), "No organizations yet.");
    },

    async plans() {
      const p = await rpc("admin_plans"), t = tabOf("plans", "plans");
      const items = [["plans", "Plans"], ["subs", `Subscriptions (${p.subs.length})`], ["founding", "Founding program"], ["services", "Boosts & services"]];
      let body = "";
      if (t === "plans") {
        const roles = ["worker", "individual-employer", "business", "project-manager", "company"], tiers = ["pro", "premium", "enterprise"];
        const cell = (r, tier, iv, fd) => { const x = p.plans.find((q) => q.role === r && q.tier === tier && q.interval === iv && q.founding === fd); return x ? (isSuper() ? `<button class="btn gh" data-price="${esc(x.id)}" data-v="${x.price_minor}">${minor(x.price_minor).replace(".00", "")}</button>` : minor(x.price_minor).replace(".00", "")) : "—"; };
        body = table(["Account type", "Tier", "Monthly", "Annual", "Founding monthly", "Founding annual"], roles.flatMap((r) => tiers.filter((tr) => p.plans.some((q) => q.role === r && q.tier === tr)).map((tr) => `<tr><td><b>${esc(pretty(r))}</b></td><td>${esc(pretty(tr))}</td><td>${cell(r, tr, "monthly", false)}</td><td>${cell(r, tr, "annual", false)}</td><td>${cell(r, tr, "monthly", true)}</td><td>${cell(r, tr, "annual", true)}</td></tr>`))) + `<p class="mut" style="margin-top:10px">Changing a price clears its Paystack plan link. Create the Paystack plans again in Finance → Paystack.</p>`;
      }
      if (t === "subs") body = table(["Owner", "Plan", "Billing", "Status", "Renews"], p.subs.map((s) => `<tr><td><b>${esc(s.org || s.user)}</b>${s.founding ? ' <span class="pill w">Founding</span>' : ""}</td><td>${esc(pretty(s.role))} · ${esc(pretty(s.tier))}</td><td>${esc(pretty(s.interval))}</td><td>${stPill(s.status)}</td><td class="mut">${esc(day(s.period_end))}</td></tr>`), "No subscriptions yet.");
      if (t === "founding") { const started = p.founding.some((f) => f.start); body = `<div class="c" style="margin-bottom:14px"><div class="row2"><span class="pill ${started ? "ok" : "w"}">${started ? "Running" : "Not started"}</span><span class="mut">1,700 places · ends after 90 days or when full · each price held for 12 months from the member's start</span>${!started && isSuper() ? '<button class="btn-or ml" data-founding>Start program</button>' : ""}</div></div>` + table(["Account type", "Claimed", "Places", "Started", "Ends"], p.founding.map((f) => `<tr><td><b>${esc(pretty(f.role))}</b></td><td>${f.claimed}</td><td>${f.total}</td><td class="mut">${esc(day(f.start))}</td><td class="mut">${f.start ? esc(day(f.end)) : "—"}</td></tr>`)); }
      if (t === "services") body = table(["Kind", "Item", "For", "Price"], p.services.map((s) => `<tr><td>${esc(pretty(s.kind))}</td><td><b>${esc(s.label)}</b></td><td>${esc(s.role ? pretty(s.role) : "Everyone")}</td><td>${minor(s.price_minor)}</td></tr>`));
      return tabs("plans", items, t) + body;
    },

    async roles() {
      const [m, h] = await Promise.all([rpc("access_matrix"), rpc("admin_health")]), t = tabOf("roles", "platform");
      const grants = (k) => { const by = {}; m.grants.filter((g) => g.role === k).forEach((g) => (by[g.resource] = by[g.resource] || []).push(g.action.toLowerCase())); return Object.entries(by).sort().map(([r, a]) => `<div class="kv"><span>${esc(pretty(r))}</span><span class="chk">${a.map((x) => `<span class="chip o">${x}</span>`).join("")}</span></div>`).join(""); };
      return tabs("roles", [["platform", "Platform staff"], ["organization", "Organizations"]], t) + `<div class="g g3">${m.roles.filter((r) => r.tier === t).map((r) => `<div class="c"><div class="row2"><b>${esc(r.label)}</b>${r.privileged ? '<span class="pill w ml">2-step</span>' : ""}</div><div class="mut" style="margin:6px 0 10px;font-size:12.5px">${esc(r.description)}</div>${grants(r.key)}</div>`).join("")}</div>
        <div class="c" style="margin-top:16px"><span class="l">Two-step verification</span><div class="row2" style="margin-top:10px"><span class="pill ${h.mfa_enforced ? "ok" : ""}">${h.mfa_enforced ? "Enforced" : "Not enforced"}</span><span class="mut">Turn it on in Settings once everyone has enrolled.</span><button class="btn-or ml" data-go="settings">Open settings</button></div></div>`;
    },
  };

  const AFTER = {
    finance() { if (tabOf("finance", "overview") === "paystack") paystackBox(); },
    messages() { if (S.msgConv) openConv(S.msgConv); },
  };

  /* ---------------- fragments ---------------- */
  const BUCKET = { ghana_card_front_url: "ghana-cards", ghana_card_back_url: "ghana-cards", contact_ghana_card_url: "ghana-cards", business_registration_doc_url: "business-docs", trade_license_url: "trade-licenses", qualification_doc_url: "trade-licenses", certification_doc_url: "trade-licenses", application_letter_url: "application-letters", ghana_card_front: "ghana-cards", ghana_card_back: "ghana-cards" };
  const ROLE_NAME = { worker: "Professional", "project-manager": "Project manager", company: "Company", business: "Supplier", "individual-employer": "Client" };
  function vcard(x, i, f) {
    const docs = Object.entries(x.docs || {}).flatMap(([k, v]) => (k === "profile_sections" && v && typeof v === "object" ? Object.entries(v).filter(([kk]) => kk.startsWith("ghana_card")) : [[k, v]])).filter(([, v]) => v && typeof v === "string");
    const label = (k) => pretty(k.replace(/_url$/, "").replace(/_/g, " "));
    return `<div class="c"><div class="row2">${avatar(x.name)}<div><b>${esc(x.name || "Unnamed")}</b><div class="mono">${esc(ROLE_NAME[x.role] || x.role)} · ${esc(x.phone || "")}${x.region ? " · " + esc(x.region) : ""}</div></div><span class="ml">${stPill(x.status)}</span></div>
      <div style="margin-top:12px">${docs.map(([k, v]) => (BUCKET[k] || /^https?:/.test(v)) ? `<div class="doc"><span>${esc(label(k))}</span><button class="btn gh" data-doc="${esc(BUCKET[k] || "")}" data-path="${esc(v)}">View</button></div>` : `<div class="doc"><span>${esc(label(k))}</span><b>${esc(v)}</b></div>`).join("") || '<div class="mut">No documents on file.</div>'}</div>
      ${x.rejection_reason ? `<div class="kv"><span>Last note</span><span>${esc(x.rejection_reason)}</span></div>` : ""}
      <div style="margin-top:12px">${f !== "verified" ? `<button class="btn ap" data-vd="verified" data-s="${f}" data-i="${i}">Approve</button>` : ""}<button class="btn rs" data-vd="resubmit_required" data-s="${f}" data-i="${i}">Resubmit</button>${f !== "rejected" ? `<button class="btn rj" data-vd="rejected" data-s="${f}" data-i="${i}">Reject</button>` : ""}${f === "verified" ? `<button class="btn gh" data-vd="pending_verification" data-s="${f}" data-i="${i}">Reset to review</button>` : ""}</div></div>`;
  }
  function recon(r) {
    const sec = (title, rows, heads, cells) => `<h2 class="sec">${title} (${rows.length})</h2>` + (rows.length ? table(heads, rows.map(cells)) : `<div class="c mut" style="padding:12px 16px">All clear.</div>`);
    return `<p class="mut" style="margin-bottom:6px">Compares Paystack payments with BAID X records. Nothing here changes automatically. Every fix is made by hand and audited.</p>`
      + sec("Amount or currency mismatch", r.mismatch, ["Reference", "Expected", "Received", "Note", "Status"], (x) => `<tr><td class="mono">${esc(x.ref)}</td><td>${minor(x.expected)}</td><td>${minor(x.received)}</td><td class="mut">${esc(x.note || "")}</td><td>${stPill(x.status)}</td></tr>`)
      + sec("Paid but not activated", r.paid_inactive, ["Reference", "Amount", "When"], (x) => `<tr><td class="mono">${esc(x.ref)}</td><td>${minor(x.amount)}</td><td class="mut">${esc(when(x.at))}</td></tr>`)
      + sec("Active but no payment on record", r.active_unpaid, ["Member", "Status"], (x) => `<tr><td>${esc(x.user)}</td><td>${stPill(x.status)}</td></tr>`)
      + sec("Refund mismatch", r.refund_mismatch, ["Reference", "Refunded", "Status"], (x) => `<tr><td class="mono">${esc(x.ref)}</td><td>${minor(x.refunded)}</td><td>${stPill(x.status)}</td></tr>`)
      + sec("Flagged webhook events", r.events, ["Event", "Status", "Problem", "When"], (x) => `<tr><td>${esc(x.type)}</td><td>${stPill(x.status)}</td><td class="mut">${esc(x.error || "")}</td><td class="mut">${esc(when(x.at))}</td></tr>`);
  }

  /* ---------------- api (Paystack admin) ---------------- */
  async function api(action) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/paystack-admin", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action }) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }
  async function smsCall(body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/sasusync-admin", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }
  /* SasuSync SMS/OTP health: read-only provider checks (spend nothing). Never shows keys, secrets or codes. */
  async function smsPanel() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch("/api/sasusync-admin", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "refresh" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return "";
      const c = j.capacity, o = j.overview || {}, lvl = c ? c.level : null;
      const pill = (t, cls) => `<span class="pill ${cls}">${esc(t)}</span>`;
      const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
      const d7 = o.delivery_7d || {};
      return `<h2 class="sec" style="margin-top:22px">SMS &amp; verification codes (SasuSync)</h2><div class="c">
        <div class="row2">${pill(j.live_allowed ? "Live enabled" : "Live disabled", j.live_allowed ? "ok" : "w")}${pill(j.mode === "live" ? "Live mode" : "Sandbox mode", "b")}${j.sender ? pill(`Sender “${j.sender_id}”: ${pretty(j.sender.status)}`, j.sender.status === "approved" ? "ok" : "w") : ""}${lvl && lvl !== "OK" ? pill(lvl === "EXHAUSTED" ? "Credits exhausted" : "Credits low", "w") : ""}${pill(j.phone_auth ? "Phone sign-in on" : "Phone sign-in off", j.phone_auth ? "ok" : "b")}${pill(o.sms_notifications_enabled ? "SMS alerts on" : "SMS alerts off", o.sms_notifications_enabled ? "ok" : "b")}</div>
        ${c ? kv("SMS you can still send", c.sms_sendable) + kv("Verification codes you can still send", c.otp_sendable) + (c.credits_per_otp ? kv("Credits per code", c.credits_per_otp) : "") + (c.main_balance !== undefined ? kv("Main balance", `${c.main_balance} ${c.currency || ""}`) : "") : `<p class="mut">${j.error ? "The provider couldn't be reached." : "Provider not configured."}</p>`}
        ${kv("Last delivery report received", o.last_webhook_at ? ago(o.last_webhook_at) : "None yet")}${kv("Deliveries (7 days)", Object.keys(d7).length ? Object.entries(d7).map(([k, v]) => `${k} ${v}`).join(" · ") : "None")}${kv("Codes requested / verified (24h)", `${o.otp_requests_24h ?? 0} / ${o.otp_verified_24h ?? 0}`)}
        ${j.live_allowed && isSuper() ? `<div style="margin-top:12px"><button class="btn-or" data-sms-live>Send ONE live test SMS</button> <span class="pill w">LIVE — REAL SMS · uses 1+ credits</span> <button class="btn gh" data-sms-lookup>Look up job</button><div id="smsres" class="mut" style="margin-top:8px"></div></div>` : ""}
        ${j.mode === "sandbox" && isSuper() ? `<div style="margin-top:12px"><button class="btn gh" data-sms-sandbox>Send Sandbox Test</button> <span class="pill b">SANDBOX — NO DELIVERY</span> <button class="btn gh" data-sms-lookup>Look up job</button><div id="smsres" class="mut" style="margin-top:8px"></div></div>` : ""}
        <p class="mut" style="margin-top:8px">Live sending is off until the owner turns it on in Vercel.</p></div>`;
    } catch { return ""; }
  }
  async function paystackBox() {
    const box = document.getElementById("psbox"); if (!box) return;
    const r = await api("status").catch(() => ({ ok: false, json: {} })), c = r.json || {};
    if (!r.ok) { box.innerHTML = `<span class="l">Paystack connection</span><p class="mut" style="margin-top:10px">${esc(c.error || "Only a Super Admin can see this.")}</p>`; return; }
    const mode = c.mode === "test" ? '<span class="pill w">Test mode</span>' : c.mode === "live" ? '<span class="pill ok">Live</span>' : '<span class="pill b">Not connected</span>';
    box.innerHTML = `<div class="row2"><span class="l">Paystack connection</span>${mode}</div><div class="kv"><span>Plans linked</span><b>${c.plans_with_code ?? 0} of ${c.plans ?? 0}</b></div><div class="kv"><span>Webhook URL</span><b style="word-break:break-all;font-size:12px">${esc(c.webhook_url || "")}</b></div><p class="mut" style="margin:10px 0">Paste the webhook URL into Paystack → Settings → API Keys &amp; Webhooks. The secret key stays in Vercel and is never shown here.</p>${c.mode && c.mode !== "none" && c.plans_with_code < c.plans ? '<button class="btn-or" data-mkplans>Create Paystack plans</button>' : ""}`;
  }

  /* ---------------- messages ---------------- */
  let poll = null;
  async function openConv(id) {
    S.msgConv = id; const th = document.getElementById("th"); if (!th) return;
    const t = await rpc("conversation_thread", { p_conv: id }).catch((e) => { toast(e.message); return null; }); if (!t) return;
    rpc("mark_conversation_read", { p_conv: id }).catch(() => {});
    document.querySelectorAll(".cv").forEach((b) => b.classList.toggle("on", b.dataset.conv === id));
    const bub = (ms) => ms.map((m) => `<div class="bub ${m.mine ? "me" : ""}"><p>${esc(m.body)}</p><small>${esc(when(m.at))}</small></div>`).join("");
    th.innerHTML = `<div class="hd">${esc(t.peer?.name || "Conversation")} <span class="mono">${esc(pretty(t.peer?.role || ""))}</span></div><div class="ml2" id="ml2">${bub(t.messages) || '<div class="none">Say hello 👋</div>'}</div><form id="mf"><input class="in" name="body" placeholder="Write a message" maxlength="4000" autocomplete="off" required /><button class="btn-or" type="submit">Send</button></form>`;
    const l = document.getElementById("ml2"); l.scrollTop = l.scrollHeight;
    document.getElementById("mf").onsubmit = async (e) => { e.preventDefault(); const i = e.target.body, v = i.value.trim(); if (!v) return; i.value = ""; try { await rpc("send_message", { p_conv: id, p_body: v }); const n = await rpc("conversation_thread", { p_conv: id }); l.innerHTML = bub(n.messages); l.scrollTop = l.scrollHeight; } catch (er) { toast(er.message); } };
    clearInterval(poll); poll = setInterval(async () => { if (S.page !== "messages" || S.msgConv !== id) return clearInterval(poll); try { const n = await rpc("conversation_thread", { p_conv: id }); const L = document.getElementById("ml2"); if (L && n.messages.length !== L.children.length) { L.innerHTML = bub(n.messages); L.scrollTop = L.scrollHeight; } } catch { /* offline */ } }, 4000);
  }

  /* ---------------- events ---------------- */
  async function act(label, fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); refreshBadges(); rerender(); } catch (e) { toast(e.message || `${label} failed`); } }
  async function openDoc(bucket, path) {
    if (/^https?:/.test(path)) return window.open(path, "_blank", "noopener");
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) return toast("Couldn't open that file.");
    window.open(data.signedUrl, "_blank", "noopener");
  }
  document.addEventListener("click", async (e) => {
    const t = e.target, q = (s) => t.closest(s);
    let el;
    if ((el = q("[data-go]"))) { const g = el.dataset.go; return go(g); }
    if (q("#out")) { await sb.auth.signOut(); S.me = null; return login(); }
    if (q("#menu")) return document.getElementById("side").classList.toggle("open");
    if (q("#bell")) { const d = S.queues || {}; return go(d.pending_verification ? "verification" : d.deposits_waiting + d.withdrawals_waiting ? "finance" : "reports"); }
    if ((el = q("[data-tab]"))) { const [k, v] = el.dataset.tab.split(":"); S.tab[k] = v; return rerender(); }
    if ((el = q("[data-role]"))) { S.role = el.dataset.role; return rerender(); }
    if ((el = q("[data-vf]"))) { S.vf = el.dataset.vf; return rerender(); }
    if ((el = q("[data-doc]"))) return openDoc(el.dataset.doc, el.dataset.path);
    if ((el = q("[data-vd]"))) {
      const x = S.vq[el.dataset.s][+el.dataset.i], st = el.dataset.vd; let reason = null;
      if (st === "rejected" || st === "resubmit_required") { const r = await ask(st === "rejected" ? "Reject this verification?" : "Ask them to resubmit?", "The member will see your note.", { field: true, label: st === "rejected" ? "Reject" : "Send request", danger: st === "rejected", ph: "What should they fix?" }); if (!r) return; reason = r.value; }
      return act("Decision", () => rpc("admin_decide_verification", { p_role: x.role, p_id: x.id, p_status: st, p_reason: reason || null }), "Decision saved. The member was notified.");
    }
    if ((el = q("[data-dd]"))) { const yes = el.dataset.dd === "1"; if (!(await ask(yes ? "Confirm this deposit?" : "Reject this deposit?", yes ? "The amount is added to the member's wallet. Only confirm once the Mobile Money payment has arrived." : "The member is told it wasn't confirmed.", { label: yes ? "Confirm received" : "Reject", danger: !yes }))) return; return act("Deposit", () => rpc("admin_decide_deposit", { p_id: el.dataset.id, p_approve: yes, p_note: null }), yes ? "Deposit credited to the wallet" : "Deposit rejected"); }
    if ((el = q("[data-wd]"))) { const paid = el.dataset.wd === "completed"; if (!(await ask(paid ? "Mark as paid?" : "Return to the wallet?", paid ? "Only mark it once you have sent the Mobile Money payment." : "The held amount goes back to the member's balance.", { label: paid ? "Mark as paid" : "Return funds" }))) return; return act("Withdrawal", () => rpc("admin_decide_withdrawal", { p_id: el.dataset.id, p_status: el.dataset.wd, p_note: null }), paid ? "Marked as paid" : "Returned to the wallet"); }
    if ((el = q("[data-esc]"))) { const rel = el.dataset.esc === "release"; if (!(await ask(rel ? "Release escrow?" : "Refund the payer?", rel ? "85% goes to the receiver and 15% to BAID X as commission." : "The full amount goes back to the payer.", { label: rel ? "Release" : "Refund" }))) return; return act("Escrow", () => rpc("admin_release_escrow", { p_id: el.dataset.id, p_refund: !rel }), rel ? "Escrow released" : "Payer refunded"); }
    if ((el = q("[data-dp]"))) { const st = el.dataset.dp; const r = await ask(`${pretty(st)} this dispute?`, "", { field: st !== "under_review", label: pretty(st), ph: "Note for the record" }); if (!r) return; return act("Dispute", () => rpc("admin_resolve_dispute", { p_id: el.dataset.id, p_status: st, p_note: r.value || null }), "Dispute updated"); }
    if ((el = q("[data-job]"))) return act("Job", () => rpc("admin_set_job_status", { p_id: el.dataset.id, p_status: el.dataset.job }), "Job updated");
    if ((el = q("[data-proj]"))) { if (!(await ask(`Set project to ${pretty(el.dataset.proj)}?`, "", { label: "Update" }))) return; return act("Project", () => rpc("admin_set_project_status", { p_id: el.dataset.id, p_status: el.dataset.proj }), "Project updated"); }
    if ((el = q("[data-rep]"))) { const st = el.dataset.rep; const r = st === "reviewing" ? { value: "" } : await ask(`${pretty(st)} this report?`, "", { field: true, label: pretty(st), ph: "Resolution note" }); if (!r) return; return act("Report", () => rpc("admin_resolve_report", { p_id: el.dataset.id, p_status: st, p_notes: r.value || null }), "Report updated"); }
    if ((el = q("[data-acct]"))) { const u = S.ulist[+el.dataset.i], st = el.dataset.acct; if (!(await ask(`${st === "active" ? "Reactivate" : st === "suspended" ? "Suspend" : "Ban"} ${u.name}?`, st === "active" ? "They can use BAID X again." : "They lose access immediately and are notified.", { label: st === "active" ? "Reactivate" : st === "suspended" ? "Suspend" : "Ban", danger: st === "disabled" }))) return; return act("Account", () => rpc("admin_set_account_status", { p_role: u.role, p_id: u.id, p_status: st }), "Account updated"); }
    if ((el = q("[data-prof]"))) { const u = S.ulist[+el.dataset.prof]; return modal(`<div class="row2">${avatar(u.name, u.photo)}<div><h3 style="margin:0">${esc(u.name)}</h3><div class="mono">${esc(u.baid || "")}</div></div></div><div style="margin-top:12px"><div class="kv"><span>Role</span><b>${esc(pretty(u.role))}</b></div><div class="kv"><span>Phone</span><b>${esc(u.phone || "—")}</b></div><div class="kv"><span>Email</span><b>${esc(u.email || "—")}</b></div><div class="kv"><span>Verification</span>${stPill(u.verification || "unverified")}</div><div class="kv"><span>Plan</span><b>${esc(pretty(u.plan))}</b></div><div class="kv"><span>Account</span>${stPill(u.account_status || "active")}</div><div class="kv"><span>Joined</span><b>${esc(day(u.created_at))}</b></div></div><div class="acts"><button class="btn gh" data-closem>Close</button><button class="btn ap" data-msg="${esc(u.id)}">Message</button></div>`); }
    if (q("[data-closem]")) return closeModal();
    if ((el = q("[data-msg]"))) { closeModal(); try { const cid = await rpc("start_conversation", { p_other: el.dataset.msg, p_subject: null }); S.msgConv = cid; if (S.page === "messages") rerender(); else go("messages"); } catch (er) { toast(er.message); } return; }
    if ((el = q("[data-conv]"))) return openConv(el.dataset.conv);
    if ((el = q("[data-org]"))) { const susp = el.dataset.s === "SUSPENDED"; const r = await ask(susp ? "Suspend this organization?" : "Restore this organization?", susp ? "Members lose access to it immediately." : "Members regain access.", { field: susp, label: susp ? "Suspend" : "Restore", danger: susp, ph: "Reason (optional)" }); if (!r) return; return act("Organization", () => rpc("platform_set_org_status", { p_org: el.dataset.org, p_status: el.dataset.s, p_reason: r.value || null }), susp ? "Organization suspended" : "Organization restored"); }
    if ((el = q("[data-price]"))) { const r = await ask("Change price", "Enter the new price in cedis. It applies to new checkouts only.", { field: true, label: "Save price", ph: `Currently ${(el.dataset.v / 100).toFixed(2)}` }); if (!r) return; const v = Math.round(parseFloat(r.value) * 100); if (!(v >= 0)) return toast("Enter a valid amount."); return act("Price", () => rpc("admin_set_plan_price", { p_id: el.dataset.price, p_price_minor: v }), "Price updated"); }
    if (q("[data-founding]")) { if (!(await ask("Start the founding program?", "The 90-day clock starts now for all five account types. This cannot be undone.", { label: "Start" }))) return; return act("Founding", () => rpc("admin_start_founding"), "Founding program started"); }
    if ((el = q("[data-sms-live]"))) {
      const a = await ask("LIVE — REAL SMS", "This sends ONE real text message through SasuSync and uses credits. Enter YOUR OWN Ghana mobile number, then type SEND ONE LIVE SMS below. It is checked against the provider before sending and is never retried.", { field: true, danger: true, label: "Send one live SMS", ph: "0XX XXX XXXX" });
      if (!a) return;
      const typed = await ask("Final confirmation", "Type SEND ONE LIVE SMS exactly to send.", { field: true, danger: true, label: "Send now", ph: "SEND ONE LIVE SMS" });
      if (!typed) return;
      const out = document.getElementById("smsres"); el.disabled = true; if (out) out.textContent = "Sending one live SMS…";
      try {
        const { data: { session } } = await sb.auth.getSession();
        const r = await fetch("/api/sasusync-admin", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "live_test", live_test: true, confirm: typed.value.trim(), to: a.value.trim() }) });
        const j = await r.json().catch(() => ({}));
        if (out) out.innerHTML = r.ok && j.result ? `<b>${esc(j.result)}</b> · ${j.sent ? "Accepted by SasuSync" : `Not sent (${esc(j.error_category || "error")}${j.sender_status ? `: sender ${esc(j.sender_status)}` : ""})`}${j.queued ? " · queued" : ""}${j.job_id ? ` · job ${esc(j.job_id)}` : ""}${j.credits_used !== undefined && j.credits_used !== null ? ` · credits used ${esc(j.credits_used)}, remaining ${esc(j.credits_remaining)}` : ""}${j.note ? ` · ${esc(j.note)}` : ""}` : esc(j.error || "The test could not run.");
      } catch { if (out) out.textContent = "The test could not run. It may or may not have been sent: use Look up job before trying again."; }
      el.disabled = false; return;
    }
    if ((el = q("[data-sms-lookup]"))) {
      const a = await ask("Look up a send", "Reads the delivery status of one job from SasuSync. Nothing is sent and nothing is charged.", { field: true, label: "Look up", ph: "Job id" });
      if (!a || !a.value.trim()) return;
      const out = document.getElementById("smsres"); if (out) out.textContent = "Looking up…";
      try {
        const { data: { session } } = await sb.auth.getSession();
        const r = await fetch("/api/sasusync-admin", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "sms_status", job_id: a.value.trim() }) });
        const j = await r.json().catch(() => ({}));
        if (out) out.innerHTML = r.ok && j.job_id && !j.error_category ? `Job ${esc(j.job_id)} · ${esc(j.delivery_status)}${j.sandbox ? " (sandbox)" : ""} · ${j.messages.length} message(s)${j.messages.map((m) => ` · ${esc(m.provider_status || "?")}${m.webhook_state ? `/webhook ${esc(m.webhook_state)}` : ""}`).join("")} · ${j.matched_log ? "matched to a notification log" : "no notification log"}` : esc(j.error || `Lookup failed (${j.error_category || "error"})`);
      } catch { if (out) out.textContent = "The lookup could not run."; }
      return;
    }
    if ((el = q("[data-sms-sandbox]"))) {
      const a = await ask("SANDBOX — NO DELIVERY", "This calls SasuSync's sandbox only. Nothing is delivered to any phone and no credits are charged. Enter a Ghana mobile number to use as the test recipient.", { field: true, label: "Run sandbox test", ph: "0XX XXX XXXX" });
      if (!a) return;
      const out = document.getElementById("smsres"); el.disabled = true; if (out) out.textContent = "Running sandbox test…";
      try {
        const { data: { session } } = await sb.auth.getSession();
        const r = await fetch("/api/sasusync-admin", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "sandbox_test", sandbox_test: true, to: a.value.trim() }) });
        const j = await r.json().catch(() => ({}));
        if (out) out.innerHTML = r.ok && j.result ? `<b>${esc(j.result)}</b> · ${j.success ? "Accepted by sandbox" : `Failed (${esc(j.error_category || "error")}${j.http_status ? ` ${esc(j.http_status)}` : ""})`}${j.queued ? " · queued" : ""}${j.job_id ? ` · job ${esc(j.job_id)}` : ""} · ${j.delivered ? "delivered" : "not delivered"} · ${j.charged ? "charged" : "not charged"}` : esc(j.error || "The test could not run.");
      } catch { if (out) out.textContent = "The test could not run."; }
      el.disabled = false; return;
    }
    if (q("[data-mkplans]")) { const b = q("[data-mkplans]"); b.disabled = true; b.textContent = "Creating…"; const r = await api("create_plans"); toast(r.ok ? `Created ${r.json.created} plans${r.json.failed ? `, ${r.json.failed} failed` : ""}` : r.json.error || "Failed"); return rerender(); }
    if ((el = q("[data-mfa]"))) { const on = el.dataset.mfa === "1"; if (!(await ask(on ? "Require two-step sign-in?" : "Turn two-step off?", on ? "Privileged roles will need an authenticator code. Make sure your own authenticator is set up first, or you can lock yourself out." : "Privileged roles will no longer need a code.", { label: on ? "Turn on" : "Turn off", danger: on }))) return; return act("MFA", () => rpc("admin_set_mfa", { p_on: on }), on ? "Two-step is now required" : "Two-step is off"); }
    if (q("[data-mfa-enrol]")) {
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "BAID X Admin " + Date.now() }); if (error) return toast(error.message);
      const d = modal(`<h3>Set up your authenticator</h3><p class="d">Scan with Google Authenticator or Authy, then enter the 6-digit code.</p><div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;width:190px;margin:0 auto 10px"><img src="${esc(data.totp.qr_code)}" alt="QR code" width="170" height="170" /></div><p class="mono" style="text-align:center;word-break:break-all">${esc(data.totp.secret)}</p><form id="mfaf"><input class="in" name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code" required style="margin-top:10px" /><div class="acts"><button type="button" class="btn gh" data-closem>Cancel</button><button class="btn ap" type="submit">Verify</button></div></form>`);
      d.querySelector("#mfaf").onsubmit = async (ev) => { ev.preventDefault(); const code = ev.target.code.value, ch = await sb.auth.mfa.challenge({ factorId: data.id }); if (ch.error) return toast(ch.error.message); const v = await sb.auth.mfa.verify({ factorId: data.id, challengeId: ch.data.id, code }); if (v.error) return toast("That code didn't match."); closeModal(); toast("Authenticator is on"); };
      return;
    }
    if ((el = q("[data-prov]"))) { const p = S.fin.providers.find((x) => x.id === el.dataset.prov); return modal(`<h3>Edit provider</h3><form id="pf"><label class="fl"><span>Display name</span><input class="in" name="name" value="${esc(p.display_name)}" required /></label><div class="fr"><label class="fl"><span>Number</span><input class="in" name="num" value="${esc(p.account_number || "")}" /></label><label class="fl"><span>Account name</span><input class="in" name="acc" value="${esc(p.account_name || "")}" /></label></div><label class="fl"><span>Instructions shown to members</span><textarea class="in" name="ins">${esc(p.instructions || "")}</textarea></label><label class="fl"><span><input type="checkbox" name="on" ${p.is_active ? "checked" : ""} /> Active</span></label><div class="acts"><button type="button" class="btn gh" data-closem>Cancel</button><button class="btn ap" type="submit">Save</button></div></form>`).querySelector("#pf").addEventListener("submit", (ev) => { ev.preventDefault(); const f = ev.target; closeModal(); act("Provider", () => rpc("admin_update_provider", { p_id: p.id, p_name: f.name.value, p_number: f.num.value, p_account_name: f.acc.value, p_instructions: f.ins.value, p_active: f.on.checked }), "Provider saved"); }); }
    if ((el = q("[data-cat]"))) { const c = el.dataset.cat === "new" ? null : S.cats[+el.dataset.cat]; const phases = ["structural", "electrical_mechanical", "plumbing_water", "finishing_interior", "exterior_compound", "support_general"]; return modal(`<h3>${c ? "Edit" : "Add"} category</h3><form id="cf"><label class="fl"><span>Name</span><input class="in" name="name" value="${esc(c?.name || "")}" required /></label><label class="fl"><span>Phase</span><select class="in" name="phase">${phases.map((p) => `<option value="${p}" ${c?.phase === p ? "selected" : ""}>${esc(pretty(p))}</option>`).join("")}</select></label><label class="fl"><span><input type="checkbox" name="on" ${c?.is_active === false ? "" : "checked"} /> Active</span></label><div class="acts"><button type="button" class="btn gh" data-closem>Cancel</button><button class="btn ap" type="submit">Save</button></div></form>`).querySelector("#cf").addEventListener("submit", (ev) => { ev.preventDefault(); const f = ev.target; closeModal(); act("Category", () => rpc("admin_save_category", { p_id: c?.id || null, p_name: f.name.value, p_phase: f.phase.value, p_active: f.on.checked }), "Category saved"); }); }
    if ((el = q("#roleseg [data-r]"))) { const seg = el.parentElement; if (el.dataset.r === "") seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el)); else { seg.querySelector('[data-r=""]').classList.remove("on"); el.classList.toggle("on"); if (!seg.querySelector(".on")) seg.querySelector('[data-r=""]').classList.add("on"); } return; }
    if ((el = q("[data-ch]"))) return el.classList.toggle("on");
    if ((el = q("[data-mres]"))) { try { const cid = await rpc("start_conversation", { p_other: el.dataset.mres, p_subject: null }); S.msgConv = cid; rerender(); } catch (er) { toast(er.message); } return; }
    if ((el = q("[data-gs]"))) { document.getElementById("gres").classList.remove("on"); const u = S.gsr[+el.dataset.gs]; S.ulist = [u]; return modal(`<div class="row2">${avatar(u.name, u.photo)}<div><h3 style="margin:0">${esc(u.name)}</h3><div class="mono">${esc(u.baid || "")}</div></div></div><div style="margin-top:12px"><div class="kv"><span>Role</span><b>${esc(pretty(u.role))}</b></div><div class="kv"><span>Verification</span>${stPill(u.verification || "unverified")}</div><div class="kv"><span>Account</span>${stPill(u.account_status || "active")}</div></div><div class="acts"><button class="btn gh" data-closem>Close</button><button class="btn ap" data-msg="${esc(u.id)}">Message</button></div>`); }
    if (!q(".srch")) document.getElementById("gres")?.classList.remove("on");
  });

  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.id === "uq") { e.preventDefault(); S.q = document.getElementById("uqi").value.trim(); return rerender(); }
    if (f.id === "bf") {
      e.preventDefault(); const d = Object.fromEntries(new FormData(f)), roles = [...document.querySelectorAll("#roleseg .on")].map((b) => b.dataset.r).filter(Boolean), chans = ["in_app", ...[...document.querySelectorAll("[data-ch].on")].map((b) => b.dataset.ch)];
      const aud = roles.length ? roles.map(pretty).join(", ") : "all members", btn = f.querySelector("button[type=submit]");
      let smsNote = "";
      if (chans.includes("sms")) {
        // SMS goes through SasuSync. Preview first (free), then an explicit typed confirmation before any message is sent.
        if (d.body.trim().length > 440) return toast("SMS announcements can be at most 440 characters. Shorten the message.");
        btn.disabled = true;
        const pv = await smsCall({ action: "sms_broadcast", dry_run: true, roles, message: d.body });
        btn.disabled = false;
        if (!pv.ok || pv.json.error || pv.json.error_category) return toast(pv.json.error || pv.json.note || "Couldn't prepare the SMS preview.");
        const p = pv.json;
        if (!p.recipients) return toast("No one in this audience has a phone number, so no SMS would be sent.");
        if (!p.within_limit) return toast(`That is ${p.recipients} people; the limit per broadcast is ${p.max_recipients}.`);
        if (!p.enough_credit) return toast(`Not enough SMS credit: this needs about ${p.credits_estimate}, you have ${p.sms_sendable} (${p.otp_reserve} are kept for sign-in codes).`);
        const skipped = Object.values(p.skipped || {}).reduce((a, b) => a + b, 0);
        const go = await ask(`${p.result}`, `SMS to ${p.recipients} ${p.recipients === 1 ? "person" : "people"} (${aud}). ${p.parts} message part${p.parts === 1 ? "" : "s"} each, about ${p.credits_estimate} credits${p.mode === "live" ? ` of ${p.sms_sendable} available` : ""}.${skipped ? ` ${skipped} skipped (no valid number or duplicate).` : ""} ${p.mode === "live" ? "Real text messages will be sent and cannot be recalled. Type SEND to confirm." : "Sandbox: nothing is delivered or charged. Type SEND to continue."}`, { field: true, danger: p.mode === "live", label: p.mode === "live" ? "Send SMS" : "Run sandbox", ph: "SEND" });
        if (!go || go.value.trim().toUpperCase() !== "SEND") return toast("Cancelled. Nothing was sent.");
        btn.disabled = true; btn.textContent = "Sending SMS…";
        const rq = crypto.randomUUID ? crypto.randomUUID() : "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0");
        const sr = await smsCall({ action: "sms_broadcast", roles, message: d.body, confirm: "SEND SMS BROADCAST", request_id: rq, expected_recipients: p.recipients });
        btn.disabled = false; btn.textContent = "Send broadcast";
        const j = sr.json || {};
        if (!sr.ok && !j.status) return toast(j.error || "The SMS broadcast could not run. Nothing was sent.");
        smsNote = ` · SMS: ${j.accepted ?? 0} of ${j.recipients ?? p.recipients} accepted${j.status && j.status !== "sent" ? ` (${j.status}${j.error_category ? `: ${j.error_category}` : ""})` : ""}`;
      } else if (!(await ask("Send this broadcast?", `It goes to ${aud}.`, { label: "Send now" }))) return;
      try { const n = await rpc("admin_broadcast", { p_title: d.title, p_body: d.body, p_href: d.href || null, p_roles: roles, p_channels: chans }); toast(`In-app: ${n} member${n === 1 ? "" : "s"}${smsNote}`); S.tab.notif = "history"; rerender(); } catch (er) { toast(er.message); }
    }
    if (f.id === "setf") { e.preventDefault(); const v = parseFloat(f.rate.value); if (!(v >= 0 && v <= 0.5)) return toast("Enter a rate between 0 and 0.5."); act("Setting", () => rpc("admin_set_setting", { p_key: "commission_rate", p_value: v }), "Saved"); }
    if (f.id === "pwf") { e.preventDefault(); const { error } = await sb.auth.updateUser({ password: f.pw.value }); if (error) return toast(error.message); f.reset(); toast("Password changed"); }
  });

  let gt;
  document.addEventListener("input", (e) => {
    if (e.target.id === "gs") {
      clearTimeout(gt); const v = e.target.value.trim(), box = document.getElementById("gres");
      if (v.length < 2) return box.classList.remove("on");
      gt = setTimeout(async () => { try { const l = (await rpc("admin_users", { p_role: null, p_q: v })).slice(0, 6); S.gsr = l; box.innerHTML = l.length ? l.map((u, i) => `<button data-gs="${i}">${avatar(u.name, u.photo)}<span><b>${esc(u.name)}</b><small>${esc(pretty(u.role))} · ${esc(u.baid || "")}</small></span></button>`).join("") : '<div class="mut" style="padding:12px 14px">No matches</div>'; box.classList.add("on"); } catch { /* ignore */ } }, 250);
    }
    if (e.target.id === "mq") {
      clearTimeout(gt); const v = e.target.value.trim(), box = document.getElementById("mres");
      if (v.length < 2) { box.innerHTML = ""; return; }
      gt = setTimeout(async () => { try { const l = (await rpc("admin_users", { p_role: null, p_q: v })).slice(0, 5); box.innerHTML = l.map((u) => `<button class="cv" data-mres="${esc(u.id)}" style="padding:8px 4px">${avatar(u.name, u.photo)}<span><b>${esc(u.name)}</b><small>${esc(pretty(u.role))}</small></span></button>`).join(""); } catch { /* ignore */ } }, 250);
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  window.addEventListener("hashchange", route);
  boot();
})();
