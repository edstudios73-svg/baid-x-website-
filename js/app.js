(() => {
  "use strict";
  const { sb, $, $$, esc, pretty, real, toast, ROLES, JOB_CAT_BY_ID, REGIONS, categoriesFor, loadMe, checklistState, statusLabel, icon, NAV, COMMON_ROUTES, ROLE_ROUTES, ago } = window.BX;

  /* ---------- Directory sources (public-safe columns only) ---------- */
  const place = (r) => [r.city_town, r.region].filter(real).join(", ") || "Ghana";
  const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : "—");
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const SOURCES = {
    companies: {
      label: "Companies", role: "company", table: "company_profiles",
      cols: "id,company_name,industry_sector,company_size,city_town,region,company_logo_url,cover_url,company_overview,trust_score,verification_status,badge_tier",
      map: (r) => ({
        kind: "company", badge: r.verification_status === "verified" ? (r.badge_tier || "verified") : null, id: r.id, name: r.company_name, image: r.company_logo_url, cover: r.cover_url || null,
        desc: r.company_overview || "Company on BAID X.", tag: pretty(r.industry_sector), place: place(r),
        catId: r.industry_sector, region: r.region,
        stats: [[num(r.trust_score, 1), "Trust"], [pretty(r.company_size) || "—", "Size"]],
      }),
    },
    professionals: {
      label: "Professionals", role: "worker", table: "worker_profiles",
      cols: "id,full_name,specialty,short_bio,primary_job_category_id,years_of_experience,daily_rate_ghs,city_town,region,profile_photo_url,cover_url,portfolio_photo_urls,rank_tier,verification_status,badge_tier",
      map: (r) => {
        const trade = JOB_CAT_BY_ID[r.primary_job_category_id]?.name || r.specialty;
        return {
          kind: "worker", badge: r.verification_status === "verified" ? (r.badge_tier || "verified") : null, id: r.id, name: r.full_name, image: r.profile_photo_url, cover: r.cover_url || (r.portfolio_photo_urls || [])[0] || null,
          desc: r.short_bio || (trade ? `${trade} based in ${r.city_town || "Ghana"}.` : "Skilled professional on BAID X."),
          tag: trade || pretty(r.rank_tier) || "Professional", place: place(r), catId: r.primary_job_category_id, region: r.region,
          stats: [[r.daily_rate_ghs ? `GH₵${num(r.daily_rate_ghs)}` : "On request", "Daily rate"], [r.years_of_experience ? `${pretty(r.years_of_experience)}${/^\d/.test(String(r.years_of_experience)) ? " yrs" : ""}` : "New", "Experience"]],
        };
      },
    },
    managers: {
      label: "Project Managers", role: "project-manager", table: "project_manager_profiles",
      cols: "id,full_name,specialization,specialization_tags,years_managing_projects,projects_managed_count,city_town,region,profile_photo_url,cover_url,verification_status,badge_tier",
      map: (r) => ({
        kind: "pm", badge: r.verification_status === "verified" ? (r.badge_tier || "verified") : null, id: r.id, name: r.full_name, image: r.profile_photo_url, cover: r.cover_url || null,
        desc: (r.specialization_tags || []).slice(0, 3).join(" · ") || "Project manager on BAID X.",
        tag: pretty(r.specialization) || "Project Manager", place: place(r), catId: r.specialization, region: r.region,
        stats: [[r.projects_managed_count ?? 0, "Projects"], [r.years_managing_projects ?? 0, "Years"]],
      }),
    },
    businesses: {
      label: "Businesses", role: "business", table: "business_profiles",
      cols: "id,business_name,specialty,short_bio,years_in_operation,crew_size,city_town,region,logo_url,cover_url,portfolio_photo_urls,verification_status,badge_tier",
      map: (r) => ({
        kind: "business", badge: r.verification_status === "verified" ? (r.badge_tier || "verified") : null, id: r.id, name: r.business_name, image: r.logo_url, cover: r.cover_url || (r.portfolio_photo_urls || [])[0] || null,
        desc: r.short_bio || "Supplier of products, equipment and materials.", tag: r.specialty || "Supplier", place: place(r),
        catId: r.specialty, region: r.region,
        stats: [[r.crew_size ?? 0, "Crew"], [r.years_in_operation ?? 0, "Years"]],
      }),
    },
  };
  const CHIPS = [["all", "Everyone"], ...Object.entries(SOURCES).map(([k, v]) => [k, v.label])];
  // What each role most likely wants to find first when they open Discover.
  const DEFAULT_CHIP = { company: "professionals", "individual-employer": "professionals", "project-manager": "companies", business: "companies" };

  const state = { me: null, route: { name: "home", arg: "" }, filter: "all", q: "", items: [], loading: false, failed: false, f: { type: "all", cat: null, region: null }, draft: null, dirInit: false, unread: 0, notif: 0, projectId: null };
  const R = () => state.me?.role || null;

  /* ---------- Splash ---------- */
  const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };
  function runSplash() {
    const el = $("#splash");
    // First visit this session: the full sequence. Any refresh after that: the same sequence, very fast and a little soft.
    const seen = ssGet("baidx_splash"), calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen) el.classList.add("quick");
    const hold = calm ? 700 : seen ? 800 : 3300, out = seen ? 300 : 750;
    setTimeout(() => { el.classList.add("leave"); ssSet("baidx_splash", "1"); setTimeout(() => el.classList.add("hide"), out); }, hold);
  }

  /* ---------- Routing ---------- */
  const SUBS = ["checklist", "filters", "picker"];
  const go = (r) => { location.hash = `#/${r}`; };
  function parseHash() {
    const [path] = (location.hash || "#/home").replace(/^#\/?/, "").split("?");
    const [name, arg] = path.split("/");
    return { name: name || "home", arg: arg || "" };
  }
  function allowed(name) {
    const r = R();
    if (!r) return name === "home"; // signed-out visitors only see the landing page
    return COMMON_ROUTES.includes(name) || (ROLE_ROUTES[r] || []).includes(name);
  }
  function route() {
    let { name, arg } = parseHash();
    // keep an invitation link through sign-in: remember it as a guest, open it once signed in
    try {
      if (name === "join" && arg && !R()) sessionStorage.setItem("baidx_join", arg);
      else if (R() && sessionStorage.getItem("baidx_join")) { const t = sessionStorage.getItem("baidx_join"); sessionStorage.removeItem("baidx_join"); name = "join"; arg = t; location.replace(`#/join/${t}`); }
    } catch { /* private mode */ }
    if (!allowed(name)) name = "home";
    state.route = { name, arg };
    document.body.classList.toggle("g-on", !!R()); // every signed-in screen sits on the glass backdrop, like Chats
    const T = { home: "Ghana's work network", discover: "Discover verified professionals", jobs: "Job marketplace", work: "Work", projects: "Projects", ws: "Project workspace", chats: "Chats", chat: "Chat", profile: "Profile", notifications: "Notifications", wallet: "Wallet", invites: "Invitations", approvals: "Approvals", orgs: "Organizations", billing: "Plans & billing", catalog: "Catalog", inquiries: "Inquiries", hires: "Hires", applicants: "Applicants", step: "Complete your profile", orders: "Orders", order: "Order", engagement: "Engagement" };
    document.title = name === "home" ? (R() ? "BAID X · Ghana's work network" : "BAID X · Hire verified professionals in Ghana, pay through escrow") : `${T[name] || "BAID X"} · BAID X`;
    const member = !!R();
    let screen;
    if (!member) screen = "landing";
    else if (name === "discover") screen = "directory";
    else if (["chats", "profile", ...SUBS].includes(name)) screen = name;
    else screen = "dash";

    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${screen}`));
    const cfg = NAV[R() || "guest"];
    const tab = cfg.parent[name] || name;
    $$("#navIn [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    $$("#sidebar [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name || b.dataset.tab === `${name}/${arg}` || (name === "org" && b.dataset.tab === "orgs")));
    document.body.classList.toggle("is-guest", !member);
    const hideNav = !member || SUBS.includes(name) || name === "chat";
    $("#nav").hidden = hideNav;
    document.body.classList.toggle("hide-nav", hideNav);

    if (name === "checklist") renderChecklist();
    if (name === "filters") renderFilters();
    if (name === "chats" && member) renderChats();
    if (screen === "directory" && member && !state.dirInit) {
      state.dirInit = true; state.filter = DEFAULT_CHIP[R()] || "all"; renderChips(); renderFeed();
    }
    if (screen === "dash") window.DASH?.render(name, arg, dashCtx());
    window.scrollTo(0, 0);
  }

  /* ---------- Navigation (bottom bar on phones, sidebar on desktop) ---------- */
  const myInitials = () => { const me = state.me, p = me?.profile || {}; return initials(p[ROLES[me?.role]?.nameKey] || "BX"); };
  const myPhoto = () => { const p = state.me?.profile || {}; return p.profile_photo_url || p.company_logo_url || p.logo_url || ""; };
  const bellInner = () => `${icon("bell", 21)}<i class="bn" data-bn ${state.notif > 0 ? "" : "hidden"}>${state.notif > 9 ? "9+" : state.notif || ""}</i>`;
  const appbar = () => `<div class="appbar"><img class="ab-logo" src="assets/logo.png" alt="BAID X" /><span class="sp"></span><button class="bell" data-go="notifications" aria-label="Notifications">${bellInner()}</button><button class="ab-me" data-go="profile" aria-label="My profile" ${myPhoto() ? `style="background-image:url('${esc(myPhoto())}')"` : ""}>${myPhoto() ? "" : esc(myInitials())}</button></div>`;
  function updateBell(ring) {
    $$(".bell").forEach((b) => { if (!b.querySelector("[data-bn]")) b.innerHTML = bellInner(); const n = b.querySelector("[data-bn]"); n.hidden = !(state.notif > 0); n.textContent = state.notif > 9 ? "9+" : state.notif || ""; if (ring) { b.classList.remove("ring"); void b.offsetWidth; b.classList.add("ring"); } });
  }
  function renderNav() {
    const role = R(), cfg = NAV[role || "guest"];
    const badge = (k) => (k === "chats" && state.unread > 0 ? `<i class="nbadge">${state.unread > 9 ? "9+" : state.unread}</i>` : "");
    $("#navIn").style.gridTemplateColumns = `repeat(${cfg.tabs.length}, 1fr)`;
    $("#navIn").innerHTML = cfg.tabs.map(([k, l, ic]) => `<button data-tab="${k}" aria-label="${esc(l)}"><span class="ni">${icon(ic, 24)}${badge(k)}</span><span>${esc(l)}</span></button>`).join("");
    const side = $("#sidebar");
    if (!role) { side.hidden = true; document.body.classList.remove("has-side"); return; }
    const p = state.me.profile || {}, name = p[ROLES[role].nameKey] || "Account";
    side.innerHTML = `<img class="s-logo" src="assets/logo.png" alt="BAID X" />` +
      cfg.side.map((it) => (it === "--" ? "<hr />" : `<button data-tab="${it[0]}">${icon(it[2], 20)}<span>${esc(it[1])}</span>${badge(it[0])}</button>`)).join("") +
      `<div class="s-acct"><span class="s-av">${esc(initials(name))}</span><span class="s-tx"><b>${esc(name)}</b><small>${esc(ROLES[role].short)}</small></span></div>`;
    side.hidden = false; document.body.classList.add("has-side");
  }
  async function loadUnread() {
    if (!R()) return;
    const { data } = await sb.from("conversation_participants").select("unread_count").eq("user_id", state.me.session.user.id);
    state.unread = (data || []).reduce((a, r) => a + (r.unread_count || 0), 0);
    renderNav(); route_highlight();
  }
  const route_highlight = () => { const { name, arg } = state.route; const cfg = NAV[R() || "guest"]; const tab = cfg.parent[name] || name;
    $$("#navIn [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    $$("#sidebar [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name || b.dataset.tab === `${name}/${arg}` || (name === "org" && b.dataset.tab === "orgs"))); };

  /* ---------- Directory ---------- */
  function renderChips() {
    $("#chips").innerHTML = CHIPS.map(([k, l]) => `<button class="chip ${state.filter === k ? "on" : ""}" data-chip="${k}">${esc(l)}</button>`).join("");
  }
  const PIN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linejoin="round"><path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/></svg>';
  const BAG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.500"/><path d="M9 7V5.500A1.500 1.500 0 0 1 10.500 4h3A1.500 1.500 0 0 1 15 5.500V7"/></svg>';
  const KIND_LABEL = { worker: "Professional", company: "Company", pm: "Project manager", business: "Supplier" };
  const SEAL = (tier) => (tier ? window.BX.badge(tier, 17) : "");
  // Member card: identity row (avatar beside the name), a facts line and a trust line.
  function cardHTML(it) {
    const role = R(), canInvite = (role === "company" && ["worker", "pm"].includes(it.kind)) || (role === "project-manager" && it.kind === "worker");
    const av = `<div class="t-av" ${it.image ? `style="background-image:url('${esc(it.image)}')"` : ""}>${it.image ? "" : esc(initials(it.name))}</div>`;
    const msg = role ? `<button class="b2" data-fx="message" data-id="${esc(it.id)}" data-name="${esc(it.name)}">Message</button>` : "";
    const facts = [`<span class="t-place">${PIN.replace('width="20" height="20"', 'width="14" height="14"')}${esc(it.place)}</span>`, ...it.stats.map(([v, l]) => `<span><b>${esc(String(v).replace(/^(\d+) (\d+)$/, "$1–$2"))}</b> ${esc(String(l).toLowerCase())}</span>`)].join('<i class="t-dot"></i>');
    const b = it.badge && window.BX.BADGES[it.badge];
    const trust = b ? `<div class="t-trust ok">${SEAL(it.badge)}<span>${esc(b[1])} by BAID X</span></div>` : `<div class="t-trust"><span>Verification in progress</span></div>`;
    return `<article class="card c3" data-id="${esc(it.id)}" data-kind="${esc(it.kind)}">
      <div class="t-top">${av}<div class="t-id"><h3>${esc(it.name)}</h3><div class="t-tag">${esc(it.tag)}</div></div><span class="t-kind">${esc(KIND_LABEL[it.kind] || "Member")}</span></div>
      <p class="desc">${esc(it.desc)}</p>
      <div class="t-facts">${facts}</div>${trust}
      <div class="c-foot"><button class="b1">${canInvite ? "Invite to project" : "View profile"}</button>${msg}</div></article>`;
  }
  const norm = (s) => String(s || "").toLowerCase().replace(/\s*region$/, "").trim();
  function visible() {
    const q = state.q.trim().toLowerCase(), f = state.f;
    const group = f.type !== "all" ? f.type : state.filter;
    return state.items.filter((it) => group === "all" || it.group === group)
      .filter((it) => !f.cat || it.catId === f.cat.id)
      .filter((it) => !f.region || (norm(it.region) && (norm(it.region).includes(norm(f.region)) || norm(f.region).includes(norm(it.region)))))
      .filter((it) => !q || `${it.name} ${it.tag} ${it.place} ${it.desc}`.toLowerCase().includes(q));
  }
  function renderFeed() {
    const feed = $("#feed");
    if (state.loading) { feed.innerHTML = '<div class="skel"></div>'.repeat(3); return; }
    if (state.failed) { feed.innerHTML = '<div class="state" style="grid-column:1/-1"><b>Couldn\'t load the directory</b>Check your connection and try again.</div>'; return; }
    const list = visible();
    feed.innerHTML = list.length ? list.map(cardHTML).join("") : '<div class="state" style="grid-column:1/-1"><b>No results</b>Try another search, category or location.</div>';
  }
  async function loadDirectory() {
    state.loading = true; state.failed = false; renderFeed();
    try {
      const results = await Promise.all(Object.entries(SOURCES).map(async ([group, s]) => {
        const { data, error } = await sb.from(s.table).select(`${s.cols},created_at`).or("account_status.is.null,account_status.eq.active").order("created_at", { ascending: true }).limit(100);
        if (error) throw error;
        return (data || []).map((r) => ({ ...s.map(r), group, joined: Date.parse(r.created_at) || Infinity }));
      }));
      state.items = results.flat().sort((a, b) => a.joined - b.joined); // the earliest members first
    } catch (e) { console.error("directory load failed", e); state.failed = true; }
    state.loading = false; renderFeed();
  }

  /* ---------- Member shell: account screen, chats ---------- */
  function paintMember() {
    const me = state.me, member = !!me?.role;
    document.body.classList.toggle("is-member", member);
    $("#joinBtn").hidden = member; $("#filterBtn").hidden = !member; $("#dirBell").hidden = !member;
    if (member) { $("#dirBell").innerHTML = bellInner(); $$("[data-appbar]").forEach((el) => { el.innerHTML = appbar(); }); }
    $("#chatsGuest").hidden = member; $("#chatsMember").hidden = !member;
    $("#profileGuest").hidden = member; $("#profileMember").hidden = !member;
    if (!member) return;
    const role = ROLES[me.role], p = me.profile || {}, cl = checklistState(me.role, p);
    state.cl = cl;
    const name = p[role.nameKey] || "Your account", phone = p[role.phoneKey] || me.session.user.phone || (window.BX.isPlaceholderEmail(me.session.user.email) ? "" : me.session.user.email) || "";
    const photo = p.profile_photo_url || p.company_logo_url || p.logo_url;
    $("#accAvatar").style.backgroundImage = photo ? `url('${photo.replace(/'/g, "%27")}')` : "";
    $("#accAvatar").textContent = photo ? "" : initials(name);
    const verified = p.verification_status === "verified";
    $("#accCover").style.backgroundImage = p.cover_url ? `url('${p.cover_url.replace(/'/g, "%27")}')` : "";
    $("#accName").textContent = name; $("#accPhone").textContent = phone ? (/^\d/.test(phone) ? `+${phone}` : phone) : "";
    $("#accSeal").hidden = !verified; $("#accSeal").innerHTML = verified ? window.BX.badge(p.badge_tier, 17) : "";
    $("#accRole").textContent = role.account;
    $("#accStatus").className = verified ? "vt" : ""; $("#accStatus").innerHTML = verified ? `<span style="color:${(window.BX.BADGES[p.badge_tier] || window.BX.BADGES.verified)[0]}">${icon("seal", 14)}</span> ${esc((window.BX.BADGES[p.badge_tier] || window.BX.BADGES.verified)[1])}` : esc(statusLabel(p.verification_status));
    // verified members don't need the checklist any more: show the badge instead
    document.querySelector(".acc-card.check").hidden = verified;
    $("#accVerified").hidden = !verified;
    $("#accVerified").innerHTML = verified ? (() => { const [col, label, sub] = window.BX.BADGES[p.badge_tier] || window.BX.BADGES.verified; return `<div class="verified-card" style="border-color:${col}55"><span class="vc-ic" style="color:${col};background:${col}1f">${icon("seal", 26)}</span><span><b>${esc(label)} ${esc(role.account.toLowerCase())}</b><small>${esc(sub)}. The badge shows on your profile and cards.</small></span></div>`; })() : "";
    $("#accCount").textContent = `${cl.done}/${cl.total}`;
    $("#filterDot").hidden = !(state.f.type !== "all" || state.f.cat || state.f.region);

    const row = (t, d, to, fx) => `<button class="acc-row" ${fx ? `data-fx="${fx}"` : to ? `data-go="${to}"` : "data-soon"}><span class="tx"><b>${esc(t)}</b><small>${esc(d)}</small></span><svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`;
    const orgRow = ["Organizations", "Teams, people, roles and access.", "orgs"], billRow = ["Plans & billing", "Your plan, payments and receipts.", "billing"];
    const menus = {
      worker: [["Edit profile", "Update profile details.", "edit-profile"], ["Wallet", "Earnings, balance and withdrawals.", "wallet"], ["Career growth", "Experience, level and certifications.", "growth"], ["Portfolio", "Add completed works with images and descriptions.", "portfolio"], ["Certifications", "Upload trade certificates and licences.", "certs"], ["Verification documents", "Verify your identity.", "verification"]],
      company: [["Edit company profile", "Update company details.", "edit-profile"], ["Wallet", "Add money, earnings and withdrawals.", "wallet"], ["Payments", "Worker payments and records.", "payments"], ["Equipment", "Find and request equipment.", "equipment"], ["Materials", "Find and compare materials.", "materials"], ["My orders", "Track what you have ordered.", "orders"], ["Job posts", "Post jobs and manage applicants.", "hires"], ["Team & join code", "Link a project manager to your company.", "team-link"], ["Verification documents", "Verify your company.", "verification"]],
      "project-manager": [["Edit profile", "Update profile details.", "edit-profile"], ["Wallet", "Earnings, balance and withdrawals.", "wallet"], ["Past projects", "Show projects you have delivered.", "portfolio"], ["Certifications", "Add your project management certificates.", "certs"], ["Link a company", "Join a company with its code.", "team-link"], ["Verification documents", "Verify your identity.", "verification"]],
      business: [["Edit business profile", "Update business details.", "edit-profile"], ["Wallet", "Earnings, balance and withdrawals.", "wallet"], ["Orders", "Orders from buyers, paid through escrow.", "orders"], ["Catalog", "Manage products and equipment.", "catalog"], ["Portfolio", "Show your products and past supply.", "portfolio"], ["Verification documents", "Verify your business.", "verification"]],
      "individual-employer": [["Edit profile", "Update profile details.", "edit-profile"], ["Wallet", "Add money and pay for work.", "wallet"], ["Post a job", "Hire a professional for your home.", "post-job"], ["My hires", "Keep a record of people you have hired.", "hires"], ["Equipment", "Rent or buy equipment from suppliers.", "equipment"], ["Materials", "Buy materials from suppliers.", "materials"], ["My orders", "Track what you have ordered.", "orders"], ["Verification documents", "Verify your identity.", "verification"]],
    };
    $("#accMenu").innerHTML = [billRow, orgRow, ...menus[me.role]].map(([t, d, to]) => row(t, d, to)).join("");
    $("#accAccount").innerHTML = [row("Add email", "Verify the email address for this account.", null, "add-email"), row("Change phone", "Update the mobile number linked to this account.", null, "change-phone"), row("Switch account", "Use another account on this device.", null, "switch-account"), row("Change password", "Set a new password for sign-in.", null, "change-password")].join("");
    $("#accInfo").innerHTML = [row("User guide", "How to use BAID X, step by step, for every role.", null, "open-docs"), row("Help center", "Guides and support articles.", "info/help"), row("Terms of service", "Read our service terms.", null, "open-terms"), row("Privacy policy", "Read how we handle your information.", null, "open-privacy"), row("About BAID X", "Product and company information.", null, "open-about")].join("");
  }

  const HOURGLASS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M7 3c0 5 5 5 5 9s-5 4-5 9M17 3c0 5-5 5-5 9s5 4 5 9"/></svg>';
  const CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
  function renderChecklist() {
    const me = state.me; if (!me?.role) return;
    const cl = checklistState(me.role, me.profile), pct = Math.round((cl.done / cl.total) * 100);
    $("#ckStatus").textContent = statusLabel(me.profile?.verification_status);
    $("#ckDone").textContent = `${cl.done} of ${cl.total} completed`; $("#ckPct").textContent = `${pct}%`; $("#ckBar").style.width = `${pct}%`;
    $("#ckList").innerHTML = cl.items.map((i, n) => `<button class="ck-item" data-go="step/${n}"><span class="ic ${i.done ? "ok" : "warn"}">${i.done ? CHECK : HOURGLASS}</span>
      <span class="tx"><b>${esc(i.title)}</b><small>${esc(i.desc)}</small></span><span class="st ${i.done ? "ok" : "warn"}">${i.done ? "Done" : "Pending"}</span>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`).join("");
  }

  async function renderChats() {
    return window.MARKET.chatsList($("#chatsMember"), dashCtx());
  }

  /* ---------- Filters ---------- */
  const TYPE_ROLE = { companies: "company", professionals: "worker", managers: "project-manager", businesses: "business" };
  const TYPE_LABEL = { all: "Any type", ...Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.label])) };
  function renderFilters() {
    const d = state.draft ||= { ...state.f };
    const frow = (key, ico, title, value, disabled) => `<button class="f-row ${disabled ? "off" : ""}" data-pick="${key}"><span class="ic">${ico}</span><span class="tx"><b>${title}</b><small>${esc(value)}</small></span>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`;
    $("#fList").innerHTML =
      frow("type", icon("team", 20), "Type", TYPE_LABEL[d.type]) +
      frow("cat", BAG, "Category", d.cat ? d.cat.name : d.type === "all" ? "Choose a type first" : "Any category", d.type === "all") +
      frow("region", PIN, "Location", d.region || "Any location");
  }
  function openPicker(key) {
    const d = state.draft;
    let title, items, current;
    if (key === "type") { title = "Type"; items = Object.entries(TYPE_LABEL).map(([id, name]) => ({ id, name })); current = d.type; }
    else if (key === "cat") {
      if (d.type === "all") return toast("Choose a type first.");
      title = "Category"; items = [{ id: "", name: "Any category" }, ...categoriesFor(TYPE_ROLE[d.type]).items]; current = d.cat?.id || "";
    } else { title = "Location"; items = [{ id: "", name: "Any location" }, ...REGIONS.map((r) => ({ id: r, name: r }))]; current = d.region || ""; }
    $("#pkTitle").textContent = title; $("#pkList").dataset.key = key;
    $("#pkList").innerHTML = items.map((i) => `<button class="pk ${i.id === current ? "on" : ""}" data-id="${esc(i.id)}"><span>${esc(i.name)}</span>${i.desc ? `<small>${esc(i.desc)}</small>` : ""}</button>`).join("");
    go("picker");
  }
  $("#pkList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]"); if (!b) return;
    const key = $("#pkList").dataset.key, d = state.draft, id = b.dataset.id;
    if (key === "type") { if (id !== d.type) d.cat = null; d.type = id; }
    else if (key === "cat") d.cat = id ? categoriesFor(TYPE_ROLE[d.type]).items.find((i) => i.id === id) : null;
    else d.region = id || null;
    history.back();
  });
  $("#fClear").addEventListener("click", () => { state.draft = { type: "all", cat: null, region: null }; renderFilters(); });
  $("#fApply").addEventListener("click", () => {
    state.f = { ...state.draft }; state.draft = null;
    if (state.f.type !== "all") state.filter = state.f.type; renderChips(); renderFeed(); paintMember(); go("discover");
  });

  /* ---------- Context shared with the dashboards (js/dash.js) ---------- */
  const dashCtx = () => ({
    sb, me: state.me, uid: state.me.session.user.id, role: state.me.role, profile: state.me.profile || {}, cl: state.cl,
    go, toast, state,
    // open Discover pre-filtered to a trade (used by the client's quick tiles)
    openDiscover: (type, cat) => { state.filter = type; state.f = { type, cat: cat || null, region: null }; state.dirInit = true; renderChips(); renderFeed(); paintMember(); go("discover"); },
  });

  /* ---------- Events ---------- */
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const tab = t.closest("[data-tab]"); if (tab) return go(tab.dataset.tab);
    const g = t.closest("[data-go]"); if (g) { if (g.dataset.go === "filters") state.draft = { ...state.f }; return go(g.dataset.go); }
    if (t.closest("[data-back]")) { if (history.length > 1) history.back(); else go("home"); return; }
    const chip = t.closest("[data-chip]"); if (chip) { state.filter = chip.dataset.chip; state.f.type = "all"; state.f.cat = null; renderChips(); renderFeed(); return; }
    const pick = t.closest("[data-pick]"); if (pick) return openPicker(pick.dataset.pick);
    if (t.closest("#logout")) { const me = state.me?.session?.user?.id; if (me) window.BX.accounts.signedOut(me); await sb.auth.signOut(); location.hash = "#/home"; location.reload(); return; }
    if (t.closest("[data-soon]")) return toast("This screen is built in the next stage.");
    const sign = t.closest("[data-action='join'],[data-action='signin']");
    if (sign) { const gr = sign.dataset.group; const mode = sign.dataset.action === "signin" ? "signin" : "signup"; return void (location.href = `auth.html?mode=${mode}${gr ? `&group=${gr}` : ""}`); }
    const card = t.closest(".card");
    if (card && !t.closest("[data-fx]")) {
      const role = R(), kind = card.dataset.kind;
      if (role === "company" && ["worker", "pm"].includes(kind)) return window.PROJ?.openInvite(kind, card.dataset.id);
      if (role === "project-manager" && kind === "worker") return window.PROJ?.openInvite("worker", card.dataset.id);
      return window.FEAT.openCard(kind, card.dataset.id);
    }
  });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; renderFeed(); });
  window.addEventListener("hashchange", route);
  window.APP = { state, go, route, dashCtx, appbar, updateBell, sources: SOURCES, renderNav: () => renderNav(), loadUnread: () => loadUnread(), refresh: async () => { state.me = await loadMe(); paintMember(); renderNav(); route(); } };

  /* ---------- Boot ---------- */
  renderChips(); renderNav(); runSplash();
  (async () => {
    state.me = await loadMe();
    if (state.me && !(await window.BX.sessionAlive())) { toast("Your sign-in expired. Please sign in again."); setTimeout(() => location.replace("auth.html"), 1200); return; }
    if (state.me && !state.me.role) { location.replace("auth.html"); return; }
    paintMember(); renderNav(); route(); loadDirectory(); loadUnread();
    window.dispatchEvent(new Event("baidx:member"));
  })();
})();
