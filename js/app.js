(() => {
  "use strict";
  const { sb, $, $$, esc, pretty, real, toast, ROLES, JOB_CAT_BY_ID, REGIONS, categoriesFor, loadMe, checklistState, statusLabel } = window.BX;

  /* ---------- Directory sources (public-safe columns only) ---------- */
  const place = (r) => [r.city_town, r.region].filter(real).join(", ") || "Ghana";
  const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : "—");
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const SOURCES = {
    companies: {
      label: "Companies", role: "company", table: "company_profiles",
      cols: "id,company_name,industry_sector,company_size,city_town,region,company_logo_url,company_overview,trust_score,verification_status",
      map: (r) => ({
        kind: "company", id: r.id, name: r.company_name, image: r.company_logo_url, cover: null,
        desc: r.company_overview || "Verified company on BAID X.", tag: pretty(r.industry_sector), place: place(r),
        catId: r.industry_sector, region: r.region,
        stats: [[num(r.trust_score, 1), "Trust"], [pretty(r.company_size) || "—", "Size"]],
      }),
    },
    professionals: {
      label: "Professionals", role: "worker", table: "worker_profiles",
      cols: "id,full_name,specialty,short_bio,primary_job_category_id,years_of_experience,daily_rate_ghs,city_town,region,profile_photo_url,portfolio_photo_urls,rank_tier,verification_status",
      map: (r) => {
        const trade = JOB_CAT_BY_ID[r.primary_job_category_id]?.name || r.specialty;
        return {
          kind: "worker", id: r.id, name: r.full_name, image: r.profile_photo_url, cover: (r.portfolio_photo_urls || [])[0] || null,
          desc: r.short_bio || (trade ? `${trade} based in ${r.city_town || "Ghana"}.` : "Skilled professional on BAID X."),
          tag: trade || pretty(r.rank_tier) || "Professional", place: place(r), catId: r.primary_job_category_id, region: r.region,
          stats: [[r.daily_rate_ghs ? `GH₵${num(r.daily_rate_ghs)}` : "—", "Daily rate"], [pretty(r.years_of_experience) || "—", "Experience"]],
        };
      },
    },
    managers: {
      label: "Project Managers", role: "project-manager", table: "project_manager_profiles",
      cols: "id,full_name,specialization,specialization_tags,years_managing_projects,projects_managed_count,city_town,region,profile_photo_url,verification_status",
      map: (r) => ({
        kind: "pm", id: r.id, name: r.full_name, image: r.profile_photo_url, cover: null,
        desc: (r.specialization_tags || []).slice(0, 3).join(" · ") || "Project manager on BAID X.",
        tag: pretty(r.specialization) || "Project Manager", place: place(r), catId: r.specialization, region: r.region,
        stats: [[r.projects_managed_count ?? 0, "Projects"], [r.years_managing_projects ?? 0, "Years"]],
      }),
    },
    businesses: {
      label: "Businesses", role: "business", table: "business_profiles",
      cols: "id,business_name,specialty,short_bio,years_in_operation,crew_size,city_town,region,logo_url,portfolio_photo_urls,verification_status",
      map: (r) => ({
        kind: "business", id: r.id, name: r.business_name, image: r.logo_url, cover: (r.portfolio_photo_urls || [])[0] || null,
        desc: r.short_bio || "Supplier of products, equipment and materials.", tag: r.specialty || "Supplier", place: place(r),
        catId: r.specialty, region: r.region,
        stats: [[r.crew_size ?? 0, "Crew"], [r.years_in_operation ?? 0, "Years"]],
      }),
    },
  };
  const CHIPS = [["all", "All"], ...Object.entries(SOURCES).map(([k, v]) => [k, v.label])];

  const state = { me: null, filter: "all", q: "", items: [], loading: false, failed: false, f: { type: "all", cat: null, region: null }, draft: null };

  /* ---------- Splash ---------- */
  const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };
  function runSplash() {
    const el = $("#splash");
    setTimeout(() => { el.classList.add("hide"); ssSet("baidx_splash", "1"); }, ssGet("baidx_splash") ? 0 : 1800);
  }

  /* ---------- Routing ---------- */
  const TABS = ["home", "chats", "profile"], SUBS = ["checklist", "filters", "picker"];
  function route() {
    let r = (location.hash || "#/home").replace("#/", "");
    if (![...TABS, ...SUBS].includes(r)) r = "home";
    if (SUBS.includes(r) && !state.me?.role) r = "home";
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${r}`));
    $$(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === r));
    $("#nav").hidden = SUBS.includes(r);
    if (r === "checklist") renderChecklist();
    if (r === "filters") renderFilters();
    window.scrollTo(0, 0);
  }
  const go = (r) => { location.hash = `#/${r}`; };

  /* ---------- Home feed ---------- */
  function renderChips() {
    $("#chips").innerHTML = CHIPS.map(([k, l]) => `<button class="chip ${state.filter === k ? "on" : ""}" data-chip="${k}">${esc(l)}</button>`).join("");
  }
  const PIN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linejoin="round"><path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/></svg>';
  const BAG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.500"/><path d="M9 7V5.500A1.500 1.500 0 0 1 10.500 4h3A1.500 1.500 0 0 1 15 5.500V7"/></svg>';
  function cardHTML(it) {
    const cover = it.cover ? `<div class="cover" style="background-image:url('${esc(it.cover)}')"></div>` : '<div class="cover ph"><img src="assets/favicon.png" alt="" /></div>';
    const avatar = it.image ? `<div class="avatar" style="background-image:url('${esc(it.image)}')"></div>` : `<div class="avatar initials">${esc(initials(it.name))}</div>`;
    return `<article class="card" data-id="${esc(it.id)}">${cover}${avatar}
      <div class="card-body"><h3>${esc(it.name)}</h3><p class="desc">${esc(it.desc)}</p>
        <div class="meta">${BAG}<span>${esc(it.tag)}</span></div><div class="meta loc">${PIN}<span>${esc(it.place)}</span></div></div>
      <div class="stats">${it.stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join("")}</div></article>`;
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
        const { data, error } = await sb.from(s.table).select(s.cols).eq("verification_status", "verified").limit(50);
        if (error) throw error;
        return (data || []).map((r) => ({ ...s.map(r), group }));
      }));
      state.items = results.flat();
    } catch (e) { console.error("directory load failed", e); state.failed = true; }
    state.loading = false; renderFeed();
  }

  /* ---------- Member UI ---------- */
  function paintMember() {
    const me = state.me, member = !!me?.role;
    $("#joinBtn").hidden = member; $("#filterBtn").hidden = !member;
    $("#chatsGuest").hidden = member; $("#chatsMember").hidden = !member;
    $("#profileGuest").hidden = member; $("#profileMember").hidden = !member;
    if (!member) { $("#setupBanner").hidden = true; return; }
    const role = ROLES[me.role], p = me.profile || {}, cl = checklistState(me.role, p);
    const name = p[role.nameKey] || "Your account", phone = p[role.phoneKey] || me.session.user.phone || me.session.user.email || "";
    const photo = p.profile_photo_url || p.company_logo_url || p.logo_url;
    $("#accAvatar").style.backgroundImage = photo ? `url('${photo.replace(/'/g, "%27")}')` : "";
    $("#accAvatar").textContent = photo ? "" : initials(name);
    $("#accName").textContent = name; $("#accPhone").textContent = phone ? (/^\d/.test(phone) ? `+${phone}` : phone) : "";
    $("#accRole").textContent = role.account; $("#accStatus").textContent = statusLabel(p.verification_status);
    $("#accCount").textContent = `${cl.done}/${cl.total}`;
    $("#setupBanner").hidden = p.verification_status === "verified" && cl.done === cl.total;
    $("#bannerCount").textContent = `${cl.done}/${cl.total} complete`;
    $("#filterDot").hidden = !(state.f.type !== "all" || state.f.cat || state.f.region);

    const row = (t, d, extra = "") => `<button class="acc-row" data-soon><span class="tx"><b>${esc(t)}</b><small>${esc(d)}</small></span>${extra}<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`;
    const menus = {
      worker: [["Edit profile", "Update profile details."], ["Portfolio", "Add completed works with images, descriptions, and links."], ["Professional credentials", "Manage associations, licences, and certifications."], ["Verification documents", "Verify your identity."]],
      company: [["Edit company profile", "Update company details."], ["Projects", "Create and manage your projects."], ["Team & join code", "Link a project manager to your company."], ["Verification documents", "Verify your company."]],
      "project-manager": [["Edit profile", "Update profile details."], ["Past projects", "Show projects you have delivered."], ["Certifications", "Add your project management certificates."], ["Verification documents", "Verify your identity."]],
      business: [["Edit business profile", "Update business details."], ["Catalog", "Manage products and equipment."], ["Portfolio", "Show your products and past supply."], ["Verification documents", "Verify your business."]],
      "individual-employer": [["Edit profile", "Update profile details."], ["My hires", "Keep a record of people you have hired."]],
    };
    $("#accMenu").innerHTML = menus[me.role].map(([t, d]) => row(t, d)).join("");
    $("#accAccount").innerHTML = [row("Add email", "Verify the email address for this account."), row("Change phone", "Update the mobile number linked to this account."), row("Change password", "Set a new password for sign-in."), row("Wallet", "Balance, deposits and withdrawals.")].join("");
    $("#accInfo").innerHTML = [row("Help center", "Guides and support articles."), row("Terms of service", "Read our service terms."), row("Privacy policy", "Read how we handle your information."), row("About BAID X", "Product and company information.")].join("");
  }

  const HOURGLASS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M7 3c0 5 5 5 5 9s-5 4-5 9M17 3c0 5-5 5-5 9s5 4 5 9"/></svg>';
  const CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
  function renderChecklist() {
    const me = state.me; if (!me?.role) return;
    const cl = checklistState(me.role, me.profile), pct = Math.round((cl.done / cl.total) * 100);
    $("#ckStatus").textContent = statusLabel(me.profile?.verification_status);
    $("#ckDone").textContent = `${cl.done} of ${cl.total} completed`; $("#ckPct").textContent = `${pct}%`; $("#ckBar").style.width = `${pct}%`;
    $("#ckList").innerHTML = cl.items.map((i) => `<button class="ck-item" data-soon><span class="ic ${i.done ? "ok" : "warn"}">${i.done ? CHECK : HOURGLASS}</span>
      <span class="tx"><b>${esc(i.title)}</b><small>${esc(i.desc)}</small></span><span class="st ${i.done ? "ok" : "warn"}">${i.done ? "Done" : "Pending"}</span>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`).join("");
  }

  /* ---------- Filters ---------- */
  const TYPE_ROLE = { companies: "company", professionals: "worker", managers: "project-manager", businesses: "business" };
  const TYPE_LABEL = { all: "Any type", ...Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.label])) };
  function renderFilters() {
    const d = state.draft ||= { ...state.f };
    const frow = (key, icon, title, value, disabled) => `<button class="f-row ${disabled ? "off" : ""}" data-pick="${key}"><span class="ic">${icon}</span><span class="tx"><b>${title}</b><small>${esc(value)}</small></span>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`;
    $("#fList").innerHTML =
      frow("type", '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round"><circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.7-3.500 3.200-5 6.500-5s5.800 1.500 6.500 5M16 5.500a3.500 3.500 0 0 1 0 6.500M18 15c2 .6 3.200 2 3.500 5"/></svg>', "Type", TYPE_LABEL[d.type]) +
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
    if (state.f.type !== "all") state.filter = state.f.type; renderChips(); renderFeed(); paintMember(); go("home");
  });

  /* ---------- Events ---------- */
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const tab = t.closest("[data-tab]"); if (tab) return go(tab.dataset.tab);
    const g = t.closest("[data-go]"); if (g) { if (g.dataset.go === "filters") state.draft = { ...state.f }; return go(g.dataset.go); }
    if (t.closest("[data-back]")) { if (history.length > 1) history.back(); else go("home"); return; }
    const chip = t.closest("[data-chip]"); if (chip) { state.filter = chip.dataset.chip; state.f.type = "all"; state.f.cat = null; renderChips(); renderFeed(); return; }
    const pick = t.closest("[data-pick]"); if (pick) return openPicker(pick.dataset.pick);
    if (t.closest("#logout")) { await sb.auth.signOut(); location.hash = "#/home"; location.reload(); return; }
    if (t.closest("[data-soon]")) return toast("This screen is built in the next stage.");
    const sign = t.closest("[data-action='join'],[data-action='signin']");
    if (sign) { const g = sign.dataset.group; const mode = sign.dataset.action === "signin" ? "signin" : "signup"; return void (location.href = `auth.html?mode=${mode}${g ? `&group=${g}` : ""}`); }
    if (t.closest(".card")) return toast("Public profile pages are built in a later stage.");
  });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; renderFeed(); });
  window.addEventListener("hashchange", route);

  /* ---------- Boot ---------- */
  renderChips(); runSplash();
  (async () => {
    state.me = await loadMe();
    if (state.me && !state.me.role) { location.replace("auth.html"); return; }
    paintMember(); route(); loadDirectory();
  })();
})();
