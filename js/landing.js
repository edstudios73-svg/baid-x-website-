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

  /* ---------- the field: a glowing point network drawn with WebGL ---------- */
  const story = $("#lpStory"), canvas = $("#lpField");
  const small = innerWidth < 700;
  const N = small ? 4200 : 7500;      // points that form the shapes
  const M = small ? 260 : 440;        // the first M points are also network nodes that carry lines
  const D = small ? 120 : 220;        // background nodes drifting behind the shape
  const P = small ? 34 : 60;          // light pulses running along the lines
  const LINKS = 3;
  const SHAPES = 5;
  const shapes = []; // per shape: Float32Array of x, y, z in unit space
  const rnd = (a, b) => a + Math.random() * (b - a);
  const seed = new Float32Array(N), slot = new Uint8Array(N), ox = new Float32Array(N), oy = new Float32Array(N);
  for (let i = 0; i < N; i++) { seed[i] = Math.random(); const r = Math.random(); slot[i] = r < 0.45 ? 0 : r < 0.8 ? 1 : 2; }
  // one palette per chapter, taken from the badge colours: mark, verified, connected, protected, paid
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const PAL = [["#c7e9ff", "#ffffff", "#7dd3fc"], ["#38bdf8", "#7dd3fc", "#e0f4ff"], ["#a78bfa", "#38bdf8", "#ede9fe"], ["#34d399", "#a7f3d0", "#ecfdf5"], ["#e8c46a", "#fff1c4", "#ffffff"]].map((p) => p.map(hex));

  // pixels of an offscreen drawing become points
  function sample(draw, keep) {
    const S = 200, c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d", { willReadFrequently: true });
    draw(g, S);
    const d = g.getImageData(0, 0, S, S).data, pts = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = (y * S + x) * 4; if (keep(d[k], d[k + 1], d[k + 2], d[k + 3])) pts.push([(x / S) * 2 - 1, 1 - (y / S) * 2]); }
    return pts;
  }
  // spread N points over weighted parts of a shape
  function compose(parts, thick) {
    const out = new Float32Array(N * 3), total = parts.reduce((t, p) => t + p[0], 0);
    for (let i = 0; i < N; i++) {
      let r = Math.random() * total, part = parts[0];
      for (const p of parts) { if (r < p[0]) { part = p; break; } r -= p[0]; }
      const list = part[1], q = list.length ? list[(Math.random() * list.length) | 0] : [0, 0];
      out[i * 3] = q[0] + rnd(-0.004, 0.004); out[i * 3 + 1] = q[1] + rnd(-0.004, 0.004); out[i * 3 + 2] = q.length > 2 ? q[2] : rnd(-thick, thick);
    }
    return out;
  }
  const ring = (n, r0, r1 = r0, z = 0, wob = 0) => Array.from({ length: n }, () => { const a = Math.random() * Math.PI * 2, rr = rnd(r0, r1) + wob * Math.sin(a * 18); return [Math.cos(a) * rr, Math.sin(a) * rr, z]; });
  const disc = (n, r) => Array.from({ length: n }, () => { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r; return [Math.cos(a) * rr, Math.sin(a) * rr]; });
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
    // 0: the BAID X tools mark, filled from the favicon's dark pixels
    shapes[0] = compose([[1, mark && mark.length ? mark.map(([x, y]) => [x * 1.06, y * 1.06]) : ring(900, 0.6, 0.8)]], 0.09);
    // 1: a verification seal: a scalloped band, a faint face and a bold tick
    shapes[1] = compose([[0.42, ring(4000, 0.78, 0.95, 0, 0.03)], [0.14, disc(2000, 0.72)], [0.44, line(4000, [[-0.42, 0.02], [-0.12, -0.3], [0.44, 0.32]], 0.075)]], 0.07);
    // 2: the network: a dense globe with two orbit rings
    const globe = [], ga = 2.399963, G = 5000;
    for (let i = 0; i < G; i++) { const y = 1 - (i / (G - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i; globe.push([Math.cos(th) * r * 0.8, y * 0.8, Math.sin(th) * r * 0.8]); }
    const orbit = (tilt, n) => Array.from({ length: n }, () => { const a = Math.random() * Math.PI * 2, x = Math.cos(a) * 1.06, z = Math.sin(a) * 1.06; return [x, z * Math.sin(tilt), z * Math.cos(tilt)]; });
    shapes[2] = compose([[0.76, globe], [0.12, orbit(0.45, 1500)], [0.12, orbit(-0.9, 1500)]], 0);
    // 3: escrow: a shield with a solid body, a bright edge and a tick
    const sh = [[-0.72, 0.78], [0, 0.98], [0.72, 0.78], [0.72, 0.1], [0.5, -0.45], [0, -0.98], [-0.5, -0.45], [-0.72, 0.1], [-0.72, 0.78]];
    const inside = (x, y) => { let c = false; for (let i = 0, j = sh.length - 1; i < sh.length; j = i++) { const [xi, yi] = sh[i], [xj, yj] = sh[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const body = []; while (body.length < 4000) { const x = rnd(-0.72, 0.72), y = rnd(-0.98, 0.98); if (inside(x, y)) body.push([x * 0.9, y * 0.9]); }
    shapes[3] = compose([[0.38, line(4000, sh, 0.022)], [0.42, body], [0.2, line(3000, [[-0.3, 0.02], [-0.06, -0.22], [0.34, 0.24]], 0.05)]], 0.06);
    // 4: payout: a cedi coin with a thick rim, a face and the glyph
    const cedi = sample((g, S) => { g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `800 ${S * 0.62}px Inter, Arial, sans-serif`; g.fillText("₵", S / 2, S / 2 + S * 0.03); }, (r, gg, b, a) => a > 128);
    const rim = Array.from({ length: 4000 }, () => { const a = Math.random() * Math.PI * 2, r = rnd(0.9, 0.98); return [Math.cos(a) * r, Math.sin(a) * r, rnd(-0.11, 0.11)]; });
    shapes[4] = compose([[0.42, cedi.map(([x, y]) => [x * 0.86, y * 0.86, rnd(-0.05, 0.05)])], [0.38, rim], [0.2, disc(3000, 0.88).map(([x, y]) => [x, y, rnd(-0.02, 0.02)])]], 0.03);
  }

  // where every point starts: a wide cloud that pulls in on load
  const start = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, b = Math.acos(rnd(-1, 1)), r = rnd(1.6, 3.6); start[i * 3] = Math.sin(b) * Math.cos(a) * r; start[i * 3 + 1] = Math.sin(b) * Math.sin(a) * r; start[i * 3 + 2] = Math.cos(b) * r; }
  // background nodes: slow drift across the whole stage
  const bg = new Float32Array(D * 4);
  for (let i = 0; i < D; i++) { bg[i * 4] = Math.random(); bg[i * 4 + 1] = Math.random(); bg[i * 4 + 2] = rnd(-1, 1) * 0.00012; bg[i * 4 + 3] = rnd(-1, 1) * 0.00012; }

  // screen positions this frame, for lines and pulses
  const sx = new Float32Array(N), sy2 = new Float32Array(N), sz = new Float32Array(N);
  const nbr = new Int32Array(M * LINKS).fill(-1);
  const pulses = Array.from({ length: P }, () => ({ a: (Math.random() * M) | 0, b: -1, t: Math.random(), v: rnd(0.012, 0.03) }));

  /* renderer: WebGL with additive glow, or a plain 2D canvas when WebGL is missing */
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "high-performance" });
  const PSTRIDE = 7, LSTRIDE = 6;
  const MAXP = N + D + P * 2, MAXL = (M * LINKS + D * LINKS + 24) * 2;
  const pts = new Float32Array(MAXP * PSTRIDE), lns = new Float32Array(MAXL * LSTRIDE);
  let ctx2 = null, progPts, progLns, bufPts, bufLns, uResP, uResL;
  if (gl) {
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
    progPts = prog(`attribute vec2 p; attribute float s; attribute vec4 c; uniform vec2 r; varying vec4 vc;
      void main(){ gl_Position = vec4(p / r * 2.0 - 1.0, 0.0, 1.0); gl_Position.y *= -1.0; gl_PointSize = s; vc = c; }`,
      `precision mediump float; varying vec4 vc;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a * 0.7 + smoothstep(0.18, 0.0, d) * 0.6; gl_FragColor = vec4(vc.rgb * a * vc.a, a * vc.a); }`);
    progLns = prog(`attribute vec2 p; attribute vec4 c; uniform vec2 r; varying vec4 vc;
      void main(){ gl_Position = vec4(p / r * 2.0 - 1.0, 0.0, 1.0); gl_Position.y *= -1.0; vc = c; }`,
      `precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vec4(vc.rgb * vc.a, vc.a); }`);
    bufPts = gl.createBuffer(); bufLns = gl.createBuffer();
    uResP = gl.getUniformLocation(progPts, "r"); uResL = gl.getUniformLocation(progLns, "r");
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); // additive: dense areas glow solid
  } else ctx2 = canvas.getContext("2d");

  let W = 0, H = 0, dpr = 1;
  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
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
    story.dataset.ch = c;
  }
  setChapter(0);

  // grid buckets for finding near neighbours in screen space
  const cellOf = new Int32Array(Math.max(M, D)), head = new Int32Array(4096), next = new Int32Array(Math.max(M, D));
  function link(count, X, Y, maxD, cap, out, emit) {
    head.fill(-1);
    const cs = maxD, cols = Math.max(1, Math.ceil(W / cs) + 2);
    for (let i = 0; i < count; i++) { const cx = Math.floor(X(i) / cs) + 1, cy = Math.floor(Y(i) / cs) + 1, c = ((cy * cols + cx) % 4096 + 4096) % 4096; cellOf[i] = c; next[i] = head[c]; head[c] = i; }
    const m2 = maxD * maxD;
    for (let i = 0; i < count; i++) {
      let n = 0;
      const xi = X(i), yi = Y(i), cx = Math.floor(xi / cs) + 1, cy = Math.floor(yi / cs) + 1;
      for (let gy = -1; gy <= 1 && n < cap; gy++) for (let gx = -1; gx <= 1 && n < cap; gx++) {
        let j = head[(((cy + gy) * cols + cx + gx) % 4096 + 4096) % 4096];
        while (j !== -1 && n < cap) {
          if (j > i) { const dx = X(j) - xi, dy = Y(j) - yi, d2 = dx * dx + dy * dy; if (d2 < m2) { if (out) out[i * cap + n] = j; n++; emit(i, j, 1 - Math.sqrt(d2) / maxD); } }
          j = next[j];
        }
      }
      if (out) for (let k = n; k < cap; k++) out[i * cap + k] = -1;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!shapes.length || !running(story) || !W) return;
    const time = (now - t0) / 1000;
    const intro = calm ? 1 : clamp(time / 2.4);
    const s = clamp(progress * SHAPES - 0.5, 0, SHAPES - 1); // shape position: 0..4, holding each shape mid-chapter
    const a = Math.min(SHAPES - 2, Math.floor(s)), local = s - a;
    const A = shapes[a], B = shapes[a + 1], PA = PAL[a], PB = PAL[a + 1];
    const morph = ease(clamp((local - 0.2) / 0.6));
    const settled = 1 - Math.sin(morph * Math.PI); // 1 when a shape is whole, 0 mid-change
    const globeW = clamp(1 - Math.abs(s - 2));
    const spin = calm ? 0 : (a + morph) * Math.PI * 2; // a full turn per change, so every shape lands facing forward
    const ry = spin + (calm ? 0 : Math.sin(time * 0.5) * 0.3 * (1 - globeW) + time * 0.35 * globeW);
    const rx = calm ? 0.12 * globeW : 0.2 * globeW + Math.sin(time * 0.35) * 0.07;
    const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);
    const wide = W >= 900;
    const R = wide ? Math.min(W * 0.23, H * 0.36) : Math.min(W * 0.42, H * 0.25);
    const ox0 = wide ? W * 0.7 : W * 0.5, oy0 = wide ? H * 0.5 : H * 0.33;
    const base = (wide ? 2.4 : 2.1) * dpr;
    let np = 0;
    const put = (x, y, size, c, al) => { const o = np * PSTRIDE; pts[o] = x * dpr; pts[o + 1] = y * dpr; pts[o + 2] = size; pts[o + 3] = c[0]; pts[o + 4] = c[1]; pts[o + 5] = c[2]; pts[o + 6] = al; np++; };

    // background network
    const bgc = [PA[0][0] + (PB[0][0] - PA[0][0]) * morph, PA[0][1] + (PB[0][1] - PA[0][1]) * morph, PA[0][2] + (PB[0][2] - PA[0][2]) * morph];
    for (let i = 0; i < D; i++) {
      const k = i * 4;
      if (!calm) { bg[k] = (bg[k] + bg[k + 2] + 1) % 1; bg[k + 1] = (bg[k + 1] + bg[k + 3] + 1) % 1; }
      put(bg[k] * W, bg[k + 1] * H, 2.2 * dpr, bgc, 0.35);
    }
    // shape points
    for (let i = 0; i < N; i++) {
      const k = i * 3, d = seed[i];
      const m = ease(clamp((local - 0.2 - d * 0.2) / 0.4)); // points leave at slightly different moments
      let x = A[k] + (B[k] - A[k]) * m, y = A[k + 1] + (B[k + 1] - A[k + 1]) * m, z = A[k + 2] + (B[k + 2] - A[k + 2]) * m;
      const burst = Math.sin(m * Math.PI) * (0.22 + d * 0.4); // mid-change the cloud swells, so it reads as a burst
      x *= 1 + burst; y *= 1 + burst; z += burst * (d - 0.5) * 1.6;
      if (intro < 1) { const q = ease(clamp((intro - d * 0.35) / 0.65)); x = start[k] + (x - start[k]) * q; y = start[k + 1] + (y - start[k + 1]) * q; z = start[k + 2] + (z - start[k + 2]) * q; }
      if (!calm) { x += Math.sin(time * 1.3 + d * 40) * 0.005; y += Math.cos(time * 1.1 + d * 30) * 0.005; }
      let X = x * cY + z * sY, Z = -x * sY + z * cY;
      const Y = y * cX - Z * sX; Z = y * sX + Z * cX;
      const persp = 2.6 / (2.6 + Z);
      let px = ox0 + X * R * persp, py = oy0 - Y * R * persp;
      const dx = px - mx, dy = py - my, d2 = dx * dx + dy * dy;
      if (d2 < 8100) { const n = Math.sqrt(d2) || 1, f = (1 - n / 90) * 5; ox[i] += (dx / n) * f; oy[i] += (dy / n) * f; }
      ox[i] *= 0.9; oy[i] *= 0.9; px += ox[i]; py += oy[i];
      sx[i] = px; sy2[i] = py; sz[i] = persp;
      const ca = PA[slot[i]], cb = PB[slot[i]], front = clamp(1.15 - Z * 0.9, 0.25, 1.2);
      const c = [ca[0] + (cb[0] - ca[0]) * m, ca[1] + (cb[1] - ca[1]) * m, ca[2] + (cb[2] - ca[2]) * m];
      put(px, py, base * persp * (i < M ? 1.6 : 1), c, (i < M ? 0.75 : 0.42) * front);
    }

    // lines: shape nodes to their near neighbours, background nodes likewise, and the pointer to nearby nodes
    let nl = 0;
    const lc = [PA[1][0] + (PB[1][0] - PA[1][0]) * morph, PA[1][1] + (PB[1][1] - PA[1][1]) * morph, PA[1][2] + (PB[1][2] - PA[1][2]) * morph];
    const seg = (x1, y1, x2, y2, c, al) => { if (nl + 2 > MAXL) return; let o = nl * LSTRIDE; lns[o] = x1 * dpr; lns[o + 1] = y1 * dpr; lns[o + 2] = c[0]; lns[o + 3] = c[1]; lns[o + 4] = c[2]; lns[o + 5] = al; o += LSTRIDE; lns[o] = x2 * dpr; lns[o + 1] = y2 * dpr; lns[o + 2] = c[0]; lns[o + 3] = c[1]; lns[o + 4] = c[2]; lns[o + 5] = al; nl += 2; };
    const lineAlpha = (0.15 + 0.5 * settled) * (calm ? 1 : intro);
    link(M, (i) => sx[i], (i) => sy2[i], R * 0.34, LINKS, nbr, (i, j, f) => seg(sx[i], sy2[i], sx[j], sy2[j], lc, f * f * lineAlpha));
    link(D, (i) => bg[i * 4] * W, (i) => bg[i * 4 + 1] * H, wide ? 150 : 110, LINKS, null, (i, j, f) => seg(bg[i * 4] * W, bg[i * 4 + 1] * H, bg[j * 4] * W, bg[j * 4 + 1] * H, bgc, f * 0.12));
    if (mx > -999) { let n = 0; for (let i = 0; i < M && n < 22; i++) { const dx = sx[i] - mx, dy = sy2[i] - my, d = Math.hypot(dx, dy); if (d < 150) { seg(mx, my, sx[i], sy2[i], [1, 1, 1], (1 - d / 150) * 0.6); n++; } } put(mx, my, 10 * dpr, [1, 1, 1], 0.9); }

    // pulses travel node to node along the links, like signals
    if (!calm) for (const q of pulses) {
      if (q.b < 0 || q.t >= 1) { if (q.b >= 0) q.a = q.b; const opts = []; for (let k = 0; k < LINKS; k++) { const j = nbr[q.a * LINKS + k]; if (j >= 0) opts.push(j); } q.b = opts.length ? opts[(Math.random() * opts.length) | 0] : -1; q.t = 0; if (q.b < 0) { q.a = (Math.random() * M) | 0; continue; } }
      q.t += q.v * 1.6;
      const x = sx[q.a] + (sx[q.b] - sx[q.a]) * q.t, y = sy2[q.a] + (sy2[q.b] - sy2[q.a]) * q.t;
      put(x, y, 14 * dpr, lc, 0.5 * settled); put(x, y, 5 * dpr, [1, 1, 1], 1 * settled);
    }

    if (gl) {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(progLns); gl.uniform2f(uResL, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufLns); gl.bufferData(gl.ARRAY_BUFFER, lns.subarray(0, nl * LSTRIDE), gl.DYNAMIC_DRAW);
      let ap = gl.getAttribLocation(progLns, "p"), ac = gl.getAttribLocation(progLns, "c");
      gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, LSTRIDE * 4, 0);
      gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, LSTRIDE * 4, 8);
      gl.drawArrays(gl.LINES, 0, nl);
      gl.useProgram(progPts); gl.uniform2f(uResP, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPts); gl.bufferData(gl.ARRAY_BUFFER, pts.subarray(0, np * PSTRIDE), gl.DYNAMIC_DRAW);
      ap = gl.getAttribLocation(progPts, "p"); const as = gl.getAttribLocation(progPts, "s"); ac = gl.getAttribLocation(progPts, "c");
      gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, PSTRIDE * 4, 0);
      gl.enableVertexAttribArray(as); gl.vertexAttribPointer(as, 1, gl.FLOAT, false, PSTRIDE * 4, 8);
      gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, PSTRIDE * 4, 12);
      gl.drawArrays(gl.POINTS, 0, np);
    } else {
      const g = ctx2; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.globalCompositeOperation = "lighter";
      const css = (o, st) => `rgba(${(lns[o + 2] * 255) | 0},${(lns[o + 3] * 255) | 0},${(lns[o + 4] * 255) | 0},${lns[o + 5].toFixed(3)})`;
      g.lineWidth = dpr * 0.7;
      for (let v = 0; v < nl; v += 2) { const o = v * LSTRIDE; g.strokeStyle = css(o); g.beginPath(); g.moveTo(lns[o], lns[o + 1]); g.lineTo(lns[o + LSTRIDE], lns[o + LSTRIDE + 1]); g.stroke(); }
      for (let v = 0; v < np; v++) { const o = v * PSTRIDE, r = pts[o + 2] * 0.5; g.fillStyle = `rgba(${(pts[o + 3] * 255) | 0},${(pts[o + 4] * 255) | 0},${(pts[o + 5] * 255) | 0},${(pts[o + 6] * 0.6).toFixed(3)})`; g.fillRect(pts[o] - r / 2, pts[o + 1] - r / 2, r, r); }
      g.globalCompositeOperation = "source-over";
    }
  }
  const img = new Image();
  img.onload = () => buildShapes(sample((g, S) => g.drawImage(img, 0, 0, S, S), (r, g, b, a) => a > 128 && r + g + b < 300));
  img.onerror = () => buildShapes(null);
  img.src = "assets/favicon.png";
  requestAnimationFrame(frame);
  const stageEl = canvas.parentElement;
  if (fine) {
    stageEl.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
    stageEl.addEventListener("pointerleave", () => { mx = my = -9999; });
  } else {
    stageEl.addEventListener("touchmove", (e) => { const r = canvas.getBoundingClientRect(), t = e.touches[0]; mx = t.clientX - r.left; my = t.clientY - r.top; }, { passive: true });
    stageEl.addEventListener("touchend", () => { mx = my = -9999; });
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
