/* BAID X landing page for signed-out visitors: in-page links and the bar's
   bottom line once the page scrolls. Nothing moves on its own. */
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

  addEventListener("scroll", () => {
    if (root.parentElement.classList.contains("active")) bar.classList.toggle("scrolled", scrollY > 8);
  }, { passive: true });
})();
