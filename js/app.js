(() => {
  "use strict";

  const cfg = window.BAIDX_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  /* ---------- Guest directory sources ----------
     Only public-safe columns are ever requested. */
  const SOURCES = {
    companies: {
      label: "Companies",
      table: "company_profiles",
      cols: "id,company_name,industry_sector,company_size,city_town,region,company_logo_url,company_overview,trust_score,verification_status",
      map: (r) => ({
        kind: "company", id: r.id, name: r.company_name, image: r.company_logo_url, cover: null,
        desc: r.company_overview || "Verified company on BAID X.",
        tag: pretty(r.industry_sector), place: place(r),
        stats: [[fmtNum(r.trust_score, 1), "Trust"], [pretty(r.company_size) || "—", "Size"]],
      }),
    },
    professionals: {
      label: "Professionals",
      table: "worker_profiles",
      cols: "id,full_name,specialty,short_bio,years_of_experience,daily_rate_ghs,city_town,region,profile_photo_url,portfolio_photo_urls,rank_tier,available_for_work,verification_status",
      map: (r) => ({
        kind: "worker", id: r.id, name: r.full_name, image: r.profile_photo_url, cover: (r.portfolio_photo_urls || [])[0] || null,
        desc: r.short_bio || (r.specialty ? `${r.specialty} based in ${r.city_town || "Ghana"}.` : "Skilled professional on BAID X."),
        tag: r.specialty || pretty(r.rank_tier) || "Professional", place: place(r),
        stats: [[r.daily_rate_ghs ? `GH₵${fmtNum(r.daily_rate_ghs, 0)}` : "—", "Daily rate"], [pretty(r.years_of_experience) || "—", "Experience"]],
      }),
    },
    managers: {
      label: "Project Managers",
      table: "project_manager_profiles",
      cols: "id,full_name,specialization,specialization_tags,years_managing_projects,projects_managed_count,city_town,region,profile_photo_url,verification_status",
      map: (r) => ({
        kind: "pm", id: r.id, name: r.full_name, image: r.profile_photo_url, cover: null,
        desc: (r.specialization_tags || []).slice(0, 3).join(" · ") || "Project manager on BAID X.",
        tag: pretty(r.specialization) || "Project Manager", place: place(r),
        stats: [[r.projects_managed_count ?? 0, "Projects"], [r.years_managing_projects ?? 0, "Years"]],
      }),
    },
    businesses: {
      label: "Businesses",
      table: "business_profiles",
      cols: "id,business_name,specialty,short_bio,years_in_operation,crew_size,city_town,region,logo_url,portfolio_photo_urls,verification_status",
      map: (r) => ({
        kind: "business", id: r.id, name: r.business_name, image: r.logo_url, cover: (r.portfolio_photo_urls || [])[0] || null,
        desc: r.short_bio || "Supplier of products, equipment and materials.",
        tag: r.specialty || "Supplier", place: place(r),
        stats: [[r.crew_size ?? 0, "Crew"], [r.years_in_operation ?? 0, "Years"]],
      }),
    },
  };
  const CHIPS = [["all", "All"], ...Object.entries(SOURCES).map(([k, v]) => [k, v.label])];

  function place(r) {
    return [r.city_town, r.region].filter((v) => v && v.toLowerCase() !== "pending").join(", ") || "Ghana";
  }
  function fmtNum(n, d = 0) { const x = Number(n); return Number.isFinite(x) ? x.toFixed(d) : "—"; }
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  /* ---------- Splash ---------- */
  function runSplash() {
    const el = $("#splash");
    const seen = sessionStorageGet("baidx_splash");
    const wait = seen ? 0 : 1800;
    setTimeout(() => {
      el.classList.add("hide");
      sessionStorageSet("baidx_splash", "1");
    }, wait);
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }

  /* ---------- Tabs ---------- */
  function showTab(tab) {
    if (!["home", "chats", "profile"].includes(tab)) tab = "home";
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${tab}`));
    $$(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    window.scrollTo(0, 0);
  }
  const route = () => showTab((location.hash || "#/home").replace("#/", ""));

  /* ---------- Home feed ---------- */
  const state = { filter: "all", q: "", items: [], loading: false, failed: false };

  function renderChips() {
    $("#chips").innerHTML = CHIPS.map(([k, l]) => `<button class="chip ${state.filter === k ? "on" : ""}" data-chip="${k}">${esc(l)}</button>`).join("");
  }

  function cardHTML(it) {
    const cover = it.cover
      ? `<div class="cover" style="background-image:url('${esc(it.cover)}')"></div>`
      : `<div class="cover ph"><img src="assets/favicon.png" alt="" /></div>`;
    const avatar = it.image
      ? `<div class="avatar" style="background-image:url('${esc(it.image)}')"></div>`
      : `<div class="avatar initials">${esc(initials(it.name))}</div>`;
    return `
      <article class="card" data-kind="${it.kind}" data-id="${esc(it.id)}">
        ${cover}${avatar}
        <div class="card-body">
          <h3>${esc(it.name)}</h3>
          <p class="desc">${esc(it.desc)}</p>
          <div class="meta"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/></svg><span>${esc(it.tag)}</span></div>
          <div class="meta loc"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/></svg><span>${esc(it.place)}</span></div>
        </div>
        <div class="stats">${it.stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join("")}</div>
      </article>`;
  }

  function renderFeed() {
    const feed = $("#feed");
    if (state.loading) { feed.innerHTML = '<div class="skel"></div>'.repeat(3); return; }
    if (state.failed) {
      feed.innerHTML = '<div class="state" style="grid-column:1/-1"><b>Couldn\'t load the directory</b>Check your connection and try again.</div>';
      return;
    }
    const q = state.q.trim().toLowerCase();
    const list = state.items.filter((it) => state.filter === "all" || it.group === state.filter)
      .filter((it) => !q || `${it.name} ${it.tag} ${it.place} ${it.desc}`.toLowerCase().includes(q));
    feed.innerHTML = list.length
      ? list.map(cardHTML).join("")
      : '<div class="state" style="grid-column:1/-1"><b>No results</b>Try another search or category.</div>';
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
    } catch (e) {
      console.error("directory load failed", e);
      state.failed = true;
    }
    state.loading = false; renderFeed();
  }

  /* ---------- Guest gates ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }
  const needAccount = () => toast("Sign-in and join screens are coming in the next stage.");

  /* ---------- Events ---------- */
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) { location.hash = `#/${tab.dataset.tab}`; return; }
    const chip = e.target.closest("[data-chip]");
    if (chip) { state.filter = chip.dataset.chip; renderChips(); renderFeed(); return; }
    if (e.target.closest("[data-action='join'],[data-action='signin'],.card")) needAccount();
  });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; renderFeed(); });
  window.addEventListener("hashchange", route);

  renderChips();
  route();
  runSplash();
  loadDirectory();
})();
