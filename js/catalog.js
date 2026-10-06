/* BAID X supplier marketplace: equipment and materials with photo galleries.
   Buyers (and every signed-in trade) browse a photo grid, open a listing with a swipeable gallery and view
   photos full screen. Suppliers add up to 6 photos per listing and manage them from their catalog.
   Reads go through supplier_catalog; listing writes are the supplier's own rows (RLS owner policy). */
(() => {
  "use strict";
  const { esc, icon } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const MAX = 6;
  const money = (n) => `GH₵${(Number(n) || 0).toLocaleString("en-GH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const CAN_ORDER = ["company", "individual-employer"];
  const state = { kind: null, list: [], q: "", cat: "", item: null, lb: null };

  /* ---------- photos: shrink for weak networks, then upload to the public listing bucket ---------- */
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      const b = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.84));
      return b ? new File([b], "photo.jpg", { type: "image/jpeg" }) : file;
    } catch { return file; }
  }
  async function uploadPhotos(c, files) {
    const urls = [];
    for (const [i, f] of [...files].entries()) {
      if (!/^image\//.test(f.type)) continue;
      const path = await F().upload(c, "listing-images", await shrink(f), `item-${i}`);
      if (path) urls.push(F().publicUrl(c, "listing-images", path));
    }
    return urls;
  }

  /* ---------- buyer: the marketplace ---------- */
  const priceOf = (i) => (state.kind === "equipment"
    ? (i.daily_rate > 0 ? [money(i.daily_rate), "/day"] : i.sale_price > 0 ? [money(i.sale_price), ""] : ["Ask for price", ""])
    : (i.price > 0 ? [money(i.price), ""] : ["Ask for price", ""]));
  const shown = () => state.list.filter((i) => (!state.cat || i.category === state.cat)
    && (!state.q || `${i.name} ${i.category || ""} ${i.business} ${i.town || ""} ${i.region || ""}`.toLowerCase().includes(state.q)));

  function cards() {
    const list = shown(), isEq = state.kind === "equipment";
    if (!list.length) return `<p class="mk-none">Nothing matches. Try another word or category.</p>`;
    return list.map((i) => {
      const img = (i.images || [])[0], [p, per] = priceOf(i), n = (i.images || []).length;
      return `<button class="mk-card" data-cat="open" data-id="${esc(i.id)}">
        <span class="mk-img" ${img ? `style="background-image:url('${esc(img)}')"` : ""}>${img ? "" : `<i class="mk-ph">${icon(isEq ? "equip" : "mat", 34)}</i>`}
          ${n > 1 ? `<em class="mk-n">${icon("img", 12)} ${n}</em>` : ""}${i.verified ? `<em class="mk-v">${icon("task", 12)} Verified</em>` : ""}</span>
        <span class="mk-body"><b class="mk-name">${esc(i.name)}</b><span class="mk-price">${esc(p)}<small>${per}</small></span><small class="mk-by">${esc(i.business)}${i.town || i.region ? ` · ${esc(i.town || i.region)}` : ""}</small></span></button>`;
    }).join("");
  }

  const view = (kind) => async (c) => {
    const { head, empty } = U(), isEq = kind === "equipment";
    state.kind = kind; state.list = (await rpc(c, "supplier_catalog", { p_kind: kind }).catch(() => [])) || [];
    if (!state.list.length) return head(isEq ? "Equipment" : "Materials") + empty(isEq ? "equip" : "mat", `No ${isEq ? "equipment" : "materials"} listed yet`, "Suppliers list what they rent and sell here. Check back soon, or find suppliers in Discover.", `<button class="btn-light sm" data-tab="discover">Find suppliers</button>`);
    const cats = [...new Set(state.list.map((i) => i.category).filter(Boolean))].sort();
    if (state.cat && !cats.includes(state.cat)) state.cat = "";
    return head(isEq ? "Equipment" : "Materials") + `<p class="sub2">${isEq ? "Machines and tools to rent or buy from suppliers across Ghana." : "Building materials from suppliers across Ghana."}</p>
      <label class="mk-search">${icon("search", 18)}<input type="search" id="mkQ" placeholder="Search ${isEq ? "excavators, mixers, scaffolds" : "cement, blocks, tiles"}…" value="${esc(state.q)}" autocomplete="off" /></label>
      ${cats.length > 1 ? `<div class="mk-chips"><button class="mk-chip ${state.cat ? "" : "on"}" data-cat="chip" data-v="">All</button>${cats.map((x) => `<button class="mk-chip ${state.cat === x ? "on" : ""}" data-cat="chip" data-v="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}
      <div class="mk-grid" id="mkGrid">${cards()}</div>`;
  };

  function openItem(c, id) {
    const i = state.list.find((x) => x.id === id); if (!i) return;
    state.item = i;
    const isEq = state.kind === "equipment", imgs = i.images || [], canOrder = CAN_ORDER.includes(c.role);
    const gallery = imgs.length
      ? `<div class="mk-gal"><div class="mk-slides" id="mkSlides">${imgs.map((u, n) => `<button class="mk-slide" data-cat="zoom" data-n="${n}" style="background-image:url('${esc(u)}')" aria-label="Photo ${n + 1} of ${imgs.length}"></button>`).join("")}</div>
        ${imgs.length > 1 ? `<em class="mk-count" id="mkCount">1 / ${imgs.length}</em><div class="mk-dots" id="mkDots">${imgs.map((_, n) => `<i class="${n ? "" : "on"}"></i>`).join("")}</div>` : ""}</div>
        ${imgs.length > 1 ? `<div class="mk-thumbs">${imgs.map((u, n) => `<button class="mk-th ${n ? "" : "on"}" data-cat="go" data-n="${n}" style="background-image:url('${esc(u)}')" aria-label="Show photo ${n + 1}"></button>`).join("")}</div>` : ""}`
      : `<div class="mk-gal mk-empty">${icon(isEq ? "equip" : "mat", 48)}<small>No photos yet</small></div>`;
    const prices = isEq
      ? [i.daily_rate > 0 ? `<div><small>Rent</small><b>${money(i.daily_rate)}<i>/day</i></b></div>` : "", i.sale_price > 0 ? `<div><small>Buy</small><b>${money(i.sale_price)}</b></div>` : ""].join("")
      : (i.price > 0 ? `<div><small>Price</small><b>${money(i.price)}</b></div>` : "");
    const facts = [i.category, isEq && i.condition ? `${i.condition[0].toUpperCase()}${i.condition.slice(1)} condition` : "", !isEq && i.quantity != null ? (i.quantity > 0 ? `${i.quantity} in stock` : "Out of stock") : ""].filter(Boolean);
    const logo = i.logo ? `style="background-image:url('${esc(i.logo)}')"` : "";
    const order = canOrder && i.accepting !== false && window.ORDERS ? window.ORDERS.buttons(i, isEq) : "";
    F().openSheet(i.name, `${gallery}
      <div class="mk-prices">${prices || `<div><small>Price</small><b>Ask the supplier</b></div>`}</div>
      ${facts.length ? `<div class="mk-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</div>` : ""}
      ${i.description ? `<p class="mk-desc">${esc(i.description)}</p>` : ""}
      <div class="mk-sup"><span class="av sq" ${logo}>${i.logo ? "" : icon("box", 18)}</span><span class="tx"><b>${esc(i.business)} ${i.verified ? `<span class="pill ok">Verified</span>` : ""}</b><small>${esc([i.town, i.region].filter(Boolean).join(", ") || "Ghana")}</small></span></div>
      <div class="mk-acts">${order}<button class="btn-dark sm" data-fx="message" data-id="${esc(i.business_id)}" data-name="${esc(i.business)}">Message supplier</button></div>
      ${!canOrder ? `<p class="mk-note">Ordering through escrow is for company and client accounts. Message the supplier to ask about price and delivery.</p>` : i.accepting === false ? `<p class="mk-note">This supplier isn't taking orders right now. Message them to ask.</p>` : ""}`);
    const s = document.getElementById("mkSlides");
    if (s && imgs.length > 1) s.addEventListener("scroll", () => { const n = Math.round(s.scrollLeft / s.clientWidth); setActive(n, imgs.length); }, { passive: true });
  }
  function setActive(n, total) {
    const cnt = document.getElementById("mkCount"); if (cnt) cnt.textContent = `${n + 1} / ${total}`;
    document.querySelectorAll("#mkDots i").forEach((d, k) => d.classList.toggle("on", k === n));
    document.querySelectorAll(".mk-th").forEach((d, k) => d.classList.toggle("on", k === n));
  }

  /* full-screen photo viewer */
  function lightbox(n) {
    const imgs = state.item?.images || []; if (!imgs.length) return;
    close(); state.lb = n;
    const el = document.createElement("div"); el.className = "mk-lb"; el.id = "mkLb"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Photos");
    el.innerHTML = `<div class="mk-lb-top"><span id="mkLbN">${n + 1} / ${imgs.length}</span><button data-cat="lb-x" aria-label="Close">${icon("plus", 22)}</button></div>
      <div class="mk-lb-track" id="mkLbT">${imgs.map((u) => `<div class="mk-lb-s"><img src="${esc(u)}" alt="${esc(state.item.name)}" loading="lazy"></div>`).join("")}</div>
      ${imgs.length > 1 ? `<button class="mk-lb-nav p" data-cat="lb-p" aria-label="Previous">${icon("chev", 22)}</button><button class="mk-lb-nav n" data-cat="lb-n" aria-label="Next">${icon("chev", 22)}</button>` : ""}`;
    document.body.appendChild(el);
    const t = document.getElementById("mkLbT");
    requestAnimationFrame(() => { t.scrollLeft = n * t.clientWidth; });
    t.addEventListener("scroll", () => { state.lb = Math.round(t.scrollLeft / t.clientWidth); const l = document.getElementById("mkLbN"); if (l) l.textContent = `${state.lb + 1} / ${imgs.length}`; }, { passive: true });
  }
  const close = () => document.getElementById("mkLb")?.remove();
  const step = (d) => { const t = document.getElementById("mkLbT"); if (t) t.scrollTo({ left: Math.max(0, (state.lb + d)) * t.clientWidth, behavior: "smooth" }); };
  document.addEventListener("keydown", (e) => { if (!document.getElementById("mkLb")) return; if (e.key === "Escape") close(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); });

  /* ---------- supplier: manage photos on a listing ---------- */
  const TBL = (seg) => (seg === "equipment" ? "business_equipment" : "business_products");
  async function photosSheet(c, seg, id) {
    const { data, error } = await c.sb.from(TBL(seg)).select("id,name,image_urls").eq("id", id).eq("business_id", c.uid).maybeSingle();
    if (error || !data) return c.toast("Listing not found.");
    const imgs = data.image_urls || [];
    F().openSheet(`Photos · ${data.name}`, `<p class="es-s">Buyers see these on your listing, first photo first. Clear, well-lit photos from a few angles sell faster. Up to ${MAX}.</p>
      <div class="mk-mgr">${imgs.map((u, n) => `<div class="mk-mg" style="background-image:url('${esc(u)}')">${n === 0 ? `<em>Cover</em>` : `<button class="mk-mg-cover" data-cat="cover" data-seg="${seg}" data-id="${esc(id)}" data-n="${n}">Make cover</button>`}<button class="mk-mg-x" data-cat="rm-photo" data-seg="${seg}" data-id="${esc(id)}" data-n="${n}" aria-label="Remove photo ${n + 1}">${icon("plus", 14)}</button></div>`).join("")}
      ${imgs.length < MAX ? `<label class="mk-mg mk-mg-add">${icon("plus", 22)}<small>Add photos</small><input type="file" accept="image/*" multiple hidden data-cat-up="${seg}" data-id="${esc(id)}"></label>` : ""}</div>
      <p class="wl-err" id="mkE"></p>`);
  }
  async function savePhotos(c, seg, id, urls) {
    const { error } = await c.sb.from(TBL(seg)).update({ image_urls: urls }).eq("id", id).eq("business_id", c.uid); if (error) throw error;
  }
  async function currentPhotos(c, seg, id) { const { data } = await c.sb.from(TBL(seg)).select("image_urls").eq("id", id).maybeSingle(); return data?.image_urls || []; }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-cat]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), a = el.dataset.cat;
    e.preventDefault(); e.stopPropagation();
    try {
      if (a === "open") return openItem(c, el.dataset.id);
      if (a === "chip") { state.cat = el.dataset.v; document.querySelectorAll(".mk-chip").forEach((b) => b.classList.toggle("on", b === el)); document.getElementById("mkGrid").innerHTML = cards(); return; }
      if (a === "zoom") return lightbox(+el.dataset.n);
      if (a === "go") { const s = document.getElementById("mkSlides"); if (s) s.scrollTo({ left: +el.dataset.n * s.clientWidth, behavior: "smooth" }); return; }
      if (a === "lb-x") return close();
      if (a === "lb-p") return step(-1);
      if (a === "lb-n") return step(1);
      if (a === "photos") return photosSheet(c, el.dataset.seg, el.dataset.id);
      if (a === "rm-photo" || a === "cover") {
        const imgs = await currentPhotos(c, el.dataset.seg, el.dataset.id), n = +el.dataset.n;
        const next = a === "cover" ? [imgs[n], ...imgs.filter((_, k) => k !== n)] : imgs.filter((_, k) => k !== n);
        await savePhotos(c, el.dataset.seg, el.dataset.id, next); c.toast(a === "cover" ? "Cover photo set." : "Photo removed."); window.APP.route(); return photosSheet(c, el.dataset.seg, el.dataset.id);
      }
    } catch (x) { F().fail(c, x); }
  }, true);
  document.addEventListener("input", (e) => {
    if (e.target.id !== "mkQ") return;
    state.q = e.target.value.trim().toLowerCase(); const g = document.getElementById("mkGrid"); if (g) g.innerHTML = cards();
  });
  document.addEventListener("change", (e) => {
    const pick = e.target.closest("[data-mk-pick]"); if (!pick) return;
    const n = Math.min(pick.files.length, MAX), l = document.getElementById("mkPick");
    if (l) l.textContent = n ? `${n} photo${n === 1 ? "" : "s"} chosen${pick.files.length > MAX ? ` (first ${MAX} used)` : ""}` : `Up to ${MAX}. Buyers see the first one first.`;
  });
  document.addEventListener("change", async (e) => {
    const inp = e.target.closest("[data-cat-up]"); if (!inp || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), seg = inp.dataset.catUp, id = inp.dataset.id, err = document.getElementById("mkE");
    try {
      const imgs = await currentPhotos(c, seg, id), room = MAX - imgs.length;
      if (room <= 0) return;
      c.toast("Uploading photos…");
      const urls = await uploadPhotos(c, [...inp.files].slice(0, room));
      await savePhotos(c, seg, id, [...imgs, ...urls]); c.toast(`${urls.length} photo${urls.length === 1 ? "" : "s"} added.`);
      window.APP.route(); photosSheet(c, seg, id);
    } catch (x) { if (err) err.textContent = x?.message || "Could not upload."; else F().fail(c, x); }
  });

  window.CATALOG = { uploadPhotos, MAX };
  window.DASH.register("equipment", view("equipment"));
  window.DASH.register("materials", view("products"));
})();
