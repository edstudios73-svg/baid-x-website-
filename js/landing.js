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
})();
