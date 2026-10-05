/* BAID X landing page for signed-out visitors. The motion carries the story:
   headings rise in, the phone walks one escrow job to payout, the escrow diagram
   plays the same job in four beats, and the role tabs advance on their own.
   Everything settles to a still, readable page with reduced motion. */
(() => {
  const root = document.querySelector("#screen-landing .lp");
  if (!root) return;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const active = () => root.parentElement.classList.contains("active");
  const visible = new Set(); // elements on screen right now, so loops only run while watched

  /* ---------- static content ---------- */
  const ROW1 = ["Electricians", "Masons", "Plumbers", "Carpenters", "Welders", "Painters", "Tilers", "Steel benders", "Roofers", "AC technicians", "Aluminium fabricators", "POP ceilings"];
  const ROW2 = ["Surveyors", "Architects", "Site engineers", "Excavator operators", "Truck drivers", "Cement suppliers", "Sand and quarry dust", "Block makers", "PPE suppliers", "Solar installers", "Interior designers", "Landscapers"];
  const row = (list) => { const h = list.map((t) => `<span>${t}</span>`).join(""); return h + h; }; // doubled so the marquee loops without a seam
  $("#lpTicker").innerHTML = row(ROW1);
  $("#lpTicker2").innerHTML = row(ROW2);
  $("#lpYear").textContent = new Date().getFullYear();
  $$("[data-seal]").forEach((el) => { el.innerHTML = window.BX?.badge(el.dataset.seal, 40) || ""; });

  // wrap each word of a heading so it can rise in; keeps inline spans (the gold words) styled
  $$("[data-split]").forEach((h) => {
    let i = 0;
    const words = (text, cls) => text.split(/(\s+)/).map((w) => (/^\s+$/.test(w) || !w ? w : `<span class="lp-sw"><span class="lp-w ${cls}" style="--i:${i++}">${w}</span></span>`)).join("");
    h.innerHTML = [...h.childNodes].map((n) => (n.nodeType === 3 ? words(n.textContent, "") : words(n.textContent, n.className || ""))).join("");
  });

  /* ---------- clicks: in-page links and role tabs ---------- */
  const tabs = $(".lp-roles");
  function showRole(tab) {
    $$("#lpTabs .tab").forEach((t) => { t.classList.toggle("on", t === tab); t.setAttribute("aria-selected", t === tab); });
    $$(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === tab.dataset.role));
  }
  root.addEventListener("click", (e) => {
    const a = e.target.closest("[data-lp-jump]");
    if (a) { e.preventDefault(); root.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" }); return; }
    const tab = e.target.closest("#lpTabs .tab");
    if (tab) { tabs.classList.remove("auto"); clearInterval(roleTimer); showRole(tab); } // the visitor took over
  });

  /* ---------- scroll: bar state and reading progress ---------- */
  const bar = $("#lpBar"), prog = $("#lpProg");
  let ticking = false;
  addEventListener("scroll", () => {
    if (!active() || ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      bar.classList.toggle("scrolled", scrollY > 8);
      const max = document.documentElement.scrollHeight - innerHeight;
      prog.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    });
  }, { passive: true });

  /* ---------- reveals and counters ---------- */
  function count(el) {
    const end = +el.dataset.count, suf = el.dataset.suffix || "";
    if (calm || !end) { el.textContent = end + suf; return; }
    const t0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  const seen = (el) => { el.classList.add("lp-in"); el.querySelectorAll("[data-count]").forEach(count); };
  const targets = $$("[data-rv], [data-split], #lpSteps, #lpFlow, .lp-ps .col");
  if ("IntersectionObserver" in window && !calm) {
    const io = new IntersectionObserver((list) => list.forEach((x) => { if (x.isIntersecting) { seen(x.target); io.unobserve(x.target); } }), { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    targets.forEach((el) => io.observe(el));
    const watch = new IntersectionObserver((list) => list.forEach((x) => (x.isIntersecting ? visible.add(x.target) : visible.delete(x.target))));
    [$(".lp-phone"), $("#lpFlow"), tabs].forEach((el) => watch.observe(el));
  } else {
    targets.forEach(seen);
    [$(".lp-phone"), $("#lpFlow"), tabs].forEach((el) => visible.add(el));
  }
  const running = (el) => active() && !document.hidden && visible.has(el);

  /* ---------- hero phone: one job from funded to paid, then again ---------- */
  const steps = $$("#phSteps .ph-step"), status = $("#phStatus"), btn = $("#phBtn");
  const amt = $("#phAmt"), amtL = $("#phAmtL"), amtV = $("#phAmtV"), phBar = $("#phBar"), toast = $("#phToast");
  let at = 1;
  function money(to, from) {
    if (calm) { amtV.textContent = `GH₵${to.toFixed(2)}`; return; }
    const t0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - t0) / 1100), v = from + (to - from) * (1 - Math.pow(1 - k, 3)); amtV.textContent = `GH₵${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function paintPhone() {
    steps.forEach((s, i) => { s.classList.toggle("done", i < at); s.classList.toggle("now", i === at); });
    const paid = at >= steps.length;
    status.textContent = paid ? "Paid" : at === 3 ? "Releasing" : "Held";
    status.classList.toggle("paid", paid);
    btn.textContent = paid ? "Done" : at === 3 ? "Releasing payment" : at === 2 ? "Approve and release" : "Waiting for the work";
    if (at === 3) { btn.classList.remove("press"); void btn.offsetWidth; btn.classList.add("press"); }
    amt.classList.toggle("out", paid);
    amtL.textContent = paid ? "Released to Kwame" : "In escrow";
    phBar.style.width = at === 3 ? "35%" : paid ? "100%" : "100%";
    toast.classList.toggle("on", paid);
    if (paid) money(900, 0); else if (at === 1) money(900, 900);
  }
  paintPhone();
  if (!calm) setInterval(() => { if (!running($(".lp-phone"))) return; at = at >= steps.length ? 1 : at + 1; paintPhone(); }, 2400);

  /* ---------- escrow diagram: fund, hold, approve, release, paid ---------- */
  const flow = $("#lpFlow"), say = $("#flowSay"), dots = $$("#flowDots i");
  const BEATS = ["The client funds the job", "BAID X holds the money", "The client approves the work", "The money is released", "The worker is paid"];
  const DOT = [0, 1, 2, 3, 3];
  let beat = 0;
  function paintFlow() {
    flow.dataset.stage = beat;
    say.textContent = BEATS[beat];
    say.style.animation = "none"; void say.offsetWidth; say.style.animation = "";
    dots.forEach((d, i) => { d.classList.toggle("done", i < DOT[beat] || (beat === 4 && i === 3)); d.classList.toggle("on", i === DOT[beat] && beat !== 4); });
  }
  if (calm) { flow.dataset.stage = 2; say.textContent = "Funded, held, approved, released"; dots.forEach((d) => d.classList.add("done")); }
  else { paintFlow(); setInterval(() => { if (!running(flow)) return; beat = (beat + 1) % BEATS.length; paintFlow(); }, 2200); }

  /* ---------- roles advance on their own until the visitor picks one ---------- */
  let roleTimer = 0;
  if (!calm) {
    tabs.classList.add("auto");
    roleTimer = setInterval(() => {
      if (!running(tabs) || tabs.matches(":hover")) return;
      const all = $$("#lpTabs .tab"), cur = all.findIndex((t) => t.classList.contains("on"));
      const next = all[(cur + 1) % all.length];
      showRole(next);
      next.classList.remove("on"); void next.offsetWidth; next.classList.add("on"); // restart the timer line
    }, 6000);
  }

  /* ---------- pointer: hero glow, card light, magnetic buttons ---------- */
  if (fine && !calm) {
    const hero = $("#lpHero");
    hero.addEventListener("pointermove", (e) => { const r = hero.getBoundingClientRect(); hero.style.setProperty("--mx", `${e.clientX - r.left}px`); hero.style.setProperty("--my", `${e.clientY - r.top}px`); });
    root.addEventListener("pointermove", (e) => {
      const c = e.target.closest(".lp-feat, .lp-badge, .lp-ps .col");
      if (c) { const r = c.getBoundingClientRect(); c.style.setProperty("--x", `${e.clientX - r.left}px`); c.style.setProperty("--y", `${e.clientY - r.top}px`); }
    });
    $$(".btn.primary").forEach((b) => {
      b.addEventListener("pointermove", (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.15}px, ${(e.clientY - r.top - r.height / 2) * 0.25}px)`; });
      b.addEventListener("pointerleave", () => { b.style.transform = ""; });
    });
  }
})();
