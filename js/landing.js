/* BAID X landing page for signed-out visitors.
   The page is told through scroll: a pinned particle field morphs through five
   shapes (the BAID X mark, a seal, a network globe, a shield, a cedi coin), the
   badge tiers assemble into one verified card, and the account types travel
   sideways. Loops pause off screen; reduced motion gets a still, readable page. */
(() => {
  const root = document.querySelector("#screen-landing .lp");
  if (!root) return;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const active = () => root.parentElement.classList.contains("active");
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const visible = new Set(); // sections on screen right now; loops only run for these

  /* ---------- static content ---------- */
  const ROW1 = ["Electricians", "Masons", "Plumbers", "Carpenters", "Welders", "Painters", "Tilers", "Roofers", "Steel benders"];
  const ROW2 = ["Surveyors", "Architects", "Site engineers", "Excavators", "Cement", "Sand and quarry dust", "Blocks", "PPE", "Solar"];
  const row = (list) => { const h = list.map((t) => `<span>${t}</span>`).join(""); return h + h; }; // doubled so the loop has no seam
  $("#lpMega1").innerHTML = row(ROW1);
  $("#lpMega2").innerHTML = row(ROW2);
  $("#lpYear").textContent = new Date().getFullYear();
  $$("[data-seal]").forEach((el) => { el.innerHTML = window.BX?.badge(el.dataset.seal, el.closest(".seals") ? 24 : 26) || ""; });

  // wrap each word of a heading so it can rise in; inline spans keep their class
  $$("[data-split]").forEach((h) => {
    let i = 0;
    const words = (text, cls) => text.split(/(\s+)/).map((w) => (/^\s+$/.test(w) || !w ? w : `<span class="lp-sw"><span class="lp-w ${cls}" style="--i:${i++}">${w}</span></span>`)).join("");
    h.innerHTML = [...h.childNodes].map((n) => (n.nodeType === 3 ? words(n.textContent, "") : words(n.textContent, n.className || ""))).join("");
  });

  root.addEventListener("click", (e) => {
    const a = e.target.closest("[data-lp-jump]");
    if (!a) return;
    e.preventDefault(); // scroll within the page instead of changing the app's hash route
    root.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  });

  /* ---------- reveals and counters ---------- */
  function count(el) {
    const end = +el.dataset.count, suf = el.dataset.suffix || "";
    if (calm || !end) { el.textContent = end + suf; return; }
    const t0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  const seen = (el) => { el.classList.add("lp-in"); el.querySelectorAll("[data-count]").forEach(count); };
  const targets = $$("[data-rv], [data-split], .lp-ps .col");
  const loops = [$("#lpStory"), $(".lp-mega"), $(".lp-phone"), $("#lpStack"), $("#lpHz")];
  if ("IntersectionObserver" in window && !calm) {
    const io = new IntersectionObserver((list) => list.forEach((x) => { if (x.isIntersecting) { seen(x.target); io.unobserve(x.target); } }), { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    targets.forEach((el) => io.observe(el));
    const watch = new IntersectionObserver((list) => list.forEach((x) => (x.isIntersecting ? visible.add(x.target) : visible.delete(x.target))));
    loops.forEach((el) => watch.observe(el));
  } else {
    targets.forEach(seen);
    loops.forEach((el) => visible.add(el));
  }
  const running = (el) => active() && !document.hidden && visible.has(el);

  /* ---------- particle field ---------- */
  const story = $("#lpStory"), canvas = $("#lpField"), ctx = canvas.getContext("2d");
  const small = innerWidth < 700;
  const N = small ? 1300 : 2400;
  const SHAPES = 5;
  const shapes = []; // per shape: Float32Array of x, y, z in unit space
  const golds = new Float32Array(N * 4), whites = new Float32Array(N * 4); // reused every frame, no garbage
  const tint = new Uint8Array(N), seed = new Float32Array(N), ox = new Float32Array(N), oy = new Float32Array(N);
  for (let i = 0; i < N; i++) { tint[i] = Math.random() < 0.28 ? 1 : 0; seed[i] = Math.random(); }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // pixels of an offscreen drawing become points
  function sample(draw, keep) {
    const S = 180, c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d", { willReadFrequently: true });
    draw(g, S);
    const d = g.getImageData(0, 0, S, S).data, pts = [];
    for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) { const k = (y * S + x) * 4; if (keep(d[k], d[k + 1], d[k + 2], d[k + 3])) pts.push([(x / S) * 2 - 1, 1 - (y / S) * 2]); }
    return pts;
  }
  function fill(list, thick) {
    const out = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const p = list.length ? list[(Math.random() * list.length) | 0] : [0, 0, 0];
      out[i * 3] = p[0] + rnd(-0.006, 0.006); out[i * 3 + 1] = p[1] + rnd(-0.006, 0.006); out[i * 3 + 2] = p.length > 2 ? p[2] : rnd(-thick, thick);
    }
    return out;
  }
  const ring = (n, r, z = 0, wob = 0) => Array.from({ length: n }, () => { const a = Math.random() * Math.PI * 2, rr = r + wob * Math.sin(a * 18); return [Math.cos(a) * rr, Math.sin(a) * rr, z]; });
  const line = (n, pts, w) => {
    const out = [], segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(l); total += l; }
    for (let k = 0; k < n; k++) {
      let t = Math.random() * total, i = 0;
      while (t > segs[i] && i < segs.length - 1) { t -= segs[i]; i++; }
      const f = t / segs[i], a = pts[i], b = pts[i + 1];
      out.push([a[0] + (b[0] - a[0]) * f + rnd(-w, w), a[1] + (b[1] - a[1]) * f + rnd(-w, w)]);
    }
    return out;
  };

  function buildShapes(mark) {
    // 0: the BAID X tools mark, from the favicon's dark pixels
    shapes[0] = fill(mark && mark.length ? mark.map(([x, y]) => [x * 1.05, y * 1.05]) : ring(900, 0.8), 0.07);
    // 1: a verification seal with a tick
    shapes[1] = fill([...ring(700, 0.92, 0, 0.035), ...ring(300, 0.74), ...line(900, [[-0.42, 0.02], [-0.12, -0.3], [0.44, 0.32]], 0.05)], 0.06);
    // 2: the network: a globe of members with orbit rings
    const globe = [], gold = 2.399963;
    for (let i = 0; i < 1200; i++) { const y = 1 - (i / 1199) * 2, r = Math.sqrt(1 - y * y), th = gold * i; globe.push([Math.cos(th) * r * 0.82, y * 0.82, Math.sin(th) * r * 0.82]); }
    const orbit = (tilt, n) => Array.from({ length: n }, () => { const a = Math.random() * Math.PI * 2, x = Math.cos(a) * 1.08, z = Math.sin(a) * 1.08; return [x, z * Math.sin(tilt), z * Math.cos(tilt)]; });
    shapes[2] = fill([...globe, ...orbit(0.45, 260), ...orbit(-0.9, 260)], 0);
    // 3: escrow: a shield, dense outline and a soft fill
    const sh = [[-0.72, 0.78], [0, 0.98], [0.72, 0.78], [0.72, 0.1], [0.5, -0.45], [0, -0.98], [-0.5, -0.45], [-0.72, 0.1], [-0.72, 0.78]];
    const inside = (x, y) => { let c = false; for (let i = 0, j = sh.length - 1; i < sh.length; j = i++) { const [xi, yi] = sh[i], [xj, yj] = sh[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const soft = []; while (soft.length < 700) { const x = rnd(-0.72, 0.72), y = rnd(-0.98, 0.98); if (inside(x, y) && Math.random() < 0.55) soft.push([x * 0.86, y * 0.86]); }
    shapes[3] = fill([...line(1100, sh, 0.02), ...soft, ...line(500, [[-0.3, 0.02], [-0.06, -0.22], [0.34, 0.24]], 0.04)], 0.05);
    // 4: payout: a cedi coin with a rim that has real depth
    const cedi = sample((g, S) => { g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `800 ${S * 0.62}px Inter, Arial, sans-serif`; g.fillText("₵", S / 2, S / 2 + S * 0.03); }, (r, gg, b, a) => a > 128);
    shapes[4] = fill([...cedi.map(([x, y]) => [x * 0.92, y * 0.92, rnd(-0.04, 0.04)]), ...ring(500, 0.96, 0.08), ...ring(500, 0.96, -0.08), ...ring(260, 0.84, 0)], 0.03);
  }

  // where every particle starts: a wide scattered cloud that pulls in on load
  const start = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, b = Math.acos(rnd(-1, 1)), r = rnd(1.6, 3.4); start[i * 3] = Math.sin(b) * Math.cos(a) * r; start[i * 3 + 1] = Math.sin(b) * Math.sin(a) * r; start[i * 3 + 2] = Math.cos(b) * r; }

  let W = 0, H = 0, dpr = 1;
  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  size();

  let progress = 0, chapter = -1, t0 = performance.now(), mx = -9999, my = -9999;
  const chs = $$(".lp-story .ch"), count01 = $("#lpCount"), railFill = $("#lpRailFill");
  function setChapter(c) {
    if (c === chapter) return;
    chapter = c;
    chs.forEach((el, i) => el.classList.toggle("on", i === c));
    count01.textContent = `0${c + 1}`;
    story.classList.toggle("past-intro", c > 0);
  }
  setChapter(0);

  function frame(now) {
    requestAnimationFrame(frame);
    if (!shapes.length || !running(story)) return;
    const time = (now - t0) / 1000;
    const intro = calm ? 1 : clamp(time / 2.2);
    const s = clamp(progress * SHAPES - 0.5, 0, SHAPES - 1); // shape position: 0..4, holding each shape mid-chapter
    const a = Math.min(SHAPES - 2, Math.floor(s)), local = s - a;
    const A = shapes[a], B = shapes[a + 1];
    const globeW = clamp(1 - Math.abs(s - 2)); // the globe keeps turning on its own
    const spin = calm ? 0 : (a + ease(clamp((local - 0.2) / 0.6))) * Math.PI * 2 * 0.5;
    const ry = spin + (calm ? 0 : Math.sin(time * 0.5) * 0.28 * (1 - globeW) + time * 0.35 * globeW);
    const rx = calm ? 0.12 * globeW : 0.18 * globeW + Math.sin(time * 0.35) * 0.06;
    const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    const wide = W >= 900;
    const R = wide ? Math.min(W * 0.22, H * 0.34) : Math.min(W * 0.4, H * 0.24);
    const ox0 = wide ? W * 0.7 : W * 0.5, oy0 = wide ? H * 0.5 : H * 0.33;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    let ng = 0, nw = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 3, d = seed[i];
      const m = ease(clamp((local - 0.22 - d * 0.18) / 0.4)); // particles leave at slightly different moments
      let x = A[k] + (B[k] - A[k]) * m, y = A[k + 1] + (B[k + 1] - A[k + 1]) * m, z = A[k + 2] + (B[k + 2] - A[k + 2]) * m;
      // mid-morph the cloud swells outward, so the change reads as a burst
      const burst = Math.sin(m * Math.PI) * (0.18 + d * 0.3);
      x *= 1 + burst; y *= 1 + burst; z += burst * (d - 0.5) * 1.4;
      if (intro < 1) { const q = ease(clamp((intro - d * 0.35) / 0.65)); x = start[k] + (x - start[k]) * q; y = start[k + 1] + (y - start[k + 1]) * q; z = start[k + 2] + (z - start[k + 2]) * q; }
      if (!calm) { x += Math.sin(time * 1.3 + d * 40) * 0.006; y += Math.cos(time * 1.1 + d * 30) * 0.006; }
      // rotate: Y then X
      let X = x * cy + z * sy, Z = -x * sy + z * cy;
      const Y = y * cx - Z * sx; Z = y * sx + Z * cx;
      const persp = 2.6 / (2.6 + Z);
      let px = ox0 + X * R * persp, py = oy0 - Y * R * persp;
      // the pointer pushes particles aside, and they spring back
      const dx = px - mx, dy = py - my, dist2 = dx * dx + dy * dy;
      if (dist2 < 8100) { const f = (1 - Math.sqrt(dist2) / 90) * 26; const n = Math.sqrt(dist2) || 1; ox[i] += (dx / n) * f * 0.2; oy[i] += (dy / n) * f * 0.2; }
      ox[i] *= 0.9; oy[i] *= 0.9; px += ox[i]; py += oy[i];
      const sz = (wide ? 1.7 : 1.45) * persp, alpha = clamp(0.25 + (1 - Z) * 0.5, 0.15, 1);
      const buf = tint[i] ? whites : golds, o = tint[i] ? nw : ng;
      buf[o] = px; buf[o + 1] = py; buf[o + 2] = sz; buf[o + 3] = alpha;
      if (tint[i]) nw += 4; else ng += 4;
    }
    const paint = (arr, len, rgb) => { for (let j = 0; j < len; j += 4) { ctx.globalAlpha = arr[j + 3]; ctx.fillStyle = rgb; ctx.fillRect(arr[j] - arr[j + 2] / 2, arr[j + 1] - arr[j + 2] / 2, arr[j + 2], arr[j + 2]); } };
    ctx.globalCompositeOperation = "lighter";
    paint(golds, ng, "#e8d9a8"); paint(whites, nw, "#ffffff");
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  }
  const img = new Image();
  img.onload = () => buildShapes(sample((g, S) => g.drawImage(img, 0, 0, S, S), (r, g, b, a) => a > 128 && r + g + b < 300));
  img.onerror = () => buildShapes(null);
  img.src = "assets/favicon.png";
  requestAnimationFrame(frame);
  if (fine) {
    canvas.parentElement.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
    canvas.parentElement.addEventListener("pointerleave", () => { mx = my = -9999; });
  } else {
    canvas.parentElement.addEventListener("touchmove", (e) => { const r = canvas.getBoundingClientRect(), t = e.touches[0]; mx = t.clientX - r.left; my = t.clientY - r.top; }, { passive: true });
    canvas.parentElement.addEventListener("touchend", () => { mx = my = -9999; });
  }

  /* ---------- trust stack and sideways roles ---------- */
  const stack = $("#lpStack"), checks = $$("#lpChecks li");
  const hz = $("#lpHz"), track = $("#lpTrack"), hzFill = $("#lpHzFill");
  let hzTravel = 0;
  function layoutHz() {
    if (calm) return;
    hzTravel = Math.max(0, track.scrollWidth - innerWidth);
    hz.style.height = `${hzTravel + innerHeight}px`; // one pixel down moves the cards one pixel across
  }
  const through = (el) => { const r = el.getBoundingClientRect(), span = r.height - innerHeight; return span > 0 ? clamp(-r.top / span) : 0; };

  /* ---------- scroll: one handler drives every scroll-linked piece ---------- */
  const bar = $("#lpBar"), prog = $("#lpProg"), mega = $$(".lp-mega .line");
  let ticking = false, lastY = scrollY, vel = 0, megaX = 0;
  function onScroll() {
    if (!active()) return;
    bar.classList.toggle("scrolled", scrollY > 8);
    const max = document.documentElement.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max) : 0})`;
    progress = through(story);
    setChapter(Math.min(SHAPES - 1, Math.floor(progress * SHAPES)));
    railFill.style.transform = `scaleY(${progress})`;
    const sp = through(stack);
    stack.style.setProperty("--p", ease(clamp((sp - 0.1) / 0.75)).toFixed(4));
    checks.forEach((li, i) => li.classList.toggle("on", sp > 0.12 + i * 0.18));
    if (!calm) { const hp = through(hz); track.style.transform = `translate3d(${-hp * hzTravel}px,0,0)`; hzFill.style.transform = `scaleX(${hp})`; }
  }
  addEventListener("scroll", () => {
    vel += scrollY - lastY; lastY = scrollY;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  }, { passive: true });

  // the trade marquee drifts on its own and speeds up with the scroll
  function megaFrame() {
    requestAnimationFrame(megaFrame);
    if (calm || !running($(".lp-mega"))) { vel = 0; return; }
    megaX += 0.6 + Math.min(40, Math.abs(vel)) * 0.35;
    vel *= 0.85;
    mega.forEach((el, i) => { const half = el.scrollWidth / 2 || 1, x = megaX % half; el.style.transform = `translate3d(${i ? x - half : -x}px,0,0)`; });
  }
  requestAnimationFrame(megaFrame);
  layoutHz(); onScroll();
  // the landing is hidden until the app routes to it, and fonts and rotation change sizes: measure whenever it resizes
  const remeasure = () => { size(); layoutHz(); onScroll(); };
  if ("ResizeObserver" in window) new ResizeObserver(remeasure).observe(root); else addEventListener("resize", remeasure);
  document.fonts?.ready.then(remeasure);

  /* ---------- escrow phone: one job from funded to paid, then again ---------- */
  const steps = $$("#phSteps .ph-step"), status = $("#phStatus"), btn = $("#phBtn");
  const amt = $("#phAmt"), amtL = $("#phAmtL"), amtV = $("#phAmtV"), phBar = $("#phBar"), toast = $("#phToast");
  let at = 1;
  function money(to, from) {
    if (calm) { amtV.textContent = `GH₵${to.toFixed(2)}`; return; }
    const s0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - s0) / 1100), v = from + (to - from) * (1 - Math.pow(1 - k, 3)); amtV.textContent = `GH₵${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; if (k < 1) requestAnimationFrame(tick); };
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
    phBar.style.width = at === 3 ? "35%" : "100%";
    toast.classList.toggle("on", paid);
    if (paid) money(900, 0); else if (at === 1) money(900, 900);
  }
  paintPhone();
  if (!calm) setInterval(() => { if (!running($(".lp-phone"))) return; at = at >= steps.length ? 1 : at + 1; paintPhone(); }, 2400);

  /* ---------- pointer: card light and magnetic buttons ---------- */
  if (fine && !calm) {
    root.addEventListener("pointermove", (e) => {
      const c = e.target.closest(".lp-feat, .lp-ps .col, .lp-hz .rc");
      if (c) { const r = c.getBoundingClientRect(); c.style.setProperty("--x", `${e.clientX - r.left}px`); c.style.setProperty("--y", `${e.clientY - r.top}px`); }
    });
    $$(".btn.primary").forEach((b) => {
      b.addEventListener("pointermove", (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.15}px, ${(e.clientY - r.top - r.height / 2) * 0.25}px)`; });
      b.addEventListener("pointerleave", () => { b.style.transform = ""; });
    });
  }
})();
