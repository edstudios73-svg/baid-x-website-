/* Blueprint: house plans by verified designers in Ghana.
   It reads published plans through two public database functions (blueprint_plans,
   blueprint_plan; supabase/phase26_blueprint.sql). Buying happens on BAID X with the member's
   wallet, and the plan is then built there with verified workers.
   Pages: #/ (gallery, with ?q=&beds=&max=&style=) and #/plan/<id>.
   Every value from the database is escaped before it is shown. */
(() => {
  const C = window.BLUEPRINT_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const url = (u) => esc(String(u || "").replace(/'/g, "%27"));
  const money = (v) => `GH&#8373;${Number(v).toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;
  const BUDGETS = [[500, "Up to GH₵500"], [1500, "Up to GH₵1,500"], [5000, "Up to GH₵5,000"], [15000, "Up to GH₵15,000"]];
  const ICON = {
    plan: '<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V9l9-6 9 6v12z"/><path d="M3 13h7v8M14 21v-6h7M10 9h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>',
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
  const route = () => {
    const [path, qs] = (location.hash.replace(/^#/, "") || "/").split("?");
    return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(qs || "") };
  };
  const specs = (p) => [p.bedrooms != null && `${p.bedrooms} bed`, p.bathrooms != null && `${p.bathrooms} bath`, p.storeys && (p.storeys > 1 ? `${p.storeys} storeys` : "Single storey"), p.plot_size && `Plot ${p.plot_size}`].filter(Boolean);

  /* ---------- gallery ---------- */
  function card(p) {
    const d = p.designer || {};
    return `<a class="card" href="#/plan/${esc(p.id)}">
      <span class="pic" ${p.cover ? `style="background-image:url('${url(p.cover)}')"` : ""}>${p.cover ? "" : `<i class="ph">${ICON.plan}</i>`}
        ${d.verified ? `<em class="tag ok">${ICON.check} Verified designer</em>` : ""}${p.style ? `<em class="tag n">${esc(p.style)}</em>` : ""}</span>
      <span class="body"><b class="name">${esc(p.title)}</b>
        <span class="specs">${specs(p).map((s) => `<span>${esc(s)}</span>`).join("")}</span>
        <span class="price">${money(p.price_ghs)}</span>
        <small class="by">by ${esc(d.name || "Designer")}${d.town || d.region ? ` · ${esc(d.town || d.region)}` : ""}</small></span></a>`;
  }

  async function home({ q }) {
    const term = q.get("q") || "", beds = q.get("beds") || "", max = q.get("max") || "", style = q.get("style") || "";
    const v = $("#view");
    v.innerHTML = `
      <section class="hero">
        <h1>House plans by verified designers, ready to build.</h1>
        <p class="sub">Browse homes designed by architects and designers in Ghana. Buy the plan you like, then hire verified workers and run the build on BAID X.</p>
        <form class="find" id="find" role="search">
          <label class="field">${ICON.search}<input name="q" type="search" value="${esc(term)}" placeholder="3 bedroom, bungalow, duplex…" aria-label="What kind of house?" /></label>
          <select name="beds" aria-label="Bedrooms"><option value="">Any bedrooms</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${String(n) === beds ? "selected" : ""}>${n}+ bedrooms</option>`).join("")}</select>
          <button class="btn light" type="submit">Search</button>
        </form>
        <div class="filters"><select id="max" aria-label="Budget for the plan"><option value="">Any plan price</option>${BUDGETS.map(([n, l]) => `<option value="${n}" ${String(n) === max ? "selected" : ""}>${l}</option>`).join("")}</select><span id="styles"></span></div>
      </section>
      <section class="results"><p class="count" id="count"></p><div class="grid" id="grid">${'<div class="card skel"></div>'.repeat(6)}</div></section>
      <section class="journey">
        <div><small>Step 1 · Blueprint</small><h3>Choose your design</h3><p>Compare plans by bedrooms, plot size and estimated building cost.</p></div>
        <div><small>Step 2 · BAID X</small><h3>Buy it safely</h3><p>Pay with your BAID X wallet: Mobile Money, bank or card. The drawings are yours at once.</p></div>
        <div><small>Step 3 · BAID X</small><h3>Build it</h3><p>Hire verified masons, electricians and project managers, and pay them through escrow.</p></div>
      </section>`;
    const go = (p) => { const s = new URLSearchParams(); Object.entries(p).forEach(([k, val]) => val && s.set(k, val)); location.hash = `#/${s.toString() ? `?${s}` : ""}`; };
    $("#find").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); go({ q: f.get("q"), beds: f.get("beds"), max, style }); });
    $("#max").addEventListener("change", (e) => go({ q: term, beds, max: e.target.value, style }));
    try {
      const r = await rpc("blueprint_plans", { p_query: term || null, p_bedrooms: beds ? Number(beds) : null, p_max_price: max ? Number(max) : null, p_style: style || null, p_limit: 48, p_offset: 0 });
      const styles = r.styles || [];
      $("#styles").innerHTML = styles.length > 1 ? `<span class="cats">${["", ...styles].map((s) => `<button type="button" class="${s === style ? "on" : ""}" data-s="${esc(s)}">${s ? esc(s) : "All styles"}</button>`).join("")}</span>` : "";
      $("#styles").querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => go({ q: term, beds, max, style: b.dataset.s })));
      $("#count").textContent = r.total ? `${r.total} ${r.total === 1 ? "plan" : "plans"}` : "";
      const filtered = term || beds || max || style;
      $("#grid").innerHTML = (r.items || []).length ? r.items.map(card).join("")
        : `<div class="empty"><b>${filtered ? "No plans match that yet" : "The first plans are on their way"}</b><p>${filtered ? "Try fewer bedrooms or a higher budget." : "Verified architects and designers are adding their house plans. Check back soon."}</p><a class="btn ghost sm" href="https://www.baid-x.com/auth.html?mode=signup&amp;group=pro">Are you a designer? Sell your plans</a></div>`;
    } catch (e) {
      console.error(e);
      $("#grid").innerHTML = '<div class="empty"><b>We couldn\'t load the plans</b><p>Check your connection and try again.</p><button class="btn ghost sm" type="button" onclick="location.reload()">Try again</button></div>';
    }
  }

  /* ---------- one plan ---------- */
  async function plan(id) {
    const v = $("#view");
    v.innerHTML = '<div class="item"><div class="gal skel"></div></div>';
    let p;
    try { p = await rpc("blueprint_plan", { p_id: id }); } catch (e) { console.error(e); }
    if (!p) { v.innerHTML = `<div class="empty"><b>This plan isn't available</b><p>The designer may have taken it down.</p><a class="btn ghost sm" href="#/">Back to Blueprint</a></div>`; return; }
    document.title = `${p.title} · Blueprint`;
    const imgs = p.images || [], d = p.designer || {};
    const rows = [["Bedrooms", p.bedrooms], ["Bathrooms", p.bathrooms], ["Storeys", p.storeys], ["Floor area", p.floor_area_m2 && `${Number(p.floor_area_m2).toLocaleString("en-GH")} m²`],
      ["Plot size", p.plot_size], ["Estimated build cost", p.est_build_cost_ghs && `${money(p.est_build_cost_ghs)}`]].filter(([, val]) => val != null && val !== "");
    v.innerHTML = `<div class="item">
      <a class="back" href="#/">${ICON.back} All house plans</a>
      <div class="gal">${imgs.length ? `<div class="main" style="background-image:url('${url(imgs[0])}')" role="img" aria-label="${esc(p.title)}"></div>${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, k) => `<button type="button" class="${k ? "" : "on"}" data-src="${url(u)}" style="background-image:url('${url(u)}')" aria-label="Image ${k + 1}"></button>`).join("")}</div>` : ""}` : `<div class="main none">${ICON.plan}</div>`}</div>
      <div class="info">
        <span class="eyebrow">${esc(p.style || "House plan")}</span>
        <h1>${esc(p.title)}</h1>
        ${p.summary ? `<p class="desc">${esc(p.summary)}</p>` : ""}
        ${rows.length ? `<div class="table">${rows.map(([l, val]) => `<div><small>${l}</small><b>${typeof val === "string" && val.startsWith("GH&#8373;") ? val : esc(val)}</b></div>`).join("")}</div>` : ""}
        ${(p.includes || []).length ? `<b>What's included</b><ul class="incl">${p.includes.map((x) => `<li>${ICON.check}${esc(x)}</li>`).join("")}</ul>` : ""}
        <div class="buybox">
          <div class="amt"><small>Plan price</small>${money(p.price_ghs)}</div>
          <a class="btn light wide" href="${C.BAIDX}/#/blueprint/${esc(p.id)}">Buy on BAID X</a>
          <p class="note">Pay with your BAID X wallet: Mobile Money, bank or card. The drawings are yours as soon as you pay, and you can hire verified workers to build it.</p>
        </div>
        <div class="supplier">
          <span class="logo" ${d.photo ? `style="background-image:url('${url(d.photo)}')"` : ""}>${d.photo ? "" : esc((d.name || "D")[0])}</span>
          <div><b>${esc(d.name || "Designer")} ${d.verified ? `<em class="vb">${ICON.check} Verified</em>` : ""}</b><small>${esc([d.town, d.region].filter(Boolean).join(", ") || "Ghana")}</small></div>
        </div>
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
      </div></div>`;
    v.querySelectorAll(".thumbs [data-src]").forEach((b) => b.addEventListener("click", () => {
      v.querySelector(".gal .main").style.backgroundImage = `url('${b.dataset.src}')`;
      v.querySelectorAll(".thumbs button").forEach((x) => x.classList.toggle("on", x === b));
    }));
    scrollTo(0, 0);
  }

  function render() {
    document.title = "Blueprint · House plans by verified designers in Ghana";
    const r = route();
    if (r.parts[0] === "plan" && r.parts[1]) return plan(r.parts[1]);
    return home(r);
  }
  addEventListener("hashchange", render);
  render();
})();
