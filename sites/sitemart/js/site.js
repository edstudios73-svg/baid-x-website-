/* SiteMart pages. Phase 1 of docs/sitemart/ARCHITECTURE.md: landing, materials and equipment marketplaces,
   global search, listing and supplier pages, sign-in, SiteMart account types, verification documents,
   seller listing details and saved items. Reads: sitemart_home, sitemart_search, sitemart_listing,
   sitemart_supplier. Writes: sm_register, sm_listing_details, sm_toggle_saved, sm_submit_verification
   (supabase/phase27_sitemart_foundation.sql). Ordering, quotes and payment stay on BAID X until Phase 2. */
(() => {
  const { C, sb, S, $, $$, esc, num, money, has, unit, UNITS, DELIVERY, OPERATOR, TRUST, REGIONS, ICON, catIcon, say, rpc, busy, toast, card, skel, empty, failed, supplierChip } = window.SM;
  const view = () => $("#view");
  let HOME = null; // sitemart_home(), kept for categories and countries
  const home$ = async () => (HOME = HOME || (await rpc("sitemart_home")));

  const ACCOUNT_TYPES = [
    ["buyer", "Individual buyer", "Buy materials and rent machines for your own build."],
    ["construction_company", "Construction company", "Source for many sites and projects as a company."],
    ["contractor", "Contractor", "Buy and rent for the jobs you run."],
    ["project_manager", "Project manager", "Plan what a project needs and buy it for the team."],
    ["developer", "Real estate developer", "Source materials and machines for your developments."],
    ["material_supplier", "Building material supplier", "Sell cement, blocks, rods, roofing and more."],
    ["equipment_owner", "Equipment owner", "Rent out or sell your own machines."],
    ["rental_company", "Equipment rental company", "Rent out a fleet of machines."],
    ["logistics", "Logistics and transport", "Carry materials and machines to site."],
    ["property_agent", "Property agent", "List land and property when Real Estate opens."],
  ];
  const TYPE_NAME = Object.fromEntries(ACCOUNT_TYPES.map(([k, n]) => [k, n]));
  const SELLER = ["material_supplier", "equipment_owner", "rental_company"];
  const PW_RULE = "Use at least 8 characters with a lowercase letter, a capital letter, a number and a symbol.";
  const pwOk = (p) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/.test(p);

  const route = () => {
    const [path, qs] = (location.hash.replace(/^#/, "") || "/").split("?");
    return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(qs || "") };
  };
  const go = (path, params = {}) => {
    const q = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => v && q.set(k, v));
    location.hash = `#/${path}${q.toString() ? `?${q}` : ""}`;
  };

  /* ---------- home ---------- */
  function catTiles(list, kind) {
    return list.filter((c) => c.kind === kind).map((c) => `<a class="tile" href="#/${kind === "material" ? "market" : "equipment"}?cat=${esc(c.slug)}">
      <i>${catIcon(c.slug, c.kind)}</i><b>${esc(c.name)}</b><small>${c.count ? `${num(c.count)} ${c.count === 1 ? "listing" : "listings"}` : "No listings yet"}</small></a>`).join("");
  }
  function trackingExample() {
    // An illustrative example, clearly labelled. Real tracking (Phase 3) shows only GPS fixes from authorised devices,
    // checkpoints confirmed by logistics operators, and estimates marked as estimates.
    const stops = [
      ["Order confirmed", "Accra, Ghana", "check", "Mon 08:12"], ["Payment secured in escrow", "BAID X", "check", "Mon 08:13"],
      ["Loaded and dispatched", "Tema, Ghana", "check", "Mon 14:40"], ["Border checkpoint", "Aflao, Ghana / Lomé, Togo", "check", "Tue 09:05"],
      ["Last GPS position", "Near Cotonou, Benin", "gps", "Tue 18:22"], ["Border checkpoint", "Seme, Benin / Nigeria", "est", "Wed, estimated"],
      ["Delivered", "Lagos, Nigeria", "est", "Thu, estimated"]];
    return `<section class="band track" aria-labelledby="trackh">
      <div class="band-head"><span class="eyebrow">Logistics</span><h2 id="trackh">See where your delivery is</h2>
        <p>Every order that ships gets its own tracking page with a timeline, the vehicle and the transport company. We always show how we know where it is.</p></div>
      <div class="demo glass">
        <div class="demo-top"><b>Example shipment</b><span class="pill">Example only, not a real order</span></div>
        <p class="muted small">600 bags of cement from Tema to Lagos. Tracking opens in a later phase; this shows how it will read.</p>
        <ol class="tl">${stops.map(([t, where, how, when]) => `<li class="${how}"><span class="dot" aria-hidden="true"></span><div><b>${t}</b><small>${where}</small></div><time>${when}</time></li>`).join("")}</ol>
        <div class="legend"><span class="check"><i></i>Checkpoint confirmed by the transport company</span><span class="gps"><i></i>Live GPS from the vehicle</span><span class="est"><i></i>Estimated, not confirmed</span></div>
      </div></section>`;
  }
  async function pageHome() {
    view().innerHTML = `
      <section class="hero">
        <span class="eyebrow">SiteMart · Ghana</span>
        <h1>Building materials, machines and delivery in one place.</h1>
        <p class="sub">Buy cement, blocks and iron rods, rent or buy heavy equipment, and pay through BAID X escrow, so the supplier is paid only once you confirm delivery.</p>
        <form class="find" id="find" role="search">
          <label class="field">${ICON.search}<input name="q" type="search" placeholder="Cement, excavator, roofing sheets, supplier…" aria-label="Search SiteMart" autocomplete="off" /></label>
          <button class="btn light" type="submit">Search</button>
        </form>
        <div class="quick"><a href="#/market">Materials</a><a href="#/equipment?deal=rent">Rent equipment</a><a href="#/equipment?deal=sale">Buy equipment</a><a href="#/join">List your business</a></div>
      </section>
      <section class="band"><div class="band-head"><span class="eyebrow">Materials</span><h2>Shop by material</h2></div><div class="tiles" id="mcats">${'<div class="tile skel"></div>'.repeat(8)}</div></section>
      <section class="band"><div class="band-head"><span class="eyebrow">Equipment</span><h2>Rent or buy machines</h2></div><div class="tiles" id="ecats">${'<div class="tile skel"></div>'.repeat(8)}</div></section>
      <section class="band"><div class="band-head row"><div><span class="eyebrow">New on SiteMart</span><h2>Latest listings</h2></div><a class="btn ghost sm" href="#/market">See all</a></div><div class="grid" id="latest">${skel(4)}</div></section>
      <section class="band"><div class="band-head"><span class="eyebrow">Trust</span><h2>Verified suppliers</h2><p>Businesses whose registration and documents BAID X has checked. A paid plan never buys this mark.</p></div><div class="sups" id="sups"></div></section>
      <section class="band" aria-labelledby="esch"><div class="band-head"><span class="eyebrow">Payment protection</span><h2 id="esch">How escrow protects your money</h2></div>
        <ol class="steps">
          <li><b>1</b><h3>You order and pay</h3><p>Pay from your BAID X wallet with Mobile Money, bank or card. The money is held, not sent to the supplier.</p></li>
          <li><b>2</b><h3>The supplier prepares</h3><p>The supplier sees the payment is secured and gets your order ready.</p></li>
          <li><b>3</b><h3>It is delivered</h3><p>You follow the delivery and check what arrives: quantity, condition, the right product.</p></li>
          <li><b>4</b><h3>You confirm</h3><p>Once you confirm, the supplier is paid, less the 10% BAID X service fee. You both get a record.</p></li>
          <li><b>5</b><h3>Something wrong?</h3><p>Open a dispute. The money stays held while BAID X reviews the evidence from both sides.</p></li>
        </ol></section>
      ${trackingExample()}
      <section class="band split">
        <div class="glass pad"><span class="eyebrow">Coming next</span><h3>Group procurement</h3><p>Several buyers combine their cement or rod orders to reach a bulk price, each with their own payment protection, delivery address and invoice.</p></div>
        <div class="glass pad"><span class="eyebrow">Coming next</span><h3>Real estate</h3><p>Land and property from verified agents and developers, with clear labels on what has and has not been checked.</p><a class="link" href="#/property">What to expect</a></div>
      </section>
      <section class="cta glass"><div><h2>Sell on SiteMart</h2><p>Suppliers, equipment owners and rental companies reach buyers across Ghana. Join free, get verified, and get paid safely through escrow.</p></div>
        <a class="btn light" href="#/join">Create a business account</a></section>`;
    $("#find").addEventListener("submit", (e) => { e.preventDefault(); const q = new FormData(e.target).get("q").trim(); if (q) go("search", { q }); });
    try {
      const h = await home$();
      $("#mcats").innerHTML = catTiles(h.categories || [], "material");
      $("#ecats").innerHTML = catTiles(h.categories || [], "equipment");
      $("#latest").innerHTML = (h.latest || []).length ? h.latest.map(card).join("") : empty("Listings are on their way", "Suppliers are adding their materials and machines.", '<a class="btn ghost sm" href="#/join">List your items</a>');
      $("#sups").innerHTML = (h.suppliers || []).length ? h.suppliers.map(supplierChip).join("") : '<p class="muted">The first verified suppliers will appear here.</p>';
    } catch (e) {
      console.error(e);
      ["#mcats", "#ecats"].forEach((s) => { $(s).innerHTML = ""; });
      $("#latest").innerHTML = failed("the listings");
    }
  }

  /* ---------- marketplaces ---------- */
  async function pageMarket(kind, q) {
    const isEq = kind === "equipment", cat = q.get("cat") || "", term = q.get("q") || "", region = q.get("region") || "", sort = q.get("sort") || "best", deal = isEq ? q.get("deal") || "" : "";
    const path = isEq ? "equipment" : "market", state = { cat, q: term, region, sort: sort === "best" ? "" : sort, deal };
    view().innerHTML = `<section class="page-head"><span class="eyebrow">${isEq ? "Equipment" : "Materials"}</span>
        <h1>${isEq ? "Rent or buy equipment" : "Building materials"}</h1>
        <form class="find compact" id="find" role="search">
          <label class="field">${ICON.search}<input name="q" type="search" value="${esc(term)}" placeholder="${isEq ? "Excavator, CAT 320, generator…" : "Cement, 6-inch blocks, 12mm rods…"}" aria-label="Search ${isEq ? "equipment" : "materials"}" /></label>
          <select name="region" aria-label="Region"><option value="">All of Ghana</option>${REGIONS.map((r) => `<option ${r === region ? "selected" : ""}>${r}</option>`).join("")}</select>
          <select name="sort" aria-label="Sort"><option value="best">Best match</option><option value="price_low" ${sort === "price_low" ? "selected" : ""}>Lowest price</option><option value="price_high" ${sort === "price_high" ? "selected" : ""}>Highest price</option><option value="newest" ${sort === "newest" ? "selected" : ""}>Newest</option></select>
          <button class="btn light" type="submit">Search</button>
        </form>
        ${isEq ? `<div class="seg" role="group" aria-label="Rent or buy">${[["", "All"], ["rent", "For rent"], ["sale", "For sale"]].map(([v, l]) => `<button type="button" data-deal="${v}" aria-pressed="${v === deal}" class="${v === deal ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
        <div class="chips" id="chips"></div></section>
      <section class="results"><p class="count" id="count" aria-live="polite"></p><div class="grid" id="grid">${skel(8)}</div><div class="more" id="more"></div></section>`;
    $("#find").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); go(path, { ...state, q: f.get("q").trim(), region: f.get("region"), sort: f.get("sort") === "best" ? "" : f.get("sort") }); });
    $$("[data-deal]").forEach((b) => b.addEventListener("click", () => go(path, { ...state, deal: b.dataset.deal })));
    home$().then((h) => {
      const cats = (h.categories || []).filter((c) => c.kind === (isEq ? "equipment" : "material"));
      $("#chips").innerHTML = `<button type="button" class="${cat ? "" : "on"}" data-c="">All</button>${cats.map((c) => `<button type="button" class="${c.slug === cat ? "on" : ""}" data-c="${esc(c.slug)}">${esc(c.name)}</button>`).join("")}`;
      $$("#chips [data-c]").forEach((b) => b.addEventListener("click", () => go(path, { ...state, cat: b.dataset.c })));
    }).catch(console.error);
    let offset = 0;
    const load = async (append) => {
      try {
        const r = await rpc("sitemart_search", { p: { kind: isEq ? "equipment" : "material", q: term, category: cat, region, sort, deal, limit: 24, offset } });
        const items = r.items || [];
        $("#count").textContent = r.total ? `${num(r.total)} ${r.total === 1 ? "listing" : "listings"}${region ? ` in ${region}` : ""}` : "";
        const html = items.map(card).join("");
        if (append) $("#grid").insertAdjacentHTML("beforeend", html);
        else $("#grid").innerHTML = html || empty(term || cat || region || deal ? "Nothing matches that yet" : "Listings are on their way",
          term || cat || region || deal ? "Try another word, a nearby region or another category." : "Suppliers are adding their items. Check back soon.",
          '<a class="btn ghost sm" href="#/join">Are you a supplier? List your items</a>');
        offset += items.length;
        $("#more").innerHTML = offset < r.total ? '<button class="btn ghost" type="button" id="loadmore">Show more</button>' : "";
        const lm = $("#loadmore"); if (lm) lm.addEventListener("click", () => busy(lm, () => load(true)));
      } catch (e) {
        console.error(e);
        if (!append) { $("#grid").innerHTML = failed("the listings"); $("[data-retry]").addEventListener("click", () => load(false)); } else toast(say(e));
      }
    };
    load(false);
  }

  /* ---------- global search ---------- */
  async function pageSearch(q) {
    const term = (q.get("q") || "").trim();
    view().innerHTML = `<section class="page-head"><span class="eyebrow">Search</span><h1>${term ? `Results for “${esc(term)}”` : "Search SiteMart"}</h1>
      <form class="find compact" id="find" role="search"><label class="field">${ICON.search}<input name="q" type="search" value="${esc(term)}" placeholder="Products, machines, suppliers…" aria-label="Search SiteMart" /></label><button class="btn light" type="submit">Search</button></form></section>
      <section class="results"><div id="supres"></div><h2 class="sub-h" id="mh" hidden>Materials</h2><div class="grid" id="mres">${term ? skel(4) : ""}</div><h2 class="sub-h" id="eh" hidden>Equipment</h2><div class="grid" id="eres"></div></section>`;
    $("#find").addEventListener("submit", (e) => { e.preventDefault(); go("search", { q: new FormData(e.target).get("q").trim() }); });
    if (!term) { $("#mres").innerHTML = ""; return; }
    try {
      const [m, eq] = await Promise.all([rpc("sitemart_search", { p: { kind: "material", q: term, limit: 12 } }), rpc("sitemart_search", { p: { kind: "equipment", q: term, limit: 12 } })]);
      const sups = m.suppliers || [];
      $("#supres").innerHTML = sups.length ? `<h2 class="sub-h">Suppliers</h2><div class="sups">${sups.map(supplierChip).join("")}</div>` : "";
      $("#mh").hidden = !(m.items || []).length; $("#eh").hidden = !(eq.items || []).length;
      $("#mres").innerHTML = (m.items || []).map(card).join("") + (m.total > 12 ? `<a class="btn ghost sm span" href="#/market?q=${encodeURIComponent(term)}">All ${num(m.total)} materials</a>` : "");
      $("#eres").innerHTML = (eq.items || []).map(card).join("") + (eq.total > 12 ? `<a class="btn ghost sm span" href="#/equipment?q=${encodeURIComponent(term)}">All ${num(eq.total)} machines</a>` : "");
      if (!sups.length && !(m.items || []).length && !(eq.items || []).length) $("#mres").innerHTML = empty("Nothing matches that yet", "Try a shorter word, like “cement” or “excavator”.");
    } catch (e) { console.error(e); $("#mres").innerHTML = failed("the results"); $("[data-retry]").addEventListener("click", () => pageSearch(q)); }
  }

  /* ---------- one listing ---------- */
  function savedHas(kind, id) { return ((S.me && S.me.saved) || []).some((x) => x.kind === kind && x.id === id); }
  async function toggleSave(btn, kind, id) {
    await S.ready;
    if (!S.user) { toast("Sign in to save items."); go("signin", { next: location.hash.slice(2) }); return; }
    await busy(btn, async () => {
      try {
        const on = await rpc("sm_toggle_saved", { p_kind: kind, p_id: id });
        if (S.me) S.me.saved = on ? [...(S.me.saved || []), { kind, id }] : (S.me.saved || []).filter((x) => !(x.kind === kind && x.id === id));
        toast(on ? "Saved. Find it in your dashboard." : "Removed from saved.", true);
        setTimeout(() => { btn.setAttribute("aria-pressed", String(on)); btn.lastChild.textContent = on ? " Saved" : " Save"; });
      } catch (e) { toast(say(e)); }
    });
  }
  function trustBlock(t) {
    const [label, why] = TRUST[t] || TRUST.unverified;
    return `<div class="trust ${t === "verified_business" ? "ok" : t === "unverified" ? "warn" : ""}"><span>${t === "verified_business" ? ICON.shield : ""}<b>${label}</b></span><small>${why}</small></div>`;
  }
  async function pageItem(kind, id) {
    view().innerHTML = '<div class="item"><div class="gal skel"></div></div>';
    let i;
    try { i = await rpc("sitemart_listing", { p_kind: kind, p_id: id }); } catch (e) { console.error(e); view().innerHTML = failed("this listing"); $("[data-retry]").addEventListener("click", () => pageItem(kind, id)); return; }
    if (!i) { view().innerHTML = empty("This listing isn't available", "It may have been sold or taken down.", '<a class="btn ghost sm" href="#/market">Back to the marketplace</a>'); return; }
    document.title = `${i.name} · SiteMart`;
    await S.ready;
    const eq = i.kind === "equipment", imgs = i.images || [], s = i.supplier || {};
    const prices = eq ? [has(i.hourly_rate) && ["Per hour", money(i.hourly_rate)], has(i.daily_rate) && ["Per day", money(i.daily_rate)], has(i.weekly_rate) && ["Per week", money(i.weekly_rate)], has(i.sale_price) && ["To buy", money(i.sale_price)]].filter(Boolean)
      : [has(i.price) && [`Per ${unit(i.unit) || "unit"}`, money(i.price)]].filter(Boolean);
    const facts = eq ? [["Maker", i.manufacturer], ["Model", i.model], ["Year", i.year], ["Hour meter", i.hours != null && `${num(i.hours)} hours`], ["Condition", i.condition && i.condition[0].toUpperCase() + i.condition.slice(1)],
        ["Operator", OPERATOR[i.operator]], ["Security deposit", has(i.deposit) && money(i.deposit)]]
      : [["Unit", unit(i.unit)], ["Minimum order", i.min_order && `${num(i.min_order)} ${unit(i.unit, i.min_order)}`], ["In stock", i.quantity != null && (Number(i.quantity) > 0 ? `${num(i.quantity)} ${unit(i.unit, i.quantity)}` : "Out of stock")],
        ["Delivery time", i.delivery_days && (i.delivery_days.min != null && i.delivery_days.max != null && i.delivery_days.min !== i.delivery_days.max ? `${i.delivery_days.min} to ${i.delivery_days.max} days` : `${i.delivery_days.max ?? i.delivery_days.min} ${Number(i.delivery_days.max ?? i.delivery_days.min) === 1 ? "day" : "days"}`)]];
    const rows = facts.filter(([, v]) => v != null && v !== "" && v !== false);
    const specs = Object.entries(i.specs || {}).filter(([k, v]) => k && v != null && v !== "");
    const saved = savedHas(i.kind, i.id);
    view().innerHTML = `<div class="item">
      <a class="back" href="#/${eq ? "equipment" : "market"}">${ICON.back} ${eq ? "All equipment" : "All materials"}</a>
      <div class="gal">${imgs.length ? `<div class="main" style="background-image:url('${window.SM.url(imgs[0])}')" role="img" aria-label="${esc(i.name)}"></div>${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, k) => `<button type="button" class="${k ? "" : "on"}" data-src="${window.SM.url(u)}" style="background-image:url('${window.SM.url(u)}')" aria-label="Photo ${k + 1}"></button>`).join("")}</div>` : ""}` : `<div class="main none">${catIcon(i.category_slug, i.kind)}</div>`}</div>
      <div class="info">
        <span class="eyebrow">${esc(i.category || (eq ? "Equipment" : "Building materials"))}</span>
        <h1>${esc(i.name)}</h1>
        <div class="prices">${prices.length ? prices.map(([l, p]) => `<div><small>${l}</small><b>${p}</b></div>`).join("") : "<div><small>Price</small><b>Ask the supplier</b></div>"}</div>
        ${(i.bulk || []).length ? `<div class="bulk"><b>Bulk prices</b><table><thead><tr><th scope="col">From</th><th scope="col">Price per ${esc(unit(i.unit) || "unit")}</th></tr></thead><tbody>${i.bulk.map((t) => `<tr><td>${num(t.min_qty)} ${esc(unit(i.unit, t.min_qty))}</td><td>${money(t.unit_price)}</td></tr>`).join("")}</tbody></table></div>` : ""}
        ${rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${typeof v === "string" && v.startsWith("GH&#8373;") ? v : esc(v)}</dd></div>`).join("")}</dl>` : ""}
        ${(i.delivery || []).length ? `<div class="deliv"><b>Delivery</b><ul>${i.delivery.map((d) => `<li>${ICON.check}${esc(DELIVERY[d] || d)}</li>`).join("")}</ul></div>` : ""}
        <div class="actions">
          ${s.accepting === false ? '<p class="note">This supplier is not taking orders right now.</p>' : `<a class="btn light wide" href="${C.BAIDX}/auth.html">${eq && prices.some(([l]) => l.startsWith("Per")) ? "Rent or order on BAID X" : "Order on BAID X"}</a>`}
          <button class="btn ghost" type="button" id="save" aria-pressed="${saved}">${ICON.heart}<span> ${saved ? "Saved" : "Save"}</span></button>
        </div>
        <p class="note">Orders are paid into BAID X escrow and the supplier is paid after you confirm delivery. Ordering, quotes and rental requests move into SiteMart in the next phase.</p>
        <div class="supplier-box">${supplierChip(s)}${trustBlock(s.trust)}${s.about ? `<p class="muted small">${esc(s.about)}</p>` : ""}</div>
        ${specs.length ? `<div class="specs"><b>Specifications</b><dl>${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>` : ""}
        ${i.description ? `<div class="desc"><b>About this ${eq ? "machine" : "product"}</b><p>${esc(i.description)}</p></div>` : ""}
      </div></div>`;
    $$(".thumbs [data-src]").forEach((b) => b.addEventListener("click", () => {
      $(".gal .main").style.backgroundImage = `url('${b.dataset.src}')`;
      $$(".thumbs button").forEach((x) => x.classList.toggle("on", x === b));
    }));
    $("#save").addEventListener("click", (e) => toggleSave(e.currentTarget, i.kind, i.id));
    scrollTo(0, 0);
  }

  /* ---------- supplier ---------- */
  async function pageSupplier(id) {
    view().innerHTML = `<section class="page-head"><div class="card skel" style="min-height:120px"></div></section>`;
    let s;
    try { s = await rpc("sitemart_supplier", { p_id: id }); } catch (e) { console.error(e); view().innerHTML = failed("this supplier"); $("[data-retry]").addEventListener("click", () => pageSupplier(id)); return; }
    if (!s) { view().innerHTML = empty("This supplier isn't on SiteMart", "The business may have closed its account.", '<a class="btn ghost sm" href="#/market">Back to the marketplace</a>'); return; }
    document.title = `${s.name} · SiteMart`;
    await S.ready;
    const following = savedHas("supplier", s.id), list = s.listings || [];
    view().innerHTML = `<section class="page-head sup-head">
        <span class="logo xl" ${s.logo ? `style="background-image:url('${window.SM.url(s.logo)}')"` : ""}>${s.logo ? "" : esc((s.name || "S")[0])}</span>
        <div><span class="eyebrow">Supplier</span><h1>${esc(s.name)}</h1><p class="muted">${esc([s.town, s.region].filter(Boolean).join(", ") || "Ghana")}</p></div>
        <button class="btn ghost sm" type="button" id="follow" aria-pressed="${following}">${ICON.heart}<span> ${following ? "Following" : "Follow"}</span></button></section>
      <section class="sup-facts">${trustBlock(s.trust)}<div class="stat"><b>${num(s.completed_orders || 0)}</b><small>orders completed through BAID X escrow</small></div><div class="stat"><b>${num(list.length)}</b><small>items listed</small></div></section>
      ${s.about ? `<p class="about">${esc(s.about)}</p>` : ""}
      <section class="results"><div class="grid">${list.length ? list.map(card).join("") : empty("No items listed right now", "Follow this supplier to hear when they add something.")}</div></section>`;
    $("#follow").addEventListener("click", async (e) => {
      const b = e.currentTarget; await toggleSave(b, "supplier", s.id);
      setTimeout(() => { b.lastChild.textContent = b.getAttribute("aria-pressed") === "true" ? " Following" : " Follow"; }, 50);
    });
  }

  /* ---------- real estate and logistics (later phases, said plainly) ---------- */
  function pageProperty() {
    view().innerHTML = `<section class="page-head"><span class="eyebrow">Real estate</span><h1>Land and property</h1>
      <p class="sub">Real estate opens in a later phase of SiteMart. There are no listings yet, and we won't show made-up ones.</p></section>
      <section class="band split">
        <div class="glass pad"><h3>What you'll find</h3><ul class="list"><li>Land for sale</li><li>Houses and apartments</li><li>Offices, shops and industrial property</li><li>Rentals and development opportunities</li></ul></div>
        <div class="glass pad"><h3>What the labels will mean</h3><p><b>Agent verified</b> means BAID X checked the identity or business of the person listing. It does not mean BAID X checked the land title.</p><p>Ownership documents will show what was provided and who reviewed it. Always do a land search at the Lands Commission before you pay.</p></div>
      </section>
      <section class="cta glass"><div><h2>Are you an agent or developer?</h2><p>Create your SiteMart account now and get verified, so you're ready when Real Estate opens.</p></div><a class="btn light" href="#/join">Create an account</a></section>`;
  }
  function pageLogistics() {
    view().innerHTML = `<section class="page-head"><span class="eyebrow">Logistics</span><h1>Delivery and tracking</h1>
      <p class="sub">Tracking pages for SiteMart orders open in a later phase. For now, BAID X orders show their status in your BAID X account.</p></section>
      ${trackingExample()}
      <section class="band split">
        <div class="glass pad"><h3>How we'll know where it is</h3><p>Positions come only from GPS devices or driver apps that the transport company has connected, or from checkpoints that an authorised logistics operator confirms. Anything else is shown as an estimate.</p></div>
        <div class="glass pad"><h3>Transport companies</h3><p>Carry materials and machines for SiteMart buyers. Create a logistics account and get verified to be ready for launch.</p><a class="btn ghost sm" href="#/join">Create a logistics account</a></div>
      </section>`;
  }

  /* ---------- sign in, join, reset ---------- */
  function authShell(title, sub, body) {
    view().innerHTML = `<section class="auth glass"><span class="eyebrow">SiteMart</span><h1>${title}</h1><p class="muted">${sub}</p>${body}
      <p class="fine">SiteMart uses your BAID X account. One account works on both.</p></section>`;
  }
  const errBox = () => '<p class="err" id="err" role="alert" hidden></p>';
  const showErr = (m) => { const e = $("#err"); e.textContent = m; e.hidden = !m; };
  function pageSignin(q) {
    const next = q.get("next") || "dashboard";
    authShell("Sign in", "Welcome back.", `<form id="f" novalidate>
      <label>Email<input name="email" type="email" autocomplete="email" required inputmode="email" /></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
      ${errBox()}<button class="btn light wide" type="submit">Sign in</button></form>
      <div class="auth-links"><button class="link" type="button" id="forgot">Forgot password?</button><a class="link" href="#/join">Create an account</a></div>`);
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault(); const f = new FormData(e.target), email = String(f.get("email")).trim(), password = String(f.get("password"));
      if (!/^\S+@\S+\.\S+$/.test(email)) return showErr("Enter your email address.");
      if (!password) return showErr("Enter your password.");
      busy(e.submitter || $("#f button[type=submit]"), async () => {
        showErr("");
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return showErr(say(error));
        await window.SM.loadMe(); location.hash = `#/${next}`;
      });
    });
    $("#forgot").addEventListener("click", (e) => {
      const email = String(new FormData($("#f")).get("email")).trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return showErr("Enter your email above first, then press Forgot password.");
      busy(e.currentTarget, async () => {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/#/reset` });
        if (error) return showErr(say(error));
        showErr(""); toast("If that email has an account, we've sent a link to reset the password.", true);
      });
    });
  }
  function pageJoin() {
    authShell("Create your account", "Free to join. You'll choose your account type next.", `<form id="f" novalidate>
      <label>Email<input name="email" type="email" autocomplete="email" required inputmode="email" /></label>
      <label>Password<input name="password" type="password" autocomplete="new-password" required aria-describedby="pwrule" /></label>
      <small class="muted" id="pwrule">${PW_RULE}</small>
      <label>Confirm password<input name="confirm" type="password" autocomplete="new-password" required /></label>
      <label class="tick"><input type="checkbox" name="terms" required /> I agree to the <a href="${C.BAIDX}/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="${C.BAIDX}/privacy.html" target="_blank" rel="noopener">Privacy policy</a></label>
      ${errBox()}<button class="btn light wide" type="submit">Create account</button></form>
      <div class="auth-links"><span class="muted">Already have a BAID X or SiteMart account?</span><a class="link" href="#/signin">Sign in</a></div>`);
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault(); const f = new FormData(e.target), email = String(f.get("email")).trim(), password = String(f.get("password"));
      if (!/^\S+@\S+\.\S+$/.test(email)) return showErr("Enter your email address.");
      if (!pwOk(password)) return showErr(PW_RULE);
      if (password !== f.get("confirm")) return showErr("The two passwords don't match.");
      if (!f.get("terms")) return showErr("Please agree to the Terms and Privacy policy.");
      busy($("#f button[type=submit]"), async () => {
        showErr("");
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/#/dashboard` } });
        if (error) return showErr(say(error));
        if (data.session) { await window.SM.loadMe(); location.hash = "#/dashboard"; return; }
        authShell("Check your email", `We sent a link to ${esc(email)}. Open it to confirm your email, then sign in here to choose your account type.`, '<a class="btn light wide" href="#/signin">Go to sign in</a>');
      });
    });
  }
  function pageReset() {
    authShell("Choose a new password", PW_RULE, `<form id="f" novalidate>
      <label>New password<input name="password" type="password" autocomplete="new-password" required /></label>
      <label>Confirm password<input name="confirm" type="password" autocomplete="new-password" required /></label>
      ${errBox()}<button class="btn light wide" type="submit">Save password</button></form>`);
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault(); const f = new FormData(e.target), password = String(f.get("password"));
      if (!pwOk(password)) return showErr(PW_RULE);
      if (password !== f.get("confirm")) return showErr("The two passwords don't match.");
      busy($("#f button[type=submit]"), async () => {
        const { data } = await sb.auth.getSession();
        if (!data.session) return showErr("This reset link has expired. Ask for a new one from Sign in.");
        const { error } = await sb.auth.updateUser({ password });
        if (error) return showErr(say(error));
        toast("Password saved.", true); location.hash = "#/dashboard";
      });
    });
  }

  /* ---------- dashboard ---------- */
  function registerForm(h, cur) {
    const countries = (h && h.countries) || [{ code: "GH", name: "Ghana", active: true }];
    const a = cur || {};
    return `<form id="reg" class="glass pad" novalidate>
      <h2>${cur ? "Your SiteMart details" : "Choose your account type"}</h2>
      <fieldset class="types"><legend class="sr">Account type</legend>${ACCOUNT_TYPES.map(([k, n, d]) => `<label class="type"><input type="radio" name="account_type" value="${k}" ${a.account_type === k ? "checked" : ""} required /><span><b>${n}</b><small>${d}</small></span></label>`).join("")}</fieldset>
      <div class="two">
        <label>Full name<input name="display_name" value="${esc(a.display_name || "")}" autocomplete="name" required maxlength="120" /></label>
        <label id="bizl">Registered business name<input name="business_name" value="${esc(a.business_name || "")}" autocomplete="organization" maxlength="160" /></label>
        <label>Phone<input name="phone" type="tel" value="${esc(a.phone || "")}" placeholder="+233 20 000 0000" autocomplete="tel" inputmode="tel" /></label>
        <label>Country<select name="country">${countries.map((c) => `<option value="${esc(c.code)}" ${c.active ? "" : "disabled"} ${(a.country || "GH") === c.code ? "selected" : ""}>${esc(c.name)}${c.active ? "" : " (coming soon)"}</option>`).join("")}</select></label>
        <label id="catl">Business category<input name="business_category" value="${esc(a.business_category || "")}" placeholder="For example: cement and blocks" maxlength="80" /></label>
        <label id="regl">Business registration number<input name="registration_number" value="${esc(a.registration_number || "")}" placeholder="Registrar-General number, if registered" maxlength="60" /></label>
      </div>
      ${errBox()}<button class="btn light" type="submit">${cur ? "Save changes" : "Continue"}</button></form>`;
  }
  function wireRegister(after) {
    const f = $("#reg");
    const sync = () => { const t = (new FormData(f).get("account_type")) || ""; ["#bizl", "#catl", "#regl"].forEach((s) => { $(s).hidden = t === "buyer"; }); };
    f.addEventListener("change", sync); sync();
    f.addEventListener("submit", (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(f));
      if (!d.account_type) return showErr("Choose the account type that fits you best.");
      if ((d.display_name || "").trim().length < 2) return showErr("Add your full name.");
      if (d.account_type !== "buyer" && (d.business_name || "").trim().length < 2) return showErr("Add your registered business name.");
      if (d.phone && !/^\+[0-9 ]{8,20}$/.test(d.phone.trim())) return showErr("Add your phone number with the country code, like +233 20 000 0000.");
      if (d.account_type === "buyer") { d.business_name = ""; d.business_category = ""; d.registration_number = ""; }
      busy($("#reg button[type=submit]"), async () => {
        try { showErr(""); S.me = await rpc("sm_register", { p: d }); toast("Saved.", true); after(); } catch (err) { showErr(say(err)); }
      });
    });
  }
  function verificationCard(me) {
    const hist = me.verification || [], pending = hist.some((v) => v.status === "pending");
    const isBiz = me.account && me.account.account_type !== "buyer";
    return `<div class="glass pad" id="ver"><h2>Verification</h2>${trustBlock(me.trust)}
      ${hist.length ? `<ul class="hist">${hist.map((v) => `<li><b>${v.kind === "business" ? "Business documents" : "Identity documents"}</b><span class="st ${esc(v.status)}">${v.status === "pending" ? "In review" : v.status === "approved" ? "Approved" : "Not approved"}</span>${v.note ? `<small>${esc(v.note)}</small>` : ""}</li>`).join("")}</ul>` : ""}
      ${me.trust === "verified_business" ? "" : `<form id="vf" novalidate>
        <p class="muted small">Send clear photos or PDFs. A person at BAID X reviews them; only you and BAID X staff can see them.</p>
        <label>What are you sending?<select name="kind">${isBiz ? '<option value="business">Business documents (registration certificate, TIN, permits)</option>' : ""}<option value="identity">Identity documents (Ghana Card or passport)</option></select></label>
        <label>Documents (up to 6, 10 MB each)<input name="files" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple required /></label>
        <label>Note for the reviewer (optional)<input name="note" maxlength="500" /></label>
        ${'<p class="err" id="verr" role="alert" hidden></p>'}<button class="btn ghost" type="submit" ${pending ? "disabled" : ""}>${pending ? "Documents in review" : "Send for review"}</button></form>`}</div>`;
  }
  function wireVerification() {
    const f = $("#vf"); if (!f) return;
    const err = (m) => { const e = $("#verr"); e.textContent = m; e.hidden = !m; };
    f.addEventListener("submit", (e) => {
      e.preventDefault(); const files = [...f.files.files], kind = f.kind.value, note = f.note.value;
      if (!files.length) return err("Choose at least one document.");
      if (files.length > 6) return err("Send up to 6 documents.");
      if (files.some((x) => x.size > 10 * 1024 * 1024)) return err("Each document must be 10 MB or smaller.");
      if (files.some((x) => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(x.type))) return err("Use JPG, PNG, WebP or PDF files.");
      busy(f.querySelector("button[type=submit]"), async () => {
        err("");
        try {
          const paths = [];
          for (const x of files) {
            const path = `${S.user.id}/${Date.now()}-${x.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
            const { error } = await sb.storage.from("sm-verification").upload(path, x, { contentType: x.type, upsert: false });
            if (error) throw error;
            paths.push(path);
          }
          await rpc("sm_submit_verification", { p_kind: kind, p_documents: paths, p_note: note || null });
          toast("Sent. BAID X will review your documents.", true); await window.SM.loadMe(); pageDashboard();
        } catch (x) { err(say(x)); }
      });
    });
  }
  function listingRow(l) {
    const eq = l.kind === "equipment", filled = eq ? l.category_slug && (l.manufacturer || l.model || l.year) : l.category_slug && l.unit;
    return `<li><div><b>${esc(l.name)}</b><small>${eq ? "Equipment" : "Material"} · ${l.available ? "Live" : "Hidden"} · ${filled ? "SiteMart details added" : "Add SiteMart details so buyers can find it"}</small></div>
      <div class="row-actions">${l.available ? `<a class="btn ghost sm" href="#/item/${l.kind}/${esc(l.id)}">View</a>` : ""}<button class="btn ${filled ? "ghost" : "light"} sm" type="button" data-edit="${esc(l.kind)}:${esc(l.id)}">${filled ? "Edit details" : "Add details"}</button></div></li>`;
  }
  function detailsForm(l, cats) {
    const eq = l.kind === "equipment", my = cats.filter((c) => c.kind === l.kind), cat = my.find((c) => c.slug === l.category_slug);
    const units = cat && cat.units.length ? cat.units : Object.keys(UNITS);
    const specs = Object.entries(l.specs || {}), bulk = l.bulk || [];
    const dl = l.delivery || [];
    const specRows = [...specs, ...Array(Math.max(0, 3 - specs.length)).fill(["", ""])].slice(0, 10);
    return `<form id="df" class="glass pad details" novalidate><div class="row"><h2>${esc(l.name)}</h2><button class="btn ghost sm" type="button" id="dclose">Close</button></div>
      <p class="muted small">Price${eq ? "s and photos" : ", stock and photos"} are edited in your BAID X catalogue. Here you add what SiteMart buyers filter and compare by.</p>
      <div class="two">
        <label>Category<select name="category" required><option value="">Choose…</option>${my.map((c) => `<option value="${esc(c.slug)}" ${c.slug === l.category_slug ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        ${eq ? `
        <label>Manufacturer<input name="manufacturer" value="${esc(l.manufacturer || "")}" maxlength="80" placeholder="Caterpillar, Komatsu…" /></label>
        <label>Model<input name="model" value="${esc(l.model || "")}" maxlength="80" /></label>
        <label>Year<input name="year" type="number" inputmode="numeric" min="1950" max="2100" value="${esc(l.year || "")}" /></label>
        <label>Hour meter reading<input name="hours" type="number" inputmode="numeric" min="0" value="${esc(l.hours ?? "")}" /></label>
        <label>Rent per hour (GH&#8373;)<input name="hourly_rate" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(l.hourly_rate || "")}" /></label>
        <label>Rent per week (GH&#8373;)<input name="weekly_rate" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(l.weekly_rate || "")}" /></label>
        <label>Security deposit (GH&#8373;)<input name="deposit" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(l.deposit ?? "")}" /></label>
        <label>Operator<select name="operator"><option value="">Not stated</option>${Object.entries(OPERATOR).map(([k, v]) => `<option value="${k}" ${l.operator === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>` : `
        <label>Sold per<select name="unit" required><option value="">Choose…</option>${units.map((u) => `<option value="${u}" ${l.unit === u ? "selected" : ""}>${esc(unit(u))}</option>`).join("")}</select></label>
        <label>Minimum order<input name="min_order" type="number" inputmode="decimal" min="0" step="any" value="${esc(l.min_order || "")}" /></label>
        <label>Delivery in (days, from)<input name="delivery_days_min" type="number" inputmode="numeric" min="0" max="120" value="${esc(l.delivery_days_min ?? "")}" /></label>
        <label>Delivery in (days, up to)<input name="delivery_days_max" type="number" inputmode="numeric" min="0" max="120" value="${esc(l.delivery_days_max ?? "")}" /></label>`}
      </div>
      <fieldset><legend>Delivery options</legend>${Object.entries(DELIVERY).map(([k, v]) => `<label class="tick"><input type="checkbox" name="delivery" value="${k}" ${dl.includes(k) ? "checked" : ""} /> ${v}</label>`).join("")}</fieldset>
      ${eq ? "" : `<fieldset><legend>Bulk prices (optional, up to 5)</legend><div id="tiers">${[...bulk, ...Array(Math.max(0, 2 - bulk.length)).fill({})].slice(0, 5).map((t) => `<div class="pair"><input name="tq" type="number" inputmode="decimal" min="0" step="any" placeholder="From quantity" value="${esc(t.min_qty || "")}" aria-label="From quantity" /><input name="tp" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Price per unit (GH₵)" value="${esc(t.unit_price || "")}" aria-label="Price per unit" /></div>`).join("")}</div></fieldset>`}
      <fieldset><legend>Specifications (optional)</legend><div id="specs">${specRows.map(([k, v]) => `<div class="pair"><input name="sk" maxlength="40" placeholder="${eq ? "Bucket capacity" : "Grade"}" value="${esc(k)}" aria-label="Specification name" /><input name="sv" maxlength="120" placeholder="${eq ? "1.2 m³" : "42.5R"}" value="${esc(v)}" aria-label="Specification value" /></div>`).join("")}</div></fieldset>
      <p class="err" id="derr" role="alert" hidden></p><button class="btn light" type="submit">Save details</button></form>`;
  }
  function wireDetails(l, cats) {
    const f = $("#df"), err = (m) => { const e = $("#derr"); e.textContent = m; e.hidden = !m; };
    $("#dclose").addEventListener("click", () => { f.remove(); });
    f.addEventListener("submit", (e) => {
      e.preventDefault(); const fd = new FormData(f), eq = l.kind === "equipment";
      const p = { category: fd.get("category"), delivery: fd.getAll("delivery") };
      if (!p.category) return err("Choose a category.");
      const specs = {}; const ks = fd.getAll("sk"), vs = fd.getAll("sv");
      ks.forEach((k, n) => { k = String(k).trim(); const v = String(vs[n] || "").trim(); if (k && v) specs[k] = v; });
      p.specs = Object.keys(specs).length ? specs : null;
      if (eq) {
        ["manufacturer", "model", "year", "hours", "hourly_rate", "weekly_rate", "deposit", "operator"].forEach((k) => { p[k] = String(fd.get(k) || "").trim(); });
        if (p.year && (p.year < 1950 || p.year > 2100)) return err("Enter the year it was made, like 2016.");
        if (["hourly_rate", "weekly_rate"].some((k) => p[k] && Number(p[k]) <= 0)) return err("Rental prices must be more than zero.");
      } else {
        ["unit", "min_order", "delivery_days_min", "delivery_days_max"].forEach((k) => { p[k] = String(fd.get(k) || "").trim(); });
        if (!p.unit) return err("Choose what it is sold per.");
        if (p.delivery_days_min && p.delivery_days_max && Number(p.delivery_days_min) > Number(p.delivery_days_max)) return err("The shortest delivery time can't be longer than the longest.");
        const tq = fd.getAll("tq"), tp = fd.getAll("tp"), tiers = [];
        for (let n = 0; n < tq.length; n++) {
          if (!tq[n] && !tp[n]) continue;
          if (!(Number(tq[n]) > 0) || !(Number(tp[n]) > 0)) return err("Each bulk price needs a quantity and a price above zero.");
          tiers.push({ min_qty: Number(tq[n]), unit_price: Number(tp[n]) });
        }
        p.bulk = tiers.length ? tiers.sort((a, b) => a.min_qty - b.min_qty) : null;
      }
      busy(f.querySelector("button[type=submit]"), async () => {
        try { err(""); await rpc("sm_listing_details", { p_kind: l.kind, p_id: l.id, p }); HOME = null; toast("Details saved.", true); await window.SM.loadMe(); pageDashboard(); }
        catch (x) { err(say(x)); }
      });
    });
    f.addEventListener("change", (e) => {
      if (e.target.name !== "category" || l.kind !== "material") return;
      const c = cats.find((x) => x.slug === e.target.value), sel = f.querySelector("[name=unit]"), cur = sel.value;
      const units = c && c.units.length ? c.units : Object.keys(UNITS);
      sel.innerHTML = `<option value="">Choose…</option>${units.map((u) => `<option value="${u}" ${u === cur ? "selected" : ""}>${esc(unit(u))}</option>`).join("")}`;
    });
    f.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  async function pageDashboard() {
    await S.ready;
    if (!S.user) { authShell("Your dashboard", "Sign in to see your SiteMart account, saved items and listings.", '<a class="btn light wide" href="#/signin?next=dashboard">Sign in</a><div class="auth-links"><span class="muted">New here?</span><a class="link" href="#/join">Create an account</a></div>'); return; }
    view().innerHTML = `<section class="page-head"><div class="card skel" style="min-height:140px"></div></section>`;
    if (!S.me) { try { S.me = await rpc("sm_me"); } catch (e) { console.error(e); view().innerHTML = failed("your dashboard"); $("[data-retry]").addEventListener("click", pageDashboard); return; } }
    let h = null; try { h = await home$(); } catch (e) { console.error(e); }
    const me = S.me || {}, a = me.account;
    if (!a) {
      view().innerHTML = `<section class="page-head"><span class="eyebrow">Welcome</span><h1>Set up your SiteMart account</h1><p class="sub">Signed in as ${esc(S.user.email || "")}. Tell us how you'll use SiteMart.</p></section><section class="dash">${registerForm(h)}</section>`;
      wireRegister(pageDashboard); return;
    }
    const seller = SELLER.includes(a.account_type), list = me.listings || [], saved = me.saved || [];
    view().innerHTML = `<section class="page-head row"><div><span class="eyebrow">${esc(TYPE_NAME[a.account_type] || "Member")}</span><h1>${esc(a.business_name || a.display_name)}</h1>
        <p class="muted">${esc(a.display_name)}${a.phone ? ` · ${esc(a.phone)}` : ""}</p></div><button class="btn ghost sm" type="button" id="signout">Sign out</button></section>
      <section class="dash">
        ${seller ? `<div class="glass pad"><div class="row"><h2>Your listings</h2>${me.business ? `<a class="btn ghost sm" href="${C.BAIDX}/auth.html">Add items on BAID X</a>` : ""}</div>
          ${!me.business ? `<p>Your listings live in your BAID X supplier catalogue, so the same items sell on both. Set up your business on BAID X first, then come back to add SiteMart details.</p><a class="btn light" href="${C.BAIDX}/auth.html?mode=signup&amp;group=pro">Set up my business on BAID X</a>`
            : list.length ? `<ul class="listings">${list.map(listingRow).join("")}</ul>` : `<p class="muted">You have no items yet. Add materials or equipment in your BAID X catalogue, then add SiteMart details here.</p>`}</div><div id="dslot"></div>` : ""}
        ${verificationCard(me)}
        <div class="glass pad"><h2>Saved</h2><div class="grid" id="saved">${saved.filter((x) => x.kind !== "supplier").length ? skel(2) : '<p class="muted">Items you save show here.</p>'}</div>
          <div class="sups" id="followed"></div></div>
        <div class="glass pad"><h2>Orders and payments</h2><p class="muted">Orders, your wallet and escrow are in your BAID X account for now. They move into SiteMart in the next phase.</p><a class="btn ghost sm" href="${C.BAIDX}/auth.html">Open BAID X</a></div>
        <details class="glass pad"><summary><b>Edit your SiteMart details</b></summary>${registerForm(h, a)}</details>
      </section>`;
    $("#signout").addEventListener("click", (e) => busy(e.currentTarget, async () => { await sb.auth.signOut(); await window.SM.loadMe(); location.hash = "#/"; }));
    wireRegister(pageDashboard); wireVerification();
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const [kind, id] = b.dataset.edit.split(":"), l = list.find((x) => x.kind === kind && x.id === id);
      if (!h) return toast("We couldn't load the categories. Check your connection and try again.");
      $("#dslot").innerHTML = detailsForm(l, h.categories || []); wireDetails(l, h.categories || []);
    }));
    const items = saved.filter((x) => x.kind !== "supplier").slice(0, 12), sups = saved.filter((x) => x.kind === "supplier").slice(0, 12);
    if (items.length) {
      const got = await Promise.all(items.map((x) => rpc("sitemart_listing", { p_kind: x.kind, p_id: x.id }).catch(() => null)));
      const live = got.filter(Boolean); $("#saved").innerHTML = live.length ? live.map(card).join("") : '<p class="muted">The items you saved are no longer listed.</p>';
    }
    if (sups.length) {
      const got = (await Promise.all(sups.map((x) => rpc("sitemart_supplier", { p_id: x.id }).catch(() => null)))).filter(Boolean);
      $("#followed").innerHTML = got.length ? `<h3>Suppliers you follow</h3>${got.map(supplierChip).join("")}` : "";
    }
  }

  /* ---------- router ---------- */
  const TITLES = { "": "Building materials and equipment in Ghana", market: "Building materials", equipment: "Equipment for rent and sale", property: "Real estate", logistics: "Logistics", search: "Search", signin: "Sign in", join: "Create an account", reset: "New password", dashboard: "Dashboard" };
  function render() {
    const r = route(), p = r.parts[0] || "";
    document.title = `SiteMart · ${TITLES[p] || "SiteMart"}`;
    const nav = p === "item" ? (r.parts[1] === "equipment" ? "equipment" : "market") : p === "supplier" ? "market" : ["signin", "join", "reset"].includes(p) ? "dashboard" : p;
    $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav)); $$("[data-nav]").forEach((a) => (a.dataset.nav === nav ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    window.scrollTo(0, 0);
    if (p === "market") return pageMarket("material", r.q);
    if (p === "equipment") return pageMarket("equipment", r.q);
    if (p === "search") return pageSearch(r.q);
    if (p === "item" && ["material", "equipment"].includes(r.parts[1]) && r.parts[2]) return pageItem(r.parts[1], r.parts[2]);
    if (p === "supplier" && r.parts[1]) return pageSupplier(r.parts[1]);
    if (p === "property") return pageProperty();
    if (p === "logistics") return pageLogistics();
    if (p === "signin") return pageSignin(r.q);
    if (p === "join") return pageJoin();
    if (p === "reset") return pageReset();
    if (p === "dashboard") return pageDashboard();
    return pageHome();
  }
  function syncAccount() {
    const b = $("#acct"); if (!b) return;
    b.textContent = S.user ? "Dashboard" : "Sign in"; b.href = S.user ? "#/dashboard" : "#/signin";
  }
  document.addEventListener("sm:session", syncAccount);
  sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") location.hash = "#/reset"; });
  $("#topsearch").addEventListener("submit", (e) => { e.preventDefault(); const q = new FormData(e.target).get("q").trim(); if (q) go("search", { q }); });
  addEventListener("hashchange", render);
  render();
})();
