/* BAID X landing page for signed-out visitors: in-page links, the bar's bottom line once
   the page scrolls, and the trust stack, whose four glass layers fold into one card as the
   visitor scrolls through it. Nothing moves on its own; reduced motion gets the finished card. */
(() => {
  const root = document.querySelector("#screen-landing .lp");
  if (!root) return;
  const bar = root.querySelector("#lpBar");
  const year = root.querySelector("#lpYear");
  if (year) year.textContent = new Date().getFullYear();

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
  const paint = () => {
    if (!stack) return;
    const sp = calm ? 1 : through(stack);
    stack.style.setProperty("--p", ease(clamp((sp - 0.1) / 0.75)).toFixed(4));
    checks.forEach((li, i) => li.classList.toggle("on", sp > 0.12 + i * 0.18));
  };
  let queued = false;
  addEventListener("scroll", () => {
    if (!root.parentElement.classList.contains("active")) return;
    bar.classList.toggle("scrolled", scrollY > 8);
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; paint(); }); }
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
  const TIPS = [["A badge is earned, not bought", "Badges come from checks a person at BAID X has done: profile, Ghana Card, trade and background."],
    ["Pay through escrow", "On BAID X the money waits safely until you approve the work. Never send cash upfront to someone you have not checked."],
    ["Ask for their BAID X name", "The name on their profile is the one to search here, the same as on their Ghana Card."]];
  const note = (t, b, warn) => `<div class="lp-note-row${warn ? " warn" : ""}"><b>${esc(t)}</b><span>${esc(b)}</span></div>`;
  function renderCheck() {
    if (!checkOut) return;
    const q = (checkQ?.value || "").trim().toLowerCase();
    if (q.length < 2) { checkOut.innerHTML = TIPS.map(([t, b]) => note(t, b)).join(""); return; }
    if (!people) { checkOut.innerHTML = note("Couldn't check right now", "Check your connection and try again.", true); return; }
    const hits = people.filter((m) => String(m.name || "").toLowerCase().includes(q))
      .sort((a, b) => (String(a.name).toLowerCase().startsWith(q) ? 0 : 1) - (String(b.name).toLowerCase().startsWith(q) ? 0 : 1)).slice(0, 20);
    checkOut.innerHTML = hits.length ? hits.map((m) => {
      const av = m.image ? `<i class="av" style="background-image:url('${esc(m.image)}')"></i>` : `<i class="av">${esc(String(m.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</i>`;
      const st = m.badge ? `<em class="ok">${esc(BADGE[m.badge] || "Verified")} by BAID X</em>` : '<em class="no">Not verified yet</em>';
      return `<div class="lp-check-row">${av}<div><b>${esc(m.name)}</b><small>${esc(KIND[m.kind] || "Member")} &middot; ${esc(m.place)}</small>${st}</div></div>`;
    }).join("") : note("No one by that name is on BAID X", "Check the spelling. If they still don't appear, they are not on BAID X: be careful before paying them, and ask them to join and get verified.", true);
  }
  checkQ?.addEventListener("input", renderCheck);

  const ratesEl = root.querySelector("#lpRates"), regionsEl = root.querySelector("#lpRegions");
  function tradeRates(list, reg) {
    const by = {};
    for (const m of list) {
      if (m.kind !== "worker" || !(m.rate > 0) || !String(m.tag || "").trim()) continue;
      if (reg && String(m.region || "").toLowerCase() !== reg.toLowerCase()) continue;
      (by[m.tag] ||= []).push(m.rate);
    }
    return Object.entries(by).map(([trade, v]) => { v.sort((a, b) => a - b); const h = v.length >> 1;
      return { trade, median: v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2, low: v[0], high: v[v.length - 1] }; })
      .sort((a, b) => a.trade.toLowerCase().localeCompare(b.trade.toLowerCase()));
  }
  function renderRates() {
    if (!ratesEl) return;
    if (!people) { ratesEl.innerHTML = note("Couldn't load rates", "Check your connection and try again.", true); return; }
    const regions = [...new Set(people.filter((m) => m.kind === "worker" && m.rate > 0 && String(m.region || "").trim()).map((m) => m.region.trim()))].sort();
    if (regionsEl) regionsEl.innerHTML = regions.length ? [null, ...regions].map((r) => `<button class="${region === r ? "on" : ""}" data-lp-region="${esc(r || "")}">${esc(r || "All Ghana")}</button>`).join("") : "";
    const rates = tradeRates(people, region), top = Math.max(0, ...rates.map((r) => r.high));
    const x = (v) => (top ? (v / top) * 100 : 0);
    ratesEl.innerHTML = rates.length ? rates.map((r) => `<div class="lp-rate"><div class="top"><b>${esc(r.trade)}</b><strong>${cedi(r.median)}<small> / day</small></strong></div>
      <div class="bar"><i class="range" style="left:${x(r.low)}%;width:max(4px, ${x(r.high) - x(r.low)}%)"></i><i class="mid" style="left:${x(r.median)}%"></i></div>
      <div class="ends"><span>${cedi(r.low)}</span><span>${cedi(r.high)}</span></div></div>`).join("")
      : note("No rates here yet", "Rates appear as professionals add their daily rate. Try All Ghana.");
  }
  regionsEl?.addEventListener("click", (e) => { const b = e.target.closest("[data-lp-region]"); if (!b) return; region = b.dataset.lpRegion || null; renderRates(); });

  renderCheck();
  addEventListener("baidx:directory", (e) => { people = e.detail; renderCheck(); renderRates(); });
})();
