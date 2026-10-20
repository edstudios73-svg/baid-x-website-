/* BAID X landing page for signed-out visitors: in-page links, the bar's bottom line once
   the page scrolls, and the trust stack, whose four glass layers fold into one card as the
   visitor scrolls through it. Nothing moves on its own; reduced motion gets the finished card. */
(() => {
  const root = document.querySelector("#screen-landing .lp");
  if (!root) return;
  const bar = root.querySelector("#lpBar");
  const year = root.querySelector("#lpYear");
  if (year) year.textContent = new Date().getFullYear();

  // phone-width menu: opens under the bar; a link, Escape or a tap outside closes it
  const menuBtn = root.querySelector("#lpMenuBtn"), menu = root.querySelector("#lpMenu");
  const setMenu = (on) => {
    if (!menu || !menuBtn) return;
    menu.hidden = !on;
    menuBtn.setAttribute("aria-expanded", String(on));
    menuBtn.setAttribute("aria-label", on ? "Close menu" : "Open menu");
  };
  menuBtn?.addEventListener("click", () => setMenu(menu.hidden));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && menu && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  document.addEventListener("click", (e) => { if (menu && !menu.hidden && !e.target.closest("#lpMenu, #lpMenuBtn")) setMenu(false); });
  menu?.addEventListener("click", (e) => { if (e.target.closest("a, button")) setMenu(false); });

  // links in the bar scroll within the page instead of changing the app's hash route
  root.addEventListener("click", (e) => {
    const a = e.target.closest("[data-lp-jump]");
    if (!a) return;
    e.preventDefault();
    root.querySelector(a.getAttribute("href"))?.scrollIntoView({ block: "start" });
  });

  const seal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  root.querySelectorAll("[data-lp-seal]").forEach((el) => { el.innerHTML = seal; });

  const stack = root.querySelector("#lpStack"), checks = [...root.querySelectorAll("#lpChecks li")];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  // how far the visitor has scrolled through an element taller than the screen, 0 to 1
  const through = (el) => { const r = el.getBoundingClientRect(), span = r.height - innerHeight; return span > 0 ? clamp(-r.top / span) : 0; };
  // The card glides toward where the scroll says it should be (a short ease each frame)
  // instead of jumping with every wheel step, so the fold feels smooth at any speed.
  let shown = 0, goal = 0, gliding = false;
  const glide = () => {
    shown += (goal - shown) * 0.2;
    if (Math.abs(goal - shown) < 0.001) shown = goal;
    stack.style.setProperty("--p", shown.toFixed(4));
    gliding = shown !== goal;
    if (gliding) requestAnimationFrame(glide);
  };
  const paint = () => {
    if (!stack) return;
    const sp = calm ? 1 : through(stack);
    goal = ease(clamp((sp - 0.08) / 0.7));
    checks.forEach((li, i) => li.classList.toggle("on", sp > 0.1 + i * 0.16));
    if (calm) { shown = goal; stack.style.setProperty("--p", goal); return; }
    if (!gliding) { gliding = true; requestAnimationFrame(glide); }
  };
  addEventListener("scroll", () => {
    if (!root.parentElement.classList.contains("active")) return;
    bar.classList.toggle("scrolled", scrollY > 8);
    paint();
  }, { passive: true });
  addEventListener("resize", paint);
  paint();

  /* ---------- visitor tools (same as the app's Check and Rates tabs) ----------
     Check a badge: type a name, see who BAID X has verified. Price guide: the middle
     daily rate and the range for each trade, by region. Neither ever shows how many
     people are on BAID X. Both read the public directory the page already loads. */
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { worker: "Professional", company: "Company", pm: "Project manager", business: "Supplier" };
  const BADGE = { verified: "Verified", identity: "Identity verified", professional: "Professional verified", advanced: "Advanced verified" };
  const cedi = (v) => `GH\u20B5${Math.round(v)}`;
  let people = null, region = null;

  const checkOut = root.querySelector("#lpCheckOut"), checkQ = root.querySelector("#lpCheckQ");
  const TIPS = [["A badge is earned, not bought", "Every badge comes from checks our team does by hand: profile, Ghana Card, trade and background."],
    ["Pay through escrow", "Your money waits safely until you approve the work. Never send cash up front to someone you haven't checked."],
    ["Ask for their BAID X name", "Search the full name on their profile. It matches the name on their Ghana Card."]];
  const note = (t, b, warn) => `<div class="lp-note-row${warn ? " warn" : ""}"><b>${esc(t)}</b><span>${esc(b)}</span></div>`;
  function renderCheck() {
    if (!checkOut) return;
    const q = (checkQ?.value || "").trim().toLowerCase();
    if (q.length < 3) { checkOut.innerHTML = TIPS.map(([t, b]) => note(t, b)).join(""); return; }
    if (!people) { checkOut.innerHTML = note("Couldn't check right now", "Check your connection and try again.", true); return; }
    // only verified members are shown: the check answers "has BAID X verified this person?", not "who is on BAID X"
    const hits = people.filter((m) => m.badge && String(m.name || "").toLowerCase().includes(q))
      .sort((a, b) => (String(a.name).toLowerCase().startsWith(q) ? 0 : 1) - (String(b.name).toLowerCase().startsWith(q) ? 0 : 1)).slice(0, 8);
    checkOut.innerHTML = hits.length ? hits.map((m) => {
      const av = m.image ? `<i class="av" style="background-image:url('${esc(m.image)}')"></i>` : `<i class="av">${esc(String(m.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</i>`;
      const st = `<em class="ok">${esc(BADGE[m.badge] || "Verified")} by BAID X</em>`;
      return `<div class="lp-check-row">${av}<div><b>${esc(m.name)}</b><small>${esc(KIND[m.kind] || "Member")} &middot; ${esc(m.place)}</small>${st}</div></div>`;
    }).join("") : note("No verified member by that name", "Check the spelling and try their full name. If they still don't show up, we haven't verified them. Be careful, and only pay through escrow.", true);
  }
  checkQ?.addEventListener("input", renderCheck);

  const ratesEl = root.querySelector("#lpRates"), regionsEl = root.querySelector("#lpRegions");
  // A trade shows only with at least MIN_SAMPLES rates, after rates far from the middle
  // (under a third or over three times it) are dropped, so one odd rate can't set the guide.
  const MIN_SAMPLES = 3;
  const mid = (v) => { const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
  function tradeRates(list, reg) {
    const by = {};
    for (const m of list) {
      if (m.kind !== "worker" || !(m.rate > 0) || !String(m.tag || "").trim()) continue;
      if (reg && String(m.region || "").toLowerCase() !== reg.toLowerCase()) continue;
      (by[m.tag] ||= []).push(m.rate);
    }
    return Object.entries(by).map(([trade, all]) => {
      all.sort((a, b) => a - b);
      const m0 = mid(all), v = all.filter((r) => r >= m0 / 3 && r <= m0 * 3);
      return v.length < MIN_SAMPLES ? null : { trade, median: mid(v), low: v[0], high: v[v.length - 1] };
    }).filter(Boolean)
      .sort((a, b) => a.trade.toLowerCase().localeCompare(b.trade.toLowerCase()));
  }
  function renderRates() {
    if (!ratesEl) return;
    if (!people) { ratesEl.innerHTML = note("Couldn't load rates", "Check your connection and try again.", true); return; }
    const regions = [...new Set(people.filter((m) => m.kind === "worker" && m.rate > 0 && String(m.region || "").trim()).map((m) => m.region.trim()))]
      .filter((r) => tradeRates(people, r).length).sort();
    if (regionsEl) regionsEl.innerHTML = regions.length ? [null, ...regions].map((r) => `<button class="${region === r ? "on" : ""}" data-lp-region="${esc(r || "")}">${esc(r || "All Ghana")}</button>`).join("") : "";
    const rates = tradeRates(people, region), top = Math.max(0, ...rates.map((r) => r.high));
    const x = (v) => (top ? (v / top) * 100 : 0);
    ratesEl.innerHTML = rates.length ? rates.map((r) => `<div class="lp-rate"><div class="top"><b>${esc(r.trade)}</b><strong>${cedi(r.median)}<small> / day</small></strong></div>
      <div class="bar"><i class="range" style="left:${x(r.low)}%;width:max(4px, ${x(r.high) - x(r.low)}%)"></i><i class="mid" style="left:${x(r.median)}%"></i></div>
      <div class="ends"><span>${cedi(r.low)}</span><span>${cedi(r.high)}</span></div></div>`).join("")
      : note("No rates here yet", "A trade shows up once enough pros in the area have set their rate, so one price can't skew the guide. Try All Ghana for now.");
  }
  regionsEl?.addEventListener("click", (e) => { const b = e.target.closest("[data-lp-region]"); if (!b) return; region = b.dataset.lpRegion || null; renderRates(); });

  renderCheck();
  let loaded = false;
  addEventListener("baidx:directory", (e) => { loaded = true; people = e.detail; renderCheck(); renderRates(); });
  // a slow network should not leave the price guide loading for ever
  setTimeout(() => { if (!loaded) renderRates(); }, 8000);
})();
