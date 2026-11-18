/* SiteMart core: Supabase client, session, helpers and the shared pieces every page uses.
   Same Supabase project and accounts as BAID X (www.baid-x.com). Only the publishable key is here.
   Every value from the database goes through esc() before it is put on the page. */
(() => {
  const C = window.SITEMART_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, storageKey: "sitemart-auth" } });

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const url = (u) => esc(String(u || "").replace(/'/g, "%27"));
  const num = (v) => Number(v).toLocaleString("en-GH", { maximumFractionDigits: 2 });
  const money = (v) => `GH&#8373;${num(v)}`;
  const has = (v) => v != null && v !== "" && Number(v) > 0;

  const UNITS = { bag: ["bag", "bags"], tonne: ["tonne", "tonnes"], cubic_metre: ["m³", "m³"], trip: ["trip", "trips"], piece: ["piece", "pieces"],
    truckload: ["truckload", "truckloads"], bundle: ["bundle", "bundles"], square_metre: ["m²", "m²"], box: ["box", "boxes"], litre: ["litre", "litres"],
    bucket: ["bucket", "buckets"], roll: ["roll", "rolls"], metre: ["metre", "metres"], length: ["length", "lengths"], set: ["set", "sets"] };
  const unit = (u, n = 1) => (UNITS[u] ? UNITS[u][Number(n) === 1 ? 0 : 1] : "");
  const DELIVERY = { pickup: "Pickup from the supplier", supplier_delivery: "Supplier delivers", sitemart_logistics: "SiteMart logistics partner" };
  const OPERATOR = { included: "Operator included", optional: "Operator on request", none: "No operator" };
  const TRUST = {
    verified_business: ["Verified business", "BAID X checked this business's registration and documents."],
    verified_identity: ["Identity verified", "BAID X checked this member's identity documents. The business itself is not yet verified."],
    in_review: ["Documents in review", "This member sent documents. BAID X has not finished checking them."],
    unverified: ["Not yet verified", "BAID X has not checked this member's documents yet. Take extra care."],
  };
  const REGIONS = ["Greater Accra", "Ashanti", "Western", "Central", "Eastern", "Volta", "Northern", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo", "Oti", "Savannah", "North East", "Western North"];

  // Line icons only, in currentColor.
  const P = (d, w = 22) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    bag: P('<path d="M6 7h12l1 13H5z"/><path d="M9 7V5h6v2"/><path d="M8 12h8"/>'),
    pile: P('<path d="M3 19h18L15 8l-3 4-2-3z"/>'),
    stack: P('<rect x="3" y="13" width="8" height="6"/><rect x="13" y="13" width="8" height="6"/><rect x="8" y="6" width="8" height="6"/>'),
    rod: P('<path d="M4 20 20 4M7 21 21 7M3 17 17 3"/>'),
    sheet: P('<path d="M3 16l9-9 9 9"/><path d="M6 13v7h12v-7"/>'),
    tile: P('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
    paint: P('<rect x="4" y="3" width="13" height="6" rx="1"/><path d="M17 6h3v5h-8v3"/><rect x="10" y="14" width="4" height="7" rx="1"/>'),
    bolt: P('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    pipe: P('<path d="M3 8h9a4 4 0 0 1 4 4v9"/><path d="M3 12h9v9"/>'),
    wood: P('<ellipse cx="7" cy="12" rx="3" ry="6"/><path d="M7 6h12M7 18h12M19 6v12"/>'),
    window: P('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 12h16"/>'),
    box: P('<path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>'),
    dig: P('<path d="M3 18h10v-4H6z"/><path d="M13 14l3-7 4 2-1 4h-3"/><circle cx="5" cy="20" r="1"/><circle cx="11" cy="20" r="1"/>'),
    truck: P('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
    crane: P('<path d="M6 21V3l14 4H6M10 7v14M4 21h8M18 7v6"/><path d="M16 13h4v3h-4z"/>'),
    power: P('<rect x="3" y="7" width="18" height="11" rx="2"/><path d="M12 9l-2 4h4l-2 4M7 18v2M17 18v2"/>'),
    gear: P('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
    check: P('<path d="m5 12 4.5 4.5L19 7"/>', 14),
    search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 20),
    back: P('<path d="m15 5-7 7 7 7"/>', 20),
    home: P('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
    market: P('<path d="M4 7h16l-1 4H5z"/><path d="M5 11v9h14v-9M9 20v-5h6v5"/>'),
    route: P('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6"/>'),
    house: P('<path d="M4 20V9l8-5 8 5v11z"/><path d="M10 20v-6h4v6"/>'),
    user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    heart: P('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', 18),
    shield: P('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  };
  const CAT_ICON = { cement: "bag", "quarry-dust": "pile", aggregates: "pile", sand: "pile", blocks: "stack", bricks: "stack", "iron-rods": "rod", steel: "rod",
    roofing: "sheet", tiles: "tile", paint: "paint", electrical: "bolt", plumbing: "pipe", timber: "wood", glass: "window", "doors-windows": "window",
    "concrete-products": "stack", insulation: "box", "other-supplies": "box", excavators: "dig", bulldozers: "dig", "wheel-loaders": "dig", cranes: "crane",
    forklifts: "truck", graders: "dig", rollers: "truck", "dump-trucks": "truck", "concrete-mixers": "truck", "concrete-pumps": "truck", drilling: "gear",
    generators: "power", compactors: "gear", tractors: "truck", industrial: "gear" };
  const catIcon = (slug, kind) => ICON[CAT_ICON[slug] || (kind === "equipment" ? "dig" : "box")];

  // Turn a database or network error into words a member understands.
  function say(e) {
    const m = String((e && (e.message || e.error_description)) || e || "");
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "We couldn't reach SiteMart. Check your connection and try again.";
    if (/JWT|expired|not authenticated/i.test(m)) return "Your session has ended. Please sign in again.";
    if (/Invalid login credentials/i.test(m)) return "That email and password don't match. Try again or reset your password.";
    if (/already registered|already been registered/i.test(m)) return "There is already an account with this email. Sign in instead.";
    if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
    if (/Could not find the function|PGRST202|404/i.test(m)) return "This part of SiteMart is still being switched on. Please try again later.";
    if (/^[a-z][a-z ,.'0-9+()-]{3,160}$/i.test(m) && !/[_{}]|exception|violates|column|relation|syntax/i.test(m)) return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
    return "Something went wrong. Please try again.";
  }

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }

  // Session and SiteMart account, refreshed on sign-in and sign-out.
  const S = { user: null, me: null, ready: null };
  async function loadMe() {
    const { data } = await sb.auth.getSession();
    S.user = data.session ? data.session.user : null;
    S.me = null;
    if (S.user) { try { S.me = await rpc("sm_me"); } catch (e) { console.error(e); } }
    document.dispatchEvent(new CustomEvent("sm:session"));
    return S;
  }
  S.ready = loadMe();
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT" || ev === "USER_UPDATED") loadMe(); });

  // One button that cannot be pressed twice while it works.
  async function busy(btn, fn) {
    if (!btn || btn.disabled) return;
    const label = btn.innerHTML; btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Please wait';
    try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.innerHTML = label; }
  }
  function toast(msg, ok) {
    let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.className = ok ? "ok on" : "on"; t.textContent = msg; clearTimeout(t._h); t._h = setTimeout(() => { t.className = ""; }, 4200);
  }

  /* ---------- shared cards ---------- */
  function priceLine(i) {
    if (i.kind === "equipment") {
      if (has(i.daily_rate)) return `${money(i.daily_rate)}<small>/day</small>`;
      if (has(i.hourly_rate)) return `${money(i.hourly_rate)}<small>/hour</small>`;
      if (has(i.weekly_rate)) return `${money(i.weekly_rate)}<small>/week</small>`;
      if (has(i.sale_price)) return money(i.sale_price);
      return "Ask for price";
    }
    return has(i.price) ? `${money(i.price)}${i.unit ? `<small>/${esc(unit(i.unit))}</small>` : ""}` : "Ask for price";
  }
  function card(i) {
    const img = (i.images || [])[0], s = i.supplier || {}, eq = i.kind === "equipment";
    const rent = eq && (has(i.daily_rate) || has(i.hourly_rate) || has(i.weekly_rate)), sale = eq && has(i.sale_price);
    const meta = eq ? [rent && sale ? "Rent or buy" : rent ? "For rent" : sale ? "For sale" : "", i.year && String(i.year), i.manufacturer].filter(Boolean)
      : [i.min_order && `Min. ${num(i.min_order)} ${unit(i.unit, i.min_order)}`.trim(), (i.bulk || []).length ? "Bulk prices" : ""].filter(Boolean);
    return `<a class="card" href="#/item/${eq ? "equipment" : "material"}/${esc(i.id)}">
      <span class="pic" ${img ? `style="background-image:url('${url(img)}')"` : ""}>${img ? "" : `<i class="ph">${catIcon(i.category_slug, i.kind)}</i>`}
        ${s.verified ? `<em class="tag ok">${ICON.check} Verified</em>` : ""}${i.featured ? '<em class="tag ft">Featured</em>' : ""}</span>
      <span class="body"><small class="cat">${esc(i.category || (eq ? "Equipment" : "Material"))}</small><b class="name">${esc(i.name)}</b>
        <span class="price">${priceLine(i)}</span>
        ${meta.length ? `<span class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</span>` : ""}
        <small class="by">${esc(s.name || "Supplier")}${s.town || s.region ? ` · ${esc(s.town || s.region)}` : ""}</small></span></a>`;
  }
  const skel = (n = 6) => '<div class="card skel" aria-hidden="true"></div>'.repeat(n);
  const empty = (title, body, action = "") => `<div class="empty"><b>${title}</b><p>${body}</p>${action}</div>`;
  const failed = (what) => empty(`We couldn't load ${what}`, "Check your connection and try again.", '<button class="btn ghost sm" type="button" data-retry>Try again</button>');
  function supplierChip(s) {
    return `<a class="sup" href="#/supplier/${esc(s.id)}"><span class="logo" ${s.logo ? `style="background-image:url('${url(s.logo)}')"` : ""}>${s.logo ? "" : esc((s.name || "S")[0])}</span>
      <span><b>${esc(s.name || "Supplier")}</b><small>${s.verified ? `<em class="vb">${ICON.check} Verified business</em>` : "Not yet verified"} · ${esc(s.town || s.region || "Ghana")}</small></span></a>`;
  }

  window.SM = { C, sb, S, $, $$, esc, url, num, money, has, unit, UNITS, DELIVERY, OPERATOR, TRUST, REGIONS, ICON, catIcon, say, rpc, loadMe, busy, toast, card, priceLine, skel, empty, failed, supplierChip };
})();
