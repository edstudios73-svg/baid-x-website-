/* BAID X landing page for signed-out visitors: scroll reveals, the escrow phone
   demo, role tabs and a few live member cards. Inert once someone signs in. */
(() => {
  const root = document.querySelector("#screen-landing .lp");
  if (!root) return;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const active = () => root.parentElement.classList.contains("active");

  const TRADES = ["Electricians", "Masons", "Plumbers", "Carpenters", "Welders", "Painters", "Tilers", "Steel benders", "Roofers", "AC technicians", "Aluminium fabricators", "POP ceilings", "Surveyors", "Architects", "Site engineers", "Excavator operators", "Truck drivers", "Cement suppliers", "Sand and quarry dust", "Block makers", "PPE suppliers", "Solar installers", "Interior designers", "Landscapers"];
  const half = TRADES.map((t) => `<span>${t}</span>`).join("");
  $("#lpTicker").innerHTML = half + half; // doubled so the marquee loops without a seam
  $("#lpYear").textContent = new Date().getFullYear();
  $$("[data-seal]").forEach((el) => { el.innerHTML = window.BX?.badge(el.dataset.seal, 40) || ""; });

  // links in the bar scroll within the page instead of changing the app's hash route
  root.addEventListener("click", (e) => {
    const a = e.target.closest("[data-lp-jump]");
    if (a) { e.preventDefault(); root.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" }); return; }
    const tab = e.target.closest("#lpTabs .tab");
    if (tab) {
      $$("#lpTabs .tab").forEach((t) => { t.classList.toggle("on", t === tab); t.setAttribute("aria-selected", t === tab); });
      $$(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === tab.dataset.role));
    }
  });

  const bar = $("#lpBar");
  addEventListener("scroll", () => { if (active()) bar.classList.toggle("scrolled", scrollY > 8); }, { passive: true });

  function count(el) {
    const end = +el.dataset.count, suf = el.dataset.suffix || "";
    if (calm || !end) { el.textContent = end + suf; return; }
    const t0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  const seen = (el) => { el.classList.add("lp-in"); el.querySelectorAll("[data-count]").forEach(count); };
  const targets = () => $$("[data-rv]:not(.lp-in), #lpSteps:not(.lp-in), #lpFlow:not(.lp-in)");
  let io = null;
  if ("IntersectionObserver" in window && !calm) {
    io = new IntersectionObserver((list) => list.forEach((x) => { if (x.isIntersecting) { seen(x.target); io.unobserve(x.target); } }), { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    targets().forEach((el) => io.observe(el));
  } else targets().forEach(seen);

  // the phone walks one escrow job from funded to paid, then starts over
  const steps = $$("#phSteps .ph-step"), status = $("#phStatus"), btn = $("#phBtn");
  let at = 1;
  function paint() {
    steps.forEach((s, i) => { s.classList.toggle("done", i < at); s.classList.toggle("now", i === at); });
    const paid = at >= steps.length;
    status.textContent = paid ? "Paid" : at === 3 ? "Releasing" : "Held";
    status.classList.toggle("paid", paid);
    btn.textContent = paid ? "GH₵900 sent to MoMo" : at === 3 ? "Releasing payment" : at === 2 ? "Approve and release" : "Waiting for the work";
  }
  paint();
  if (!calm) setInterval(() => { if (!active() || document.hidden) return; at = at >= steps.length ? 1 : at + 1; paint(); }, 2400);

  // a few real profiles, so visitors see the network is live; hidden when there are none
  window.LANDING = {
    feed(items) {
      const cards = (items || []).slice(0, 6), wrap = document.getElementById("lp-net");
      if (!cards.length || !window.APP?.cardHTML) { wrap.hidden = true; return; }
      $("#lpNet").innerHTML = cards.map(window.APP.cardHTML).join("");
      wrap.hidden = false;
      if (io) wrap.querySelectorAll("[data-rv]:not(.lp-in)").forEach((el) => io.observe(el)); else wrap.querySelectorAll("[data-rv]").forEach(seen);
    },
  };
})();
