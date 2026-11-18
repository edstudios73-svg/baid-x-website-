/* SiteMart by BAID X: the public storefront for equipment and building materials.
   It reads the listings suppliers keep on BAID X through two public database functions
   (sitemart_catalog, sitemart_item; supabase/phase25_sitemart.sql). Ordering and paying happen
   on BAID X, where the buyer's money is held in escrow until delivery is confirmed.
   Pages: #/ (search, with ?kind=&q=&region=&cat=) and #/item/<equipment|materials>/<id>.
   Every value from the database is escaped before it is shown. */
(() => {
  const C = window.SITEMART_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const url = (u) => esc(String(u || "").replace(/'/g, "%27"));
  const money = (v) => `GH&#8373;${Number(v).toLocaleString("en-GH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const REGIONS = ["Greater Accra", "Ashanti", "Western", "Central", "Eastern", "Volta", "Northern", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo", "Oti", "Savannah", "North East", "Western North"];
  const KIND = { all: "Everything", equipment: "Equipment", materials: "Materials" };
  const ICON = {
    equip: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17h11l3-6h3v6"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M6 17V9l5-3 3 5"/></svg>',
    mat: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  };

  async function rpc(fn, args) {
    const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: C.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${C.SUPABASE_PUBLISHABLE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${fn} ${r.status}`);
    return r.json();
  }

  // Equipment shows its day rate first, then its sale price; materials their price.
  function priceOf(i) {
    if (i.kind === "equipment") {
      if (Number(i.daily_rate) > 0) return [money(i.daily_rate), "/day"];
      if (Number(i.sale_price) > 0) return [money(i.sale_price), ""];
      return ["Ask for price", ""];
    }
    return Number(i.price) > 0 ? [money(i.price), ""] : ["Ask for price", ""];
  }
  const route = () => {
    const [path, qs] = (location.hash.replace(/^#/, "") || "/").split("?");
    return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(qs || "") };
  };

  /* ---------- search ---------- */
  function card(i) {
    const img = (i.images || [])[0], [p, per] = priceOf(i), s = i.supplier || {}, n = (i.images || []).length;
    const kind = i.kind === "equipment" ? "equipment" : "materials";
    return `<a class="card" href="#/item/${kind}/${esc(i.id)}">
      <span class="pic" ${img ? `style="background-image:url('${url(img)}')"` : ""}>${img ? "" : `<i class="ph">${i.kind === "equipment" ? ICON.equip : ICON.mat}</i>`}
        ${s.verified ? `<em class="tag ok">${ICON.check} Verified supplier</em>` : ""}${s.featured ? '<em class="tag ft">Featured</em>' : ""}${n > 1 ? `<em class="tag n">${n} photos</em>` : ""}</span>
      <span class="body"><b class="name">${esc(i.name)}</b><span class="price">${p}<small>${per}</small></span>
        <small class="by">${esc(s.name || "Supplier")}${s.town || s.region ? ` · ${esc(s.town || s.region)}` : ""}</small></span></a>`;
  }

  async function home({ q }) {
    const kind = ["equipment", "materials"].includes(q.get("kind")) ? q.get("kind") : "all";
    const term = q.get("q") || "", region = q.get("region") || "", cat = q.get("cat") || "";
    document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.kind === kind));
    const v = $("#view");
    v.innerHTML = `
      <section class="hero">
        <h1>Equipment and building materials, from suppliers you can trust.</h1>
        <p class="sub">Rent machines and buy cement, blocks, iron rods and more from verified suppliers across Ghana. Order and pay through BAID X, where your money is held safely until delivery.</p>
        <form class="find" id="find" role="search">
          <label class="field">${ICON.search}<input name="q" type="search" value="${esc(term)}" placeholder="Excavator, cement, blocks, roofing…" aria-label="What do you need?" /></label>
          <select name="region" aria-label="Region"><option value="">All of Ghana</option>${REGIONS.map((r) => `<option ${r === region ? "selected" : ""}>${r}</option>`).join("")}</select>
          <button class="btn light" type="submit">Search</button>
        </form>
        <div class="kinds" role="tablist" aria-label="Show">${Object.entries(KIND).map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === kind}" class="${k === kind ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
      </section>
      <section class="results"><div class="cats" id="cats"></div><p class="count" id="count"></p><div class="grid" id="grid">${'<div class="card skel"></div>'.repeat(6)}</div></section>
      <section class="how">
        <div><b>1</b><h3>Find it</h3><p>Search equipment and materials from suppliers across all 16 regions.</p></div>
        <div><b>2</b><h3>Order on BAID X</h3><p>Sign in to BAID X and place your order. Your money is held safely in escrow.</p></div>
        <div><b>3</b><h3>Confirm delivery</h3><p>The supplier is paid only when you confirm it arrived, or 3 days after delivery.</p></div>
      </section>`;
    $("#find").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); go({ kind, q: f.get("q"), region: f.get("region") }); });
    v.querySelectorAll(".kinds [data-k]").forEach((b) => b.addEventListener("click", () => go({ kind: b.dataset.k, q: term, region })));
    try {
      const r = await rpc("sitemart_catalog", { p_kind: kind, p_query: term || null, p_region: region || null, p_category: cat || null, p_limit: 48, p_offset: 0 });
      const cats = r.categories || [];
      $("#cats").innerHTML = cats.length > 1 ? `<button type="button" class="${cat ? "" : "on"}" data-c="">All</button>${cats.map((c) => `<button type="button" class="${c === cat ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}` : "";
      $("#cats").querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => go({ kind, q: term, region, cat: b.dataset.c })));
      $("#count").textContent = r.total ? `${r.total} ${r.total === 1 ? "listing" : "listings"}${region ? ` in ${region}` : ""}` : "";
      $("#grid").innerHTML = (r.items || []).length ? r.items.map(card).join("")
        : `<div class="empty"><b>${term || region || cat ? "Nothing matches that yet" : "Listings are on their way"}</b><p>${term || region || cat ? "Try another word, a nearby region or All of Ghana." : "Suppliers are adding their equipment and materials. Check back soon."}</p><a class="btn ghost sm" href="https://www.baid-x.com/auth.html?mode=signup&amp;group=pro">Are you a supplier? List your items</a></div>`;
    } catch (e) {
      console.error(e);
      $("#grid").innerHTML = '<div class="empty"><b>We couldn\'t load the listings</b><p>Check your connection and try again.</p><button class="btn ghost sm" type="button" onclick="location.reload()">Try again</button></div>';
    }
  }
  function go(p) {
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v && !(k === "kind" && v === "all")) q.set(k, v); });
    location.hash = `#/${q.toString() ? `?${q}` : ""}`;
  }

  /* ---------- one listing ---------- */
  async function item(kind, id) {
    const v = $("#view");
    v.innerHTML = '<div class="item"><div class="gal skel"></div></div>';
    let i;
    try { i = await rpc("sitemart_item", { p_kind: kind, p_id: id }); } catch (e) { console.error(e); }
    if (!i) { v.innerHTML = `<div class="empty"><b>This listing isn't available</b><p>It may have been sold or taken down.</p><a class="btn ghost sm" href="#/">Back to SiteMart</a></div>`; return; }
    document.title = `${i.name} · SiteMart by BAID X`;
    const imgs = i.images || [], s = i.supplier || {}, eq = i.kind === "equipment";
    const prices = eq ? [Number(i.daily_rate) > 0 && ["Rent", money(i.daily_rate), "per day"], Number(i.sale_price) > 0 && ["Buy", money(i.sale_price), ""]].filter(Boolean)
      : [Number(i.price) > 0 && ["Price", money(i.price), ""]].filter(Boolean);
    const facts = [i.category, eq && i.condition && `${i.condition[0].toUpperCase()}${i.condition.slice(1)} condition`, !eq && i.quantity != null && (Number(i.quantity) > 0 ? `${Number(i.quantity).toLocaleString("en-GH")} in stock` : "Out of stock")].filter(Boolean);
    v.innerHTML = `<div class="item">
      <a class="back" href="#/">${ICON.back} All listings</a>
      <div class="gal">${imgs.length ? `<div class="main" style="background-image:url('${url(imgs[0])}')" role="img" aria-label="${esc(i.name)}"></div>${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, k) => `<button type="button" class="${k ? "" : "on"}" data-src="${url(u)}" style="background-image:url('${url(u)}')" aria-label="Photo ${k + 1}"></button>`).join("")}</div>` : ""}` : `<div class="main none">${eq ? ICON.equip : ICON.mat}</div>`}</div>
      <div class="info">
        <span class="eyebrow">${eq ? "Equipment" : "Building materials"}</span>
        <h1>${esc(i.name)}</h1>
        ${facts.length ? `<div class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</div>` : ""}
        <div class="prices">${prices.length ? prices.map(([l, p, per]) => `<div><small>${l}</small><b>${p}</b>${per ? `<small>${per}</small>` : ""}</div>`).join("") : "<div><small>Price</small><b>Ask the supplier</b></div>"}</div>
        ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ""}
        <div class="supplier">
          <span class="logo" ${s.logo ? `style="background-image:url('${url(s.logo)}')"` : ""}>${s.logo ? "" : esc((s.name || "S")[0])}</span>
          <div><b>${esc(s.name || "Supplier")} ${s.verified ? `<em class="vb">${ICON.check} Verified</em>` : ""}</b><small>${esc([s.town, s.region].filter(Boolean).join(", ") || "Ghana")}</small></div>
        </div>
        ${s.accepting === false ? '<p class="note">This supplier is not taking orders right now.</p>' : `
        <a class="btn light wide" href="${C.BAIDX}/auth.html">Order on BAID X</a>
        <p class="note">Sign in or create a free BAID X account to order. Your money is held in escrow and the supplier is paid only when you confirm delivery.</p>`}
      </div></div>`;
    v.querySelectorAll(".thumbs [data-src]").forEach((b) => b.addEventListener("click", () => {
      v.querySelector(".gal .main").style.backgroundImage = `url('${b.dataset.src}')`;
      v.querySelectorAll(".thumbs button").forEach((x) => x.classList.toggle("on", x === b));
    }));
    scrollTo(0, 0);
  }

  function render() {
    document.title = "SiteMart by BAID X · Equipment and building materials in Ghana";
    const r = route();
    if (r.parts[0] === "item" && ["equipment", "materials"].includes(r.parts[1]) && r.parts[2]) return item(r.parts[1], r.parts[2]);
    return home(r);
  }
  addEventListener("hashchange", render);
  render();
})();
