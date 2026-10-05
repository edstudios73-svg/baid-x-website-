/*!
 * motion.js — a deterministic timeline engine for Apple-style motion graphics.
 *
 * Every animated value is a pure function of time. That one rule is what lets the
 * same HTML file play live in a browser AND render frame-exactly to video with
 * real (sub-frame) motion blur via scripts/render.mjs.
 *
 *   const m = Motion.scene({ width: 1920, height: 1080, fps: 60, duration: 8 });
 *   m.from('#card', { y: 60, opacity: 0, blur: 12 }, { at: 0.3, dur: 0.9, ease: 'out' });
 *   m.to('#card', { w: 720, h: 420, r: 44 }, { at: 1.4, dur: 0.8, ease: 'morph' });
 *
 * Full API: references/api.md in the skill folder.
 */
(function (global) {
  'use strict';

  // ───────────────────────────────────────────────────────── easing ──

  /** CSS-style cubic-bezier as a function p→p (WebKit UnitBezier port). */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dsx = t => (3 * ax * t + 2 * bx) * t + cx;
    function solve(x) {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-7) return t;
        const d = dsx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 50; i++) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-7) break;
        if (x > v) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    }
    const f = p => (p <= 0 ? 0 : p >= 1 ? 1 : sy(solve(p)));
    f.css = `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
    return f;
  }

  /**
   * Damped-cosine settle as a normalized ease — the per-word "spring" text
   * animator used by Apple-style editors in After Effects:
   *   offset(t) = A·cos(2π·f·t)·e^(−d·t)   (f = 2.1 Hz, d = 8 by default)
   * `seconds` is the span the curve is spread over (it has settled by then).
   */
  function dampedCos(freq = 2.1, decay = 8, seconds = 0.8) {
    const f = p => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.cos(2 * Math.PI * freq * p * seconds) * Math.exp(-decay * p * seconds));
    f.css = 'linear';
    return f;
  }

  const EASES = {
    linear: p => p,
    // ── entrances: fast start, long silky settle (the signature "premium" feel)
    out: bezier(0.16, 1, 0.3, 1),        // expo-out. Default for things arriving.
    outSoft: bezier(0.25, 1, 0.5, 1),    // quart-out. Gentler arrivals, big objects.
    snap: bezier(0.0, 0.88, 0.04, 1.0),  // AE Flow "tight out" — text slide-ups, snappy UI.
    // ── exits: slow start, accelerate away
    in: bezier(0.7, 0, 0.84, 0),         // expo-in.
    inSoft: bezier(0.5, 0, 0.75, 0),     // cubic-in.
    // ── A→B moves (both ends at rest)
    inOut: bezier(0.65, 0, 0.35, 1),     // cubic in-out. Camera moves, cursor paths.
    morph: bezier(0.9, 0.01, 0.06, 1.0), // AE Flow "tight" curve used for Apple UI shape morphs.
    swoop: bezier(0.83, 0, 0.17, 1),     // quint in-out. Big dramatic moves / zoom-throughs.
    apple: bezier(0.4, 0, 0.6, 1),       // apple.com's dominant web curve. Calm fades.
    sheet: bezier(0.32, 0.72, 0, 1),     // iOS sheet presentation curve.
    back: bezier(0.34, 1.56, 0.64, 1),   // overshoot tween (prefer springs / inertia).
    wordSpring: dampedCos(2.1, 8, 0.8),  // Bart_VFX text expression (per-word bounce).
  };
  for (const k in EASES) EASES[k].label = k;
  EASES.tight = EASES.morph;
  EASES.expoOut = EASES.out;
  EASES.expoIn = EASES.in;

  // SwiftUI-style named springs: duration = perceptual duration (s), bounce 0..1.
  const SPRINGS = {
    smooth: { bounce: 0 },
    snappy: { bounce: 0.15 },
    bouncy: { bounce: 0.3 },
    spring: { bounce: 0.15 },
    wobbly: { bounce: 0.45 },
  };

  function makeSpring(duration = 0.5, bounce = 0) {
    duration = Math.max(0.05, duration);
    const w0 = (2 * Math.PI) / duration;
    const zeta = bounce >= 0 ? Math.max(0.02, 1 - bounce) : 1 / (1 + Math.max(-0.95, bounce));
    return { w0, zeta, duration, bounce };
  }

  /** Displacement of a damped spring (mass 1) from its target at time t. */
  function springX(s, x0, v0, t) {
    const { w0, zeta } = s;
    if (zeta < 0.9999) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      const e = Math.exp(-zeta * w0 * t);
      return e * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t));
    }
    if (zeta <= 1.0001) return (x0 + (v0 + w0 * x0) * t) * Math.exp(-w0 * t);
    const r = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - r), r2 = -w0 * (zeta + r);
    const A = (v0 - r2 * x0) / (r1 - r2), B = x0 - A;
    return A * Math.exp(r1 * t) + B * Math.exp(r2 * t);
  }

  function springSettle(s, x0, v0) {
    const scale = Math.max(Math.abs(x0), Math.abs(v0) / s.w0, 1e-9);
    const eps = scale * 1e-3;
    const dt = 1 / 240;
    let calm = 0;
    for (let t = 0; t < 30; t += dt) {
      const x = springX(s, x0, v0, t);
      const v = (springX(s, x0, v0, t + 1e-4) - x) / 1e-4;
      if (Math.abs(x) < eps && Math.abs(v) / s.w0 < eps) {
        calm += dt;
        if (calm >= 0.1) return Math.max(0, t - 0.1);
      } else calm = 0;
    }
    return 30;
  }

  /** Resolve an ease spec → { fn } or { spring } */
  function resolveEase(spec, opts) {
    if (spec == null) spec = 'out';
    if (typeof spec === 'function') return { fn: spec };
    if (Array.isArray(spec)) return { fn: bezier(...spec) };
    if (typeof spec === 'object' && spec.spring != null) {
      const sp = spec.spring;
      const bounce = typeof sp === 'number' ? sp : sp.bounce ?? 0.15;
      const dur = (typeof sp === 'object' && sp.duration) || opts.dur || 0.5;
      return { spring: makeSpring(dur, bounce) };
    }
    if (typeof spec === 'string') {
      const s = spec.trim();
      let m = s.match(/^cubic-bezier\(([^)]+)\)$/);
      if (m) return { fn: bezier(...m[1].split(',').map(Number)) };
      m = s.match(/^spring(?:\(([^)]*)\))?$/);
      if (m) {
        const args = (m[1] || '').split(',').map(x => x.trim()).filter(Boolean).map(Number);
        // spring(bounce) or spring(duration, bounce)
        if (args.length === 1) return { spring: makeSpring(opts.dur || 0.5, args[0]) };
        if (args.length >= 2) return { spring: makeSpring(args[0], args[1]) };
        return { spring: makeSpring(opts.dur || 0.5, opts.bounce ?? SPRINGS.spring.bounce) };
      }
      if (SPRINGS[s]) return { spring: makeSpring(opts.dur || 0.5, opts.bounce ?? SPRINGS[s].bounce) };
      if (EASES[s]) return { fn: EASES[s] };
    }
    warn(`Unknown ease "${spec}". Use one of: ${Object.keys(EASES).concat(Object.keys(SPRINGS)).join(', ')}, cubic-bezier(...), spring(bounce), [x1,y1,x2,y2] or a function.`);
    return { fn: EASES.out };
  }

  // ───────────────────────────────────────────────────────── values ──

  const NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };

  function parseColor(s) {
    if (typeof s !== 'string') return null;
    s = s.trim().toLowerCase();
    if (NAMED[s]) return NAMED[s].slice();
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      const n = i => parseInt(h.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
    }
    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean);
      const ch = v => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
      const a = p[3] == null ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      return [ch(p[0]), ch(p[1]), ch(p[2]), a];
    }
    m = s.match(/^hsla?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,\/]+/).filter(Boolean);
      const h = (((parseFloat(p[0]) % 360) + 360) % 360) / 360, sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
      const a = p[3] == null ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      const f = n => {
        const k = (n + h * 12) % 12;
        return 255 * (l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
      };
      return [f(0), f(8), f(4), a];
    }
    return null;
  }

  // sRGB ⇄ OKLab (perceptually even color blends — no muddy midpoints)
  const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const fromLin = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);
  function rgbToOklab([r, g, b]) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function oklabToRgb([L, a, b]) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
  function mixColor(c1, c2, p) {
    const a1 = c1[3], a2 = c2[3];
    const a = a1 + (a2 - a1) * p;
    const L1 = rgbToOklab(c1), L2 = rgbToOklab(c2);
    let lab;
    if (a <= 1e-6) lab = L2;
    else lab = [0, 1, 2].map(i => (L1[i] * a1 + (L2[i] * a2 - L1[i] * a1) * p) / a);
    const rgb = oklabToRgb(lab);
    return `rgba(${clamp255(rgb[0])}, ${clamp255(rgb[1])}, ${clamp255(rgb[2])}, ${+Math.max(0, Math.min(1, a)).toFixed(4)})`;
  }

  function normalizeColorsInString(s) {
    return s
      .replace(/#([0-9a-fA-F]{3,8})\b/g, (m0) => {
        const c = parseColor(m0);
        return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})` : m0;
      })
      .replace(/\b(transparent|white|black)\b/g, (m0) => {
        const c = NAMED[m0];
        return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
      });
  }

  function parseTemplate(s) {
    s = normalizeColorsInString(String(s));
    const nums = [];
    const parts = s.split(NUM_RE);
    (s.match(NUM_RE) || []).forEach(n => nums.push(parseFloat(n)));
    return { parts, nums, src: s };
  }

  const fmt = (v, d = 3) => {
    if (!isFinite(v)) return '0';
    const r = +v.toFixed(d);
    return String(Object.is(r, -0) ? 0 : r);
  };

  /** Typed value: {k:'num', v} | {k:'color', c:[r,g,b,a]} | {k:'str', t:template, s} */
  function typed(v) {
    if (v && v.k) return v;
    if (typeof v === 'number') return { k: 'num', v };
    if (typeof v === 'boolean') return { k: 'raw', v };
    const s = String(v ?? '');
    const c = parseColor(s);
    if (c) return { k: 'color', c };
    if (/^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?$/i.test(s.trim())) return { k: 'num', v: parseFloat(s) };
    return { k: 'str', t: parseTemplate(s), s };
  }

  function interp(a, b, p) {
    if (a.k === 'num' && b.k === 'num') return { k: 'num', v: a.v + (b.v - a.v) * p };
    if (a.k === 'color' && b.k === 'color') return { k: 'css', s: mixColor(a.c, b.c, p) };
    if (a.k === 'color' && b.k === 'str') a = typed(`rgba(${a.c.join(', ')})`), a = { k: 'str', t: parseTemplate(a.s ?? `rgba(${a.c ? a.c.join(', ') : ''})`) };
    if (a.k === 'str' && b.k === 'str' && a.t.nums.length === b.t.nums.length && a.t.parts.join('#') === b.t.parts.join('#')) {
      let out = '';
      for (let i = 0; i < b.t.parts.length; i++) {
        out += b.t.parts[i];
        if (i < b.t.nums.length) out += fmt(a.t.nums[i] + (b.t.nums[i] - a.t.nums[i]) * p, 4);
      }
      return { k: 'css', s: out };
    }
    return p < 0.5 ? a : b; // incompatible → step at the midpoint
  }

  const valueNum = t => (t.k === 'num' ? t.v : NaN);
  function valueCss(t) {
    if (t.k === 'num') return t.v;
    if (t.k === 'color') return `rgba(${clamp255(t.c[0])}, ${clamp255(t.c[1])}, ${clamp255(t.c[2])}, ${t.c[3]})`;
    if (t.k === 'css') return t.s;
    if (t.k === 'str') return t.s ?? t.t.src;
    return t.v;
  }

  // ───────────────────────────────────────────────────────── props ──

  const TRANSFORM_DEFAULTS = { x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, perspective: 0 };
  const FILTER_DEFAULTS = { blur: 0, brightness: 1, saturate: 1, contrast: 1, grayscale: 0, hue: 0, invert: 0, sepia: 0 };
  const ALIASES = {
    w: 'width', h: 'height', r: 'borderRadius', radius: 'borderRadius', bg: 'backgroundColor', background: 'backgroundColor',
    rotation: 'rotate', rotateZ: 'rotate', rz: 'rotate', rx: 'rotateX', ry: 'rotateY', alpha: 'opacity', o: 'opacity', clip: 'clipPath',
    left: 'left', top: 'top',
  };
  const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'fillOpacity', 'strokeOpacity', 'stopOpacity']);
  // weights used to estimate on-screen motion (px) for adaptive motion blur
  const MOTION_WEIGHT = { x: 1, y: 1, z: 0.5, width: 0.5, height: 0.5, left: 1, top: 1, borderRadius: 0.2 };
  // only geometry may overshoot (inertia / bouncy springs); opacity, blur, colors must not ring
  const GEOMETRIC = new Set(['x', 'y', 'z', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY', 'skewX', 'skewY', 'width', 'height', 'borderRadius', 'left', 'top', 'right', 'bottom', 'perspective']);

  const canon = p => ALIASES[p] || p;
  const kebab = s => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

  function warn(msg) { try { console.warn('[motion] ' + msg); } catch (e) { /* noop */ } }

  // ─────────────────────────────────────────────────────── helpers ──

  function mulberry32(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const isEl = t => typeof Element !== 'undefined' && t instanceof Element;

  // ─────────────────────────────────────────────────── text splitting ──

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const graphemes = s => (segmenter ? Array.from(segmenter.segment(s), x => x.segment) : Array.from(s));

  /**
   * Split an element's text into inline-block pieces you can animate.
   * by: 'word' | 'char' | 'line'. Nested inline markup (<b>, <span>) is kept.
   * Returns the pieces in reading order. Idempotent per mode.
   */
  function split(el, by = 'word') {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return [];
    if (el.__mSplit) {
      if (el.__mSplit.by === by) return el.__mSplit.pieces;
      warn('split(): element already split as "' + el.__mSplit.by + '"; reusing that.');
      return el.__mSplit.pieces;
    }
    const words = [], chars = [];
    const walk = node => {
      Array.from(node.childNodes).forEach(child => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(tok => {
            if (!tok) return;
            if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            w.className = 'm-word';
            w.style.display = 'inline-block';
            w.style.whiteSpace = 'pre';
            if (by === 'char') {
              graphemes(tok).forEach(g => {
                const c = document.createElement('span');
                c.className = 'm-char';
                c.style.display = 'inline-block';
                c.textContent = g;
                w.appendChild(c);
                chars.push(c);
              });
            } else w.textContent = tok;
            words.push(w);
            frag.appendChild(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && !/^(BR|SVG|IMG)$/i.test(child.tagName)) walk(child);
      });
    };
    walk(el);
    let pieces = by === 'char' ? chars : words;
    if (by === 'line') {
      // group words by their rendered line (flat text only)
      const lines = [];
      let cur = null, lastTop = null;
      words.forEach(w => {
        const top = w.offsetTop;
        if (lastTop === null || Math.abs(top - lastTop) > 2) { cur = []; lines.push(cur); lastTop = top; }
        cur.push(w);
      });
      pieces = lines.map(ws => {
        const line = document.createElement('span');
        line.className = 'm-line';
        line.style.display = 'inline-block';
        line.style.whiteSpace = 'pre';
        ws[0].before(line);
        ws.forEach((w, i) => {
          if (i > 0) line.appendChild(document.createTextNode(' '));
          line.appendChild(w);
        });
        // drop the whitespace text nodes that preceded each moved word
        return line;
      });
      pieces.forEach((line, i) => { if (i > 0) line.before(document.createElement('br')); });
      Array.from(el.childNodes).forEach(n => { if (n.nodeType === 3 && !n.textContent.trim()) n.remove(); });
    }
    el.__mSplit = { by, pieces };
    return pieces;
  }

  /** Keep a gradient (background-clip:text) continuous across split pieces. */
  function fixGradientText(el) {
    if (!el.__mSplit) return;
    const cs = getComputedStyle(el);
    const clip = cs.webkitBackgroundClip || cs.backgroundClip;
    if (clip !== 'text' || !cs.backgroundImage || cs.backgroundImage === 'none') return;
    const base = el.getBoundingClientRect();
    const scale = base.width / el.offsetWidth || 1;
    const W = el.offsetWidth, H = el.offsetHeight;
    const img = cs.backgroundImage;
    el.__mSplit.pieces.forEach(p => {
      const leaves = p.querySelectorAll('.m-char').length ? p.querySelectorAll('.m-char') : [p];
      leaves.forEach(leaf => {
        const r = leaf.getBoundingClientRect();
        const ox = (r.left - base.left) / scale, oy = (r.top - base.top) / scale;
        Object.assign(leaf.style, {
          backgroundImage: img, backgroundSize: `${W}px ${H}px`, backgroundPosition: `${-ox}px ${-oy}px`,
          backgroundRepeat: 'no-repeat', webkitBackgroundClip: 'text', backgroundClip: 'text',
          color: 'transparent', webkitTextFillColor: 'transparent',
        });
      });
    });
    el.style.backgroundImage = 'none';
  }

  // ─────────────────────────────────────────────── element state ──

  class Target {
    constructor(obj, scene) {
      this.obj = obj;
      this.scene = scene;
      this.el = isEl(obj);
      this.svg = this.el && obj instanceof SVGElement && obj.tagName.toLowerCase() !== 'svg';
      this.base = new Map();
      this.vals = {};
      this.last = {};
      this.hasTransform = false;
      this.hasFilter = false;
      this.radius = null;
    }
    name() {
      const o = this.obj;
      if (!this.el) return '{object}';
      if (o.id) return '#' + o.id;
      const piece = o.classList && (o.classList.contains('m-word') ? 'word' : o.classList.contains('m-char') ? 'char' : o.classList.contains('m-line') ? 'line' : null);
      if (piece) {
        let host = o.parentElement;
        while (host && !host.__mSplit) host = host.parentElement;
        if (host) return `${this.scene.target(host).name()} › ${piece}s`;
      }
      const cls = (o.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return o.tagName.toLowerCase() + (cls ? '.' + cls : '');
    }
    /** Half-diagonal in stage px — converts rotation/scale deltas to on-screen motion. */
    size() {
      if (this.radius != null) return this.radius;
      if (!this.el) return (this.radius = 0);
      const r = this.obj.getBoundingClientRect();
      const s = this.scene._fit || 1;
      this.radius = Math.hypot(r.width, r.height) / 2 / s;
      return this.radius;
    }
    readBase(prop) {
      if (this.base.has(prop)) return this.base.get(prop);
      let v;
      const o = this.obj;
      if (prop in TRANSFORM_DEFAULTS) v = TRANSFORM_DEFAULTS[prop];
      else if (prop in FILTER_DEFAULTS) v = FILTER_DEFAULTS[prop];
      else if (!this.el) v = o[prop] ?? 0;
      else if (prop === 'draw') v = 1;
      else if (prop === 'text') v = o.textContent;
      else if (prop.startsWith('attr:')) v = o.getAttribute(prop.slice(5)) ?? 0;
      else if (prop.startsWith('--')) v = getComputedStyle(o).getPropertyValue(prop).trim() || 0;
      else {
        const cs = getComputedStyle(o);
        if (prop === 'borderRadius') v = cs.borderTopLeftRadius;
        else if (prop === 'width' || prop === 'height') {
          v = cs[prop];
          if (!/px$/.test(v)) v = (prop === 'width' ? o.offsetWidth : o.offsetHeight) + 'px';
        } else v = cs[prop] ?? cs.getPropertyValue(kebab(prop));
        if (typeof v === 'string' && /^-?[\d.]+px$/.test(v.trim())) v = parseFloat(v);
        if (prop === 'opacity') v = parseFloat(v);
      }
      const t = typed(v);
      this.base.set(prop, t);
      return t;
    }
    flush() {
      const o = this.obj, v = this.vals;
      if (!this.el) {
        for (const k in v) o[k] = v[k].k === 'num' ? v[k].v : valueCss(v[k]);
        return;
      }
      const st = o.style;
      const n = k => (v[k] ? valueNum(v[k]) : TRANSFORM_DEFAULTS[k] ?? FILTER_DEFAULTS[k]);
      if (this.hasTransform) {
        const x = n('x'), y = n('y'), z = n('z');
        let s = '';
        const p = n('perspective');
        if (p) s += `perspective(${fmt(p, 1)}px) `;
        s += z ? `translate3d(${fmt(x)}px, ${fmt(y)}px, ${fmt(z)}px)` : `translate(${fmt(x)}px, ${fmt(y)}px)`;
        const rz = n('rotate'), ry = n('rotateY'), rx = n('rotateX'), kx = n('skewX'), ky = n('skewY');
        if (rz) s += ` rotate(${fmt(rz)}deg)`;
        if (ry) s += ` rotateY(${fmt(ry)}deg)`;
        if (rx) s += ` rotateX(${fmt(rx)}deg)`;
        if (kx || ky) s += ` skew(${fmt(kx)}deg, ${fmt(ky)}deg)`;
        const sx = n('scale') * n('scaleX'), sy = n('scale') * n('scaleY');
        if (sx !== 1 || sy !== 1) s += ` scale(${fmt(sx, 5)}, ${fmt(sy, 5)})`;
        if (this.last.transform !== s) { st.transform = s; this.last.transform = s; }
      }
      if (this.hasFilter) {
        let f = '';
        const b = n('blur'); if (b > 0.01) f += `blur(${fmt(b, 2)}px) `;
        const br = n('brightness'); if (br !== 1) f += `brightness(${fmt(br)}) `;
        const sa = n('saturate'); if (sa !== 1) f += `saturate(${fmt(sa)}) `;
        const co = n('contrast'); if (co !== 1) f += `contrast(${fmt(co)}) `;
        const gr = n('grayscale'); if (gr) f += `grayscale(${fmt(gr)}) `;
        const hu = n('hue'); if (hu) f += `hue-rotate(${fmt(hu)}deg) `;
        const iv = n('invert'); if (iv) f += `invert(${fmt(iv)}) `;
        const se = n('sepia'); if (se) f += `sepia(${fmt(se)}) `;
        f = f.trim() || 'none';
        if (this.last.filter !== f) { st.filter = f; this.last.filter = f; }
      }
      for (const k in v) {
        if (k in TRANSFORM_DEFAULTS || k in FILTER_DEFAULTS) continue;
        const tv = v[k];
        let out = valueCss(tv);
        if (k === 'text') {
          const s = String(out);
          if (this.last.text !== s) { o.textContent = s; this.last.text = s; }
          continue;
        }
        if (k === 'draw') {
          const d = fmt(1 - valueNum(tv), 4);
          if (this.last.draw !== d) { st.strokeDasharray = '1 1'; st.strokeDashoffset = d; this.last.draw = d; }
          continue;
        }
        if (k.startsWith('attr:')) {
          const a = k.slice(5), s = typeof out === 'number' ? fmt(out, 4) : String(out);
          if (this.last[k] !== s) { o.setAttribute(a, s); this.last[k] = s; }
          continue;
        }
        let s;
        if (typeof out === 'number') s = k.startsWith('--') || UNITLESS.has(k) ? fmt(out, 4) : fmt(out, 3) + 'px';
        else s = String(out);
        if (this.last[k] === s) continue;
        this.last[k] = s;
        if (k.startsWith('--')) st.setProperty(k, s);
        else if (k in st) st[k] = s;
        else st.setProperty(kebab(k), s);
      }
    }
  }

  // ─────────────────────────────────────────────────────── tracks ──

  class Track {
    constructor(target, prop) {
      this.target = target;
      this.prop = prop;
      this.segs = [];
      this.adds = null;
      this.resolved = false;
    }
    base() { return this.target.readBase(this.prop); }
    resolve() {
      this.segs.sort((a, b) => a.t0 - b.t0 || a.order - b.order);
      for (let i = 0; i < this.segs.length; i++) {
        const s = this.segs[i];
        const prev = i > 0 ? this.segs[i - 1] : null;
        const under = prev ? this.evalSeg(prev, s.t0, s.t0, true) : this.base();
        const spec = v => typed(typeof v === 'function' ? v(this.target.obj, s.index, s.count) : v);
        const rel = (v, from) => {
          if (typeof v === 'string') {
            const m = v.match(/^([+\-*])=\s*([-\d.eE]+)$/);
            if (m && from.k === 'num') {
              const d = parseFloat(m[2]);
              return { k: 'num', v: m[1] === '+' ? from.v + d : m[1] === '-' ? from.v - d : from.v * d };
            }
          }
          return null;
        };
        const fromSpec = s.fromSpec !== undefined ? (typeof s.fromSpec === 'function' ? s.fromSpec(this.target.obj, s.index, s.count) : s.fromSpec) : undefined;
        const toSpec = s.toSpec !== undefined ? (typeof s.toSpec === 'function' ? s.toSpec(this.target.obj, s.index, s.count) : s.toSpec) : undefined;
        s.from = fromSpec !== undefined ? rel(fromSpec, under) || spec(fromSpec) : under;
        s.to = toSpec !== undefined ? rel(toSpec, s.from) || spec(toSpec) : under;
        // entering something that was hidden with set({opacity:0}) / set({scale:0}) should land on the visible state
        if (toSpec === undefined && s.kind !== 'set' && under.k === 'num' && Math.abs(under.v) < 1e-3 && /^(opacity|scale|scaleX|scaleY)$/.test(this.prop)) s.to = { k: 'num', v: 1 };
        // numbers vs "12px" strings: normalise so they interpolate
        if (s.from.k === 'num' && s.to.k === 'str') s.to = typed(parseFloat(s.to.s)) ;
        if (s.to.k === 'num' && s.from.k === 'str' && !isNaN(parseFloat(s.from.s))) s.from = typed(parseFloat(s.from.s));
        if (s.from.k === 'str' && s.to.k === 'color') s.from = typed(s.from.s);
        if (s.kind === 'spring') {
          const numeric = s.from.k === 'num' && s.to.k === 'num';
          s.v0 = 0;
          if (numeric && prev && prev.kind !== 'set') {
            const h = 1 / 600;
            const a = this.evalSeg(prev, s.t0 - h, s.t0 - h, true), b = this.evalSeg(prev, s.t0, s.t0, true);
            if (a.k === 'num' && b.k === 'num' && prev.t0 < s.t0) s.v0 = (b.v - a.v) / h;
          }
          const x0 = numeric ? s.from.v - s.to.v : 1;
          s.settle = springSettle(s.spring, x0 || (s.v0 ? 1e-6 : 0), numeric ? s.v0 : 0);
          s.t1 = s.t0 + s.settle;
        }
        if (s.inertia && s.from.k === 'num' && s.to.k === 'num' && s.t1 > s.t0) {
          const h = 1 / 600, d = s.t1 - s.t0;
          const e1 = s.ease(1), e0 = s.ease(Math.max(0, 1 - h / d));
          const v = ((s.to.v - s.from.v) * (e1 - e0)) / h;
          const { amp, freq, decay } = s.inertia;
          s.inertia.v = v;
          const peak = Math.abs(v) * amp;
          s.inertia.tail = peak > 0.02 ? Math.log(peak / 0.02) / decay : 0;
        }
      }
      this.resolved = true;
    }
    arcOffset(s, e) {
      const a = s.arc;
      if (!a || !a.partner) return 0;
      const me = s, pa = a.partner;
      if (!me.from || !pa.from || !pa.to || me.from.k !== 'num' || pa.from.k !== 'num') return 0;
      const dx = a.axis === 'x' ? me.to.v - me.from.v : pa.to.v - pa.from.v;
      const dy = a.axis === 'y' ? me.to.v - me.from.v : pa.to.v - pa.from.v;
      const L = Math.hypot(dx, dy);
      if (!L) return 0;
      const nx = dy / L, ny = -dx / L; // left of travel (counter-clockwise on screen)
      const bump = 4 * e * (1 - e) * a.amount * L;
      return (a.axis === 'x' ? nx : ny) * bump;
    }
    evalSeg(s, t, stepTime, noArc) {
      if (s.kind === 'set') return s.to;
      const dt = t - s.t0;
      if (s.kind === 'spring') {
        if (t >= s.t1) return s.to;
        if (s.from.k === 'num' && s.to.k === 'num') return { k: 'num', v: s.to.v + springX(s.spring, s.from.v - s.to.v, s.v0, Math.max(0, dt)) };
        return interp(s.from, s.to, 1 - springX(s.spring, 1, 0, Math.max(0, dt)));
      }
      const d = s.t1 - s.t0;
      const p = d > 0 ? Math.max(0, Math.min(1, dt / d)) : 1;
      const e = s.ease(p);
      let v = interp(s.from, s.to, e);
      if (v.k === 'num') {
        if (s.arc && !noArc) v = { k: 'num', v: v.v + this.arcOffset(s, e) };
        if (s.inertia && s.inertia.v && t > s.t1) {
          const tau = t - s.t1, { v: vel, amp, freq, decay } = s.inertia;
          v = { k: 'num', v: v.v + vel * amp * Math.sin(freq * tau * 2 * Math.PI) / Math.exp(decay * tau) };
        }
      }
      return v;
    }
    valueAt(t, stepTime = t) {
      const segs = this.segs;
      if (!segs.length) return this.base();
      // the active segment is the last one that has started; steps use the frame's nominal time
      let active = null;
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        const start = s.kind === 'set' ? stepTime : t;
        if (s.t0 <= start + 1e-9) { active = s; break; }
      }
      if (!active) return segs[0].from;
      return this.evalSeg(active, t, stepTime);
    }
    /** [start, end] ranges where this track is changing (for adaptive motion blur). */
    activeRanges() {
      return this.segs.filter(s => s.kind !== 'set').map(s => [s.t0, s.t1 + (s.inertia && s.inertia.tail ? s.inertia.tail : 0)]);
    }
  }

  // ─────────────────────────────────────────────────────── scene ──

  const RENDER = !!global.__MOTION_RENDER__;

  class Scene {
    constructor(opts = {}) {
      const stage = typeof opts.stage === 'string' ? document.querySelector(opts.stage) : opts.stage || document.querySelector('#stage') || document.querySelector('.stage');
      if (!stage) throw new Error('[motion] No stage element found. Add <div id="stage"> to the page.');
      this.stage = stage;
      this.width = opts.width || +stage.dataset.width || 1920;
      this.height = opts.height || +stage.dataset.height || 1080;
      this.fps = opts.fps || +stage.dataset.fps || 60;
      this._duration = opts.duration || +stage.dataset.duration || 0;
      this.opts = opts;
      this.targets = new Map();
      this.tracks = [];
      this.trackIndex = new Map();
      this.drivers = [];
      this.labels = {};
      this.cues = [];
      this.hooks = [];
      this.waits = [];
      this.order = 0;
      this.last = { start: 0, end: 0 };
      this.dirty = true;
      this.time = 0;
      this._fit = 1;
      stage.classList.add('m-stage');
      Object.assign(stage.style, { width: this.width + 'px', height: this.height + 'px' });
      if (opts.background) stage.style.background = opts.background;
      fillIcons(stage); // icons/cursors exist before the author's script measures anything
      this.ready = this._init();
    }

    get duration() {
      if (this._duration) return this._duration;
      let end = 0;
      for (const tr of this.tracks) for (const s of tr.segs) end = Math.max(end, s.t1 || s.t0);
      return Math.max(1, end + 1);
    }
    set duration(v) { this._duration = v; }

    // ── time helpers
    at(spec, fallback) {
      if (spec == null) return fallback != null ? fallback : this.last.end;
      if (typeof spec === 'number') return spec;
      const s = String(spec).trim();
      let m = s.match(/^([<>])\s*([+\-]\s*[\d.]+)?$/);
      if (m) return (m[1] === '<' ? this.last.start : this.last.end) + (m[2] ? parseFloat(m[2].replace(/\s/g, '')) : 0);
      m = s.match(/^([A-Za-z_][\w-]*)\s*([+\-]\s*[\d.]+)?$/);
      if (m && m[1] in this.labels) return this.labels[m[1]] + (m[2] ? parseFloat(m[2].replace(/\s/g, '')) : 0);
      const n = parseFloat(s);
      if (!isNaN(n)) return n;
      warn(`Unknown time "${spec}". Use seconds, '<', '>', '>+0.2', or a label defined with m.label().`);
      return 0;
    }
    label(name, time) { this.labels[name] = this.at(time); return this; }

    // ── targets
    resolveTargets(t) {
      if (t == null) return [];
      if (typeof t === 'string') {
        const list = Array.from(this.stage.querySelectorAll(t));
        const outside = list.length ? list : Array.from(document.querySelectorAll(t));
        if (!outside.length) warn(`No elements match "${t}".`);
        return outside;
      }
      if (t instanceof NodeList || t instanceof HTMLCollection) return Array.from(t);
      if (Array.isArray(t)) return t.flatMap(x => this.resolveTargets(x));
      return [t];
    }
    target(obj) {
      let tg = this.targets.get(obj);
      if (!tg) { tg = new Target(obj, this); this.targets.set(obj, tg); }
      return tg;
    }
    track(obj, prop) {
      const tg = this.target(obj);
      const key = prop;
      let map = this.trackIndex.get(tg);
      if (!map) { map = new Map(); this.trackIndex.set(tg, map); }
      let tr = map.get(key);
      if (!tr) {
        tr = new Track(tg, prop);
        map.set(key, tr);
        this.tracks.push(tr);
        if (prop in TRANSFORM_DEFAULTS) {
          tg.hasTransform = true;
          // SVG parts rotate/scale around their own center — set only on elements we animate,
          // so static SVG artwork with transform="rotate(a cx cy)" attributes is left untouched
          if (tg.svg && !obj.style.transformOrigin) { obj.style.transformBox = 'fill-box'; obj.style.transformOrigin = 'center'; }
        }
        if (prop in FILTER_DEFAULTS) tg.hasFilter = true;
      }
      return tr;
    }

    staggerOffsets(n, stagger, list) {
      if (!stagger) return new Array(n).fill(0);
      if (typeof stagger === 'number') return Array.from({ length: n }, (_, i) => i * stagger);
      if (typeof stagger === 'function') return Array.from({ length: n }, (_, i) => stagger(i, n, list[i]));
      const each = stagger.each != null ? stagger.each : stagger.amount != null ? stagger.amount / Math.max(1, n - 1) : 0.05;
      const from = stagger.from || 'start';
      const ease = stagger.ease ? resolveEase(stagger.ease, {}).fn : null;
      const origin = from === 'start' ? 0 : from === 'end' ? n - 1 : from === 'center' ? (n - 1) / 2 : typeof from === 'number' ? from : 0;
      const dists = Array.from({ length: n }, (_, i) => (from === 'edges' ? Math.min(i, n - 1 - i) : Math.abs(i - origin)));
      if (from === 'random') {
        const r = mulberry32(stagger.seed || 7);
        return dists.map(() => r() * each * (n - 1));
      }
      const max = Math.max(...dists) || 1;
      return dists.map(d => (ease ? ease(d / max) * max : d) * each);
    }

    // ── core tween API
    _add(kind, targets, fromProps, toProps, opts = {}) {
      const list = this.resolveTargets(targets);
      const t0 = this.at(opts.at);
      const offsets = this.staggerOffsets(list.length, opts.stagger, list);
      const ez = kind === 'set' ? null : resolveEase(opts.ease ?? (opts.inertia ? 'linear' : 'out'), opts);
      const dur = kind === 'set' ? 0 : opts.dur != null ? opts.dur : 0.6;
      const inertia = opts.inertia ? Object.assign({ amp: 0.06, freq: 1.8, decay: 5 }, opts.inertia === true ? {} : typeof opts.inertia === 'number' ? { amp: opts.inertia } : opts.inertia) : null;
      const props = Object.keys(Object.assign({}, fromProps || {}, toProps || {}));
      let lastEnd = t0;
      list.forEach((obj, i) => {
        const start = t0 + offsets[i];
        const segsByProp = {};
        props.forEach(p0 => {
          const prop = canon(p0);
          const tr = this.track(obj, prop);
          const geo = GEOMETRIC.has(prop);
          let spring = ez && ez.spring ? ez.spring : null;
          if (spring && !geo && spring.bounce > 0) spring = makeSpring(spring.duration, 0); // no ringing opacity/blur/colors
          const seg = {
            kind: kind === 'set' ? 'set' : spring ? 'spring' : 'tween',
            t0: start, t1: start + dur, order: this.order++, index: i, count: list.length,
            fromSpec: fromProps && p0 in fromProps ? fromProps[p0] : undefined,
            toSpec: toProps && p0 in toProps ? toProps[p0] : undefined,
            ease: ez && ez.fn ? ez.fn : EASES.linear,
            spring,
            inertia: inertia && geo && !spring ? Object.assign({}, inertia) : null,
          };
          tr.segs.push(seg);
          segsByProp[prop] = seg;
          lastEnd = Math.max(lastEnd, start + dur);
        });
        if (opts.arc && segsByProp.x && segsByProp.y) {
          segsByProp.x.arc = { amount: opts.arc, axis: 'x', partner: segsByProp.y };
          segsByProp.y.arc = { amount: opts.arc, axis: 'y', partner: segsByProp.x };
        }
      });
      this.last = { start: t0, end: lastEnd };
      this.dirty = true;
      return this;
    }
    to(targets, props, opts = {}) { return this._add('to', targets, null, props, opts); }
    from(targets, props, opts = {}) { return this._add('from', targets, props, null, opts); }
    fromTo(targets, fromProps, toProps, opts = {}) { return this._add('fromTo', targets, fromProps, toProps, opts); }
    set(targets, props, at = 0) {
      if (typeof at === 'object' && at !== null) at = at.at;
      return this._add('set', targets, null, props, { at: at == null ? 0 : at });
    }
    spring(targets, props, opts = {}) {
      return this._add('to', targets, null, props, Object.assign({}, opts, { ease: { spring: { bounce: opts.bounce ?? 0.15, duration: opts.dur || 0.5 } } }));
    }
    onFrame(fn) { this.drivers.push({ fn }); this.dirty = true; return this; }
    /** Additive channel: fn(t) → value added on top of the tracked value of `prop`. */
    add(targets, prop, fn, range) {
      this.resolveTargets(targets).forEach((obj, i) => {
        const tr = this.track(obj, canon(prop));
        (tr.adds || (tr.adds = [])).push({ fn: t => fn(t, i), range: range || [0, Infinity] });
      });
      this.dirty = true;
      return this;
    }
    show(targets, from = 0, to = Infinity) {
      if (typeof from === 'object') ({ from = 0, to = Infinity } = from);
      this.resolveTargets(targets).forEach(obj => {
        if (from > 0) this.set(obj, { visibility: 'hidden' }, 0);
        this.set(obj, { visibility: 'visible' }, from);
        if (isFinite(to)) this.set(obj, { visibility: 'hidden' }, to);
      });
      return this;
    }
    /** Sound cue (rendered by scripts/render.mjs; previewed with WebAudio if sfx.js is loaded). */
    sfx(name, at, opts = {}) {
      this.cues.push(Object.assign({ name, at: this.at(at) }, opts));
      return this;
    }
    wait(promise) { this.waits.push(promise); return this; }
    hook(fn) { this.hooks.push(fn); this.dirty = true; return this; }

    // ── build & seek
    build() {
      if (!this.dirty) return;
      this.hooks.forEach(h => h(this));
      this.hooks = [];
      this.tracks.forEach(tr => tr.resolve());
      this.dirty = false;
      // Measure-at-time: cursor targets are measured where they actually are when the cursor
      // arrives (after the engine has moved/scaled them), then the dependent tracks re-resolve.
      if (this._measures && this._measures.some(r => !r.done)) {
        for (const req of this._measures) {
          if (req.done) continue;
          this.seek(req.time, req.time);
          const el = this.resolveTargets(req.target)[0];
          req.value = el ? center(el, this) : { x: 0, y: 0 };
          req.done = true;
          req.tracks.forEach(tr => tr.resolve());
        }
      }
    }
    seek(t, frameTime = t) {
      this.build();
      this.time = t;
      for (const tr of this.tracks) {
        let v = tr.valueAt(t, frameTime);
        if (tr.adds && v.k === 'num') {
          let add = 0;
          for (const a of tr.adds) if (t >= a.range[0] && t <= a.range[1]) add += a.fn(t);
          if (add) v = { k: 'num', v: v.v + add };
        }
        tr.target.vals[tr.prop] = v;
      }
      for (const tg of this.targets.values()) tg.flush();
      for (const d of this.drivers) d.fn(t, this);
      return this;
    }
    /** Estimated max on-screen displacement (px) between times a and b — drives adaptive motion blur. */
    motionBetween(a, b) {
      this.build();
      let max = 0;
      for (const tr of this.tracks) {
        const prop = tr.prop;
        let w = MOTION_WEIGHT[prop];
        if (w == null) {
          if (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') w = tr.target.size();
          else if (prop === 'rotate' || prop === 'rotateX' || prop === 'rotateY' || prop === 'skewX' || prop === 'skewY') w = (tr.target.size() * Math.PI) / 180;
          else continue;
        }
        const active = tr.activeRanges().some(([s, e]) => s < b && e > a) || (tr.adds && tr.adds.length);
        if (!active) continue;
        let prev = null, total = 0;
        for (let i = 0; i <= 4; i++) {
          const t = a + ((b - a) * i) / 4;
          let v = tr.valueAt(t, t);
          if (v.k !== 'num') break;
          let x = v.v;
          if (tr.adds) for (const ad of tr.adds) if (t >= ad.range[0] && t <= ad.range[1]) x += ad.fn(t);
          if (prev != null) total += Math.abs(x - prev);
          prev = x;
        }
        max = Math.max(max, total * w);
      }
      for (const d of this.drivers) if (d.moving && d.moving(a, b)) max = Math.max(max, d.px || 50);
      return max;
    }

    /** Timeline summary for debugging / scripts/inspect. */
    describe() {
      this.build();
      const rows = [];
      for (const tr of this.tracks) {
        for (const s of tr.segs) {
          rows.push({
            target: tr.target.name(), prop: tr.prop, kind: s.kind, t0: +s.t0.toFixed(3), t1: +(s.t1 ?? s.t0).toFixed(3),
            from: s.from ? valueCss(s.from) : null, to: s.to ? valueCss(s.to) : null,
            ease: s.spring ? `spring(${+s.spring.duration.toFixed(3)}, ${s.spring.bounce})` : s.kind === 'set' ? 'step' : (s.ease && (s.ease.label || s.ease.css)) || 'custom',
            inertia: !!(s.inertia && s.inertia.v),
          });
        }
      }
      rows.sort((a, b) => a.t0 - b.t0);
      const out = [];
      for (const r of rows) {
        const d = r.t1 - r.t0;
        const g = r.target.includes('›') && out.find(x => x.target === r.target && x.prop === r.prop && x.ease === r.ease && x.kind === r.kind && Math.abs(x.dur - d) < 1e-3 && r.t0 - x.lastT0 < 0.5 && r.t0 >= x.lastT0 && String(x.to) === String(r.to));
        if (g) { g.count = (g.count || 1) + 1; g.t1 = Math.max(g.t1, r.t1); g.lastT0 = r.t0; continue; }
        out.push(Object.assign({}, r, { lastT0: r.t0, dur: d }));
      }
      return out.map(r => { const { lastT0, dur, ...rest } = r; if (rest.count) rest.target += ` ×${rest.count}`; return rest; });
    }

    // ── async init: fonts, images, then first frame
    async _init() {
      try { return await this._initInner(); } catch (e) {
        console.error('[motion] scene failed to start:', e);
        throw e;
      }
    }
    async _initInner() {
      await new Promise(r => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r()));
      await Promise.resolve(); // let the author's script finish adding animations
      await new Promise(r => setTimeout(r, 0));
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
      const imgs = Array.from(document.images).filter(i => !i.complete || !i.naturalWidth);
      await Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
      await Promise.all(this.waits.map(p => Promise.resolve(p).catch(() => {})));
      this._setupGrain();
      if (!RENDER) {
        this._player = new Player(this);
        if (global.MotionSFX) global.MotionSFX.attachPreview(this);
      }
      this.build();
      const q = new URLSearchParams(location.search);
      const t0 = RENDER ? 0 : q.has('t') ? parseFloat(q.get('t')) : 0;
      this.seek(t0);
      if (this._player) this._player.start(t0, !q.has('t') && q.get('autoplay') !== '0' && this.opts.autoplay !== false);
      return this;
    }

    _setupGrain() {
      const grains = this.stage.querySelectorAll('.grain');
      if (!grains.length) return;
      const size = 256, c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d'), img = g.createImageData(size, size), r = mulberry32(1234);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.floor(r() * 256);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const url = c.toDataURL('image/png');
      grains.forEach(el => { el.style.backgroundImage = `url(${url})`; });
      // Overlay grain does nothing on near-black, so dark scenes get a faint additive grain that still
      // dithers gradients (prevents banding in glows on black).
      const bg = parseColor(getComputedStyle(this.stage).backgroundColor) || [245, 245, 247, 1];
      const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
      if (bg[3] > 0.5 && lum < 0.25) grains.forEach(el => { el.style.mixBlendMode = 'screen'; if (!el.style.getPropertyValue('--grain')) el.style.setProperty('--grain', '.022'); });
      const rr = mulberry32(99);
      const jitter = Array.from({ length: 64 }, () => [Math.floor(rr() * size), Math.floor(rr() * size)]);
      this.onFrame(t => {
        const k = ((Math.floor(t * 24) % jitter.length) + jitter.length) % jitter.length; // grain refreshes at 24 fps, like film
        grains.forEach(el => { el.style.backgroundPosition = `${jitter[k][0]}px ${jitter[k][1]}px`; });
      });
    }

    // ───────────────────────────────────────────── moves (helpers) ──

    /** Entrance presets. style: rise | pop | blur | zoom | scale | left | right | down | fade */
    enter(targets, o = {}) {
      const style = o.style || 'rise', dist = o.dist ?? 48, at = this.at(o.at), stagger = o.stagger ?? 0.06;
      const list = this.resolveTargets(targets);
      const base = { at, stagger };
      switch (style) {
        case 'pop':
          this.from(list, { opacity: 0 }, Object.assign({}, base, { dur: 0.16, ease: 'linear' }));
          this.from(list, { scale: o.from ?? 0.4 }, Object.assign({}, base, { dur: o.dur ?? 0.55, ease: 'spring', bounce: o.bounce ?? 0.42 }));
          break;
        case 'scale':
          this.from(list, { opacity: 0 }, Object.assign({}, base, { dur: 0.12, ease: 'linear' }));
          this.from(list, { scale: o.from ?? 0 }, Object.assign({}, base, { dur: o.dur ?? 0.22, ease: 'linear', inertia: o.inertia ?? true }));
          break;
        case 'blur':
          this.from(list, { opacity: 0, blur: o.blur ?? 24, scale: o.from ?? 1.08 }, Object.assign({}, base, { dur: o.dur ?? 1.0, ease: o.ease || 'out' }));
          break;
        case 'zoom':
          this.from(list, { opacity: 0, blur: o.blur ?? 10, scale: o.from ?? 0.86 }, Object.assign({}, base, { dur: o.dur ?? 0.9, ease: o.ease || 'out' }));
          break;
        case 'left': case 'right':
          this.from(list, { opacity: 0, blur: o.blur ?? 8, x: style === 'left' ? -dist : dist }, Object.assign({}, base, { dur: o.dur ?? 0.8, ease: o.ease || 'out' }));
          break;
        case 'down':
          this.from(list, { opacity: 0, blur: o.blur ?? 8, y: -dist }, Object.assign({}, base, { dur: o.dur ?? 0.8, ease: o.ease || 'out' }));
          break;
        case 'fade':
          this.from(list, { opacity: 0 }, Object.assign({}, base, { dur: o.dur ?? 0.6, ease: o.ease || 'apple' }));
          break;
        default: // rise
          this.from(list, { opacity: 0, blur: o.blur ?? 10, y: dist }, Object.assign({}, base, { dur: o.dur ?? 0.85, ease: o.ease || 'out' }));
      }
      this.last = { start: at, end: at + (o.dur ?? 0.8) + stagger * Math.max(0, list.length - 1) };
      return this;
    }

    /** Exit presets. style: rise | fall | blur | shrink | left | right | fade */
    exit(targets, o = {}) {
      const style = o.style || 'blur', dist = o.dist ?? 32, at = this.at(o.at), stagger = o.stagger ?? 0.04;
      const dur = o.dur ?? 0.45, ease = o.ease || 'in';
      const props = {
        rise: { opacity: 0, y: -dist, blur: 10 },
        fall: { opacity: 0, y: dist, blur: 10 },
        blur: { opacity: 0, blur: o.blur ?? 16, scale: 0.97 },
        shrink: { opacity: 0, scale: 0.85, blur: 6 },
        left: { opacity: 0, x: -dist * 2, blur: 10 },
        right: { opacity: 0, x: dist * 2, blur: 10 },
        fade: { opacity: 0 },
      }[style] || { opacity: 0, blur: 16 };
      this.to(targets, props, { at, dur, ease, stagger });
      return this;
    }

    /** Pop in with a springy overshoot (bubbles, icons, badges). */
    pop(targets, o = {}) { return this.enter(targets, Object.assign({ style: 'pop' }, o)); }

    /** Button / card press: dip, then spring back. */
    press(targets, o = {}) {
      const at = this.at(o.at), depth = o.depth ?? 0.94;
      this.to(targets, { scale: depth }, { at, dur: o.down ?? 0.11, ease: 'out' });
      this.to(targets, { scale: 1 }, { at: at + (o.down ?? 0.11), dur: o.up ?? 0.5, ease: 'spring', bounce: o.bounce ?? 0.35 });
      if (o.dim !== false) {
        this.to(targets, { brightness: o.dim ?? 0.94 }, { at, dur: 0.1, ease: 'out' });
        this.to(targets, { brightness: 1 }, { at: at + 0.14, dur: 0.35, ease: 'out' });
      }
      this.last = { start: at, end: at + 0.45 };
      return this;
    }

    /** Blur-crossfade from one piece of content to another. */
    swap(outTargets, inTargets, o = {}) {
      const at = this.at(o.at), dur = o.dur ?? 0.6;
      if (outTargets) this.to(outTargets, { opacity: 0, blur: o.blur ?? 10, scale: o.outScale ?? 0.94 }, { at, dur: dur * 0.4, ease: 'in' });
      if (inTargets) this.fromTo(inTargets, { opacity: 0, blur: o.blur ?? 10, scale: o.inScale ?? 1.06 }, { opacity: 1, blur: 0, scale: 1 }, { at: at + dur * 0.25, dur: dur * 0.75, ease: 'out', stagger: o.stagger || 0 });
      this.last = { start: at, end: at + dur };
      return this;
    }

    /**
     * Shape morph: animate a container's box (w, h, r, bg, x, y …) and cross-fade
     * its content with blur. The container should clip its content (overflow:hidden).
     */
    morph(shell, props, o = {}) {
      const at = this.at(o.at), dur = o.dur ?? 0.8;
      const opts = { at, dur, ease: o.ease || 'morph' };
      if (o.inertia) opts.inertia = o.inertia;
      if (o.bounce != null) opts.bounce = o.bounce;
      if (o.arc) opts.arc = o.arc;
      this.to(shell, props, opts);
      const spring = SPRINGS[o.ease] || /^spring/.test(o.ease || '');
      // Tween morphs (the 'morph' curve) barely move at first, so content leaves once the shape
      // starts moving. Springs move immediately, so content must clear out immediately too.
      const outAt = at + dur * (spring ? 0 : 0.18), inAt = at + dur * (spring ? 0.22 : 0.45);
      if (o.out) this.to(o.out, { opacity: 0, blur: 8, scale: 0.92 }, spring ? { at: outAt, dur: dur * 0.22, ease: 'out' } : { at: outAt, dur: dur * 0.32, ease: 'in' });
      if (o.in) this.fromTo(o.in, { opacity: 0, blur: 10, scale: 1.08 }, { opacity: 1, blur: 0, scale: 1 }, { at: inAt, dur: dur * 0.8, ease: 'out', stagger: o.stagger || 0 });
      this.last = { start: at, end: at + dur };
      return this;
    }

    /**
     * Animated text. by: 'word' | 'char' | 'line'.
     * style: rise | spring | blur | mask | fade | pop. Returns the split pieces.
     */
    text(el, o = {}) {
      const host = this.resolveTargets(el)[0];
      if (!host) return [];
      const by = o.by || 'word';
      const pieces = split(host, by);
      this.hook(() => fixGradientText(host));
      const at = this.at(o.at);
      const stagger = o.stagger ?? (by === 'char' ? 0.025 : by === 'line' ? 0.12 : 0.07);
      const style = o.style || 'rise';
      const em = () => parseFloat(getComputedStyle(host).fontSize) || 40;
      const opts = (extra) => Object.assign({ at, stagger }, extra);
      switch (style) {
        case 'spring':
          this.from(pieces, { opacity: 0 }, opts({ dur: 0.18, ease: 'linear' }));
          this.from(pieces, { y: () => em() * (o.dist ?? 0.55) }, opts({ dur: o.dur ?? 0.8, ease: 'wordSpring' }));
          break;
        case 'blur':
          this.from(pieces, { opacity: 0, blur: o.blur ?? 14, scale: 1.12 }, opts({ dur: o.dur ?? 0.9, ease: o.ease || 'out' }));
          break;
        case 'mask': {
          pieces.forEach(p => {
            const w = document.createElement('span');
            w.className = 'm-mask';
            Object.assign(w.style, { display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', padding: '0.12em 0.04em 0.16em', margin: '-0.12em -0.04em -0.16em' });
            p.replaceWith(w);
            w.appendChild(p);
          });
          this.from(pieces, { y: p => p.offsetHeight * 1.15 }, opts({ dur: o.dur ?? 0.9, ease: o.ease || 'snap' }));
          break;
        }
        case 'fade':
          this.from(pieces, { opacity: 0 }, opts({ dur: o.dur ?? 0.5, ease: o.ease || 'apple' }));
          break;
        case 'highlight': // words wait dimmed, then light up in reading order (karaoke / voice-over sync)
          this.fromTo(pieces, { opacity: o.dim ?? 0.18 }, { opacity: 1 }, opts({ dur: o.dur ?? 0.35, ease: o.ease || 'out' }));
          break;
        case 'pop':
          this.from(pieces, { opacity: 0 }, opts({ dur: 0.12, ease: 'linear' }));
          this.from(pieces, { scale: 0.2, y: () => em() * 0.25 }, opts({ dur: o.dur ?? 0.5, ease: 'spring', bounce: o.bounce ?? 0.4 }));
          break;
        default: // rise
          this.from(pieces, { opacity: 0, y: () => em() * (o.dist ?? 0.45), blur: o.blur ?? 8 }, opts({ dur: o.dur ?? 0.75, ease: o.ease || 'out' }));
      }
      this.last = { start: at, end: at + (o.dur ?? 0.75) + stagger * Math.max(0, pieces.length - 1) };
      return pieces;
    }

    /** Typewriter. Human-ish rhythm (seeded), caret optional. */
    type(el, text, o = {}) {
      const host = this.resolveTargets(el)[0];
      if (!host) return this;
      const at = this.at(o.at), cps = o.cps ?? 16, rnd = mulberry32(o.seed ?? 11);
      host.textContent = '';
      const typed = document.createElement('span');
      typed.className = 'm-typed';
      host.appendChild(typed);
      let caret = null;
      if (o.caret !== false) {
        caret = document.createElement('span');
        caret.className = 'm-caret';
        host.appendChild(caret);
      }
      const chars = graphemes(text), times = [];
      let t = at;
      chars.forEach(ch => {
        times.push(t);
        let d = (1 / cps) * (0.65 + rnd() * 0.7);
        if (/[,.!?;:]/.test(ch)) d += 0.12;
        else if (ch === ' ') d *= 1.25;
        t += d;
      });
      const end = t, caretOff = o.caretOff != null ? this.at(o.caretOff) : Infinity;
      this.onFrame(time => {
        let n = 0;
        while (n < times.length && times[n] <= time) n++;
        const s = chars.slice(0, n).join('');
        if (typed.textContent !== s) typed.textContent = s;
        if (caret) {
          const typing = time >= at - 0.4 && time <= end + 0.05;
          const on = time >= caretOff ? false : typing ? true : time < at - 0.4 ? false : (time - end) % 1.06 < 0.53;
          caret.style.opacity = on ? '1' : '0';
        }
      });
      this.last = { start: at, end };
      return this;
    }

    /** Count a number up/down. Tabular digits so the width doesn't jitter. */
    count(el, o = {}) {
      const host = this.resolveTargets(el)[0];
      if (!host) return this;
      const at = this.at(o.at), dur = o.dur ?? 1.2, from = o.from ?? 0, to = o.to ?? 100;
      const ez = resolveEase(o.ease || 'out', o).fn || EASES.out;
      const dec = o.decimals ?? 0, pre = o.prefix ?? '', suf = o.suffix ?? '', sep = o.separator ?? ',';
      host.style.fontVariantNumeric = 'tabular-nums';
      const format = o.format || (v => {
        const [i, f] = Math.abs(v).toFixed(dec).split('.');
        return (v < 0 ? '−' : '') + pre + i.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (f ? '.' + f : '') + suf;
      });
      this.onFrame(t => {
        const p = Math.max(0, Math.min(1, (t - at) / dur));
        const s = format(from + (to - from) * ez(p));
        if (host.textContent !== s) host.textContent = s;
      });
      this.last = { start: at, end: at + dur };
      return this;
    }

    /**
     * Cursor choreography. keys: [{at, x, y} | {at, to:'#el', dx, dy} | {at, click:true|'#el'}]
     * Positions are stage px of the cursor tip. Moves glide along a slight arc.
     */
    cursor(el, keys) {
      const cur = this.resolveTargets(el)[0];
      if (!cur) return this;
      let first = true;
      keys.forEach(k => {
        const at = this.at(k.at);
        if (k.click) {
          this.to(cur, { scale: 0.82 }, { at, dur: 0.08, ease: 'out' });
          this.to(cur, { scale: 1 }, { at: at + 0.09, dur: 0.35, ease: 'spring', bounce: 0.3 });
          if (k.click !== true) this.press(k.click, { at: at + 0.02, depth: k.depth });
          if (k.sfx !== false && k.sound) this.sfx(k.sound === true ? 'click' : k.sound, at);
          return;
        }
        let pos = { x: k.x, y: k.y };
        if (k.to) {
          const req = { target: k.to, time: at + (first ? 0 : k.dur ?? 0.8), tracks: [this.track(cur, 'x'), this.track(cur, 'y')], value: null };
          (this._measures || (this._measures = [])).push(req);
          const pt = () => req.value || center(this.resolveTargets(k.to)[0], this);
          pos = { x: () => pt().x + (k.dx || 0), y: () => pt().y + (k.dy || 0) };
        }
        if (first) { this.set(cur, pos, at); first = false; return; }
        this.to(cur, pos, { at, dur: k.dur ?? 0.8, ease: k.ease || 'inOut', arc: k.arc ?? 0.12 });
      });
      return this;
    }

    /** Gentle idle float so nothing is ever perfectly frozen. */
    float(targets, o = {}) {
      const amp = o.amp ?? 6, period = o.period ?? 4, rot = o.rotate ?? 0, from = this.at(o.from ?? 0), to = o.to != null ? this.at(o.to) : Infinity;
      const fade = (t) => Math.min(1, Math.max(0, (t - from) / 0.6), isFinite(to) ? Math.max(0, (to - t) / 0.6) : 1);
      this.add(targets, 'y', (t, i) => amp * fade(t) * Math.sin((2 * Math.PI * t) / period + i * 1.7), [from, to]);
      if (rot) this.add(targets, 'rotate', (t, i) => rot * fade(t) * Math.sin((2 * Math.PI * t) / (period * 1.3) + i * 2.3), [from, to]);
      return this;
    }

    /** Handheld-camera drift: smooth pseudo-random x/y/rotation. Apply to the camera. */
    drift(targets, o = {}) {
      const amp = o.amp ?? 5, rot = o.rotate ?? 0.25, speed = o.speed ?? 1, r = mulberry32(o.seed ?? 3);
      const waves = () => Array.from({ length: 3 }, () => [0.05 + r() * 0.13, r() * Math.PI * 2]);
      const wx = waves(), wy = waves(), wr = waves();
      const noise = (w, t) => w.reduce((s, [f, ph]) => s + Math.sin(2 * Math.PI * f * speed * t + ph), 0) / w.length;
      this.add(targets, 'x', t => amp * noise(wx, t));
      this.add(targets, 'y', t => amp * noise(wy, t));
      if (rot) this.add(targets, 'rotate', t => rot * noise(wr, t));
      return this;
    }

    /** iOS "wrong password" shake. */
    shake(targets, o = {}) {
      const at = this.at(o.at), amp = o.amp ?? 18, freq = o.freq ?? 7, decay = o.decay ?? 5.5;
      this.add(targets, 'x', t => (t < at ? 0 : amp * Math.sin(2 * Math.PI * freq * (t - at)) * Math.exp(-decay * (t - at))), [at, at + 1.4]);
      return this;
    }

    /** Draw SVG strokes on (0 → 1). */
    draw(targets, o = {}) {
      const list = this.resolveTargets(targets);
      list.forEach(p => p.setAttribute('pathLength', '1'));
      this.fromTo(list, { draw: o.from ?? 0 }, { draw: o.to ?? 1 }, { at: o.at, dur: o.dur ?? 1.2, ease: o.ease || 'inOut', stagger: o.stagger || 0 });
      return this;
    }

    /** Morph an SVG <path> through shapes (array of path strings). Single-contour shapes. */
    morphPath(target, shapes, o = {}) {
      const path = this.resolveTargets(target)[0];
      if (!path || shapes.length < 2) return this;
      const N = o.samples || 96;
      const at = this.at(o.at), dur = o.dur ?? 0.9, gap = o.gap ?? 0.4;
      const ez = resolveEase(o.ease || 'morph', o).fn || EASES.morph;
      let pts = null;
      this.hook(() => { pts = alignShapes(shapes.map(d => samplePath(d, N))); });
      this.onFrame(t => {
        if (!pts) return;
        let i = 0;
        const seg = dur + gap;
        const k = Math.min(shapes.length - 2, Math.max(0, Math.floor((t - at) / seg)));
        i = k;
        const p = ez(Math.max(0, Math.min(1, (t - at - k * seg) / dur)));
        const A = pts[i], B = pts[i + 1];
        const mix = A.map((a, j) => [a[0] + (B[j][0] - a[0]) * p, a[1] + (B[j][1] - a[1]) * p]);
        const d = catmullRom(mix);
        if (path.__lastD !== d) { path.setAttribute('d', d); path.__lastD = d; }
      });
      this.last = { start: at, end: at + (shapes.length - 1) * (dur + gap) };
      return this;
    }

    /** Frame an element (or {x,y} stage point) with the camera: centers it and zooms. */
    focus(camera, target, o = {}) {
      const zoom = o.zoom ?? 1.6;
      const pt = () => (target && target.x != null && !isEl(target) ? target : center(this.resolveTargets(target)[0], this));
      this.to(camera, {
        x: () => -(pt().x - this.width / 2) * zoom + (o.dx || 0),
        y: () => -(pt().y - this.height / 2) * zoom + (o.dy || 0),
        scale: zoom,
      }, { at: o.at, dur: o.dur ?? 1.2, ease: o.ease || 'swoop' });
      return this;
    }
  }

  /** Center of an element in stage px (measured at build time, before animation). */
  function center(el, scene) {
    if (!el) return { x: 0, y: 0 };
    const s = scene.stage.getBoundingClientRect(), r = el.getBoundingClientRect(), k = scene._fit || s.width / scene.width || 1;
    return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k };
  }

  // ─────────────────────────────────────────── path morph helpers ──

  let _svg = null;
  function samplePath(d, n) {
    if (!_svg) {
      _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      _svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      document.body.appendChild(_svg);
    }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    _svg.appendChild(p);
    const L = p.getTotalLength(), out = [];
    for (let i = 0; i < n; i++) {
      const q = p.getPointAtLength((L * i) / n);
      out.push([q.x, q.y]);
    }
    p.remove();
    // normalise winding to clockwise
    let area = 0;
    for (let i = 0; i < n; i++) { const a = out[i], b = out[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) out.reverse();
    return out;
  }
  function alignShapes(list) {
    for (let s = 1; s < list.length; s++) {
      const A = list[s - 1], B = list[s], n = B.length;
      let best = 0, bestD = Infinity;
      for (let off = 0; off < n; off++) {
        let d = 0;
        for (let i = 0; i < n; i += 4) { const b = B[(i + off) % n]; d += (A[i][0] - b[0]) ** 2 + (A[i][1] - b[1]) ** 2; }
        if (d < bestD) { bestD = d; best = off; }
      }
      list[s] = B.map((_, i) => B[(i + best) % n]);
    }
    return list;
  }
  function catmullRom(pts) {
    const n = pts.length, f = v => fmt(v, 2);
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
    }
    return d + 'Z';
  }

  // ──────────────────────────────────────────── icons + cursors ──

  // SF-Symbols-flavoured line icons on a 24-unit grid. Use <i class="icon" data-icon="name"></i>
  // (filled on load) or Motion.icon('name'). Color = currentColor, size = the element's font-size box.
  const ICONS = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/>',
    'arrow-right': '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>',
    'arrow-up': '<path d="M12 19.5v-14M6.5 11L12 5.5l5.5 5.5"/>',
    'arrow-down': '<path d="M12 4.5v14M6.5 13l5.5 5.5 5.5-5.5"/>',
    'chevron-right': '<path d="M9 5l7 7-7 7"/>',
    'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.1C4.5 7 6.6 5 9 5c1.4 0 2.4.6 3 1.6C12.6 5.6 13.6 5 15 5c2.4 0 4.5 2 4.5 4.9C19.5 15.4 12 20 12 20z" fill="currentColor" stroke="none"/>',
    'heart-line': '<path d="M12 20s-7.5-4.6-7.5-10.1C4.5 7 6.6 5 9 5c1.4 0 2.4.6 3 1.6C12.6 5.6 13.6 5 15 5c2.4 0 4.5 2 4.5 4.9C19.5 15.4 12 20 12 20z"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z" fill="currentColor" stroke="none"/>',
    sparkle: '<path d="M12 2.5c.6 4.9 2.6 6.9 7.5 7.5-4.9.6-6.9 2.6-7.5 7.5-.6-4.9-2.6-6.9-7.5-7.5 4.9-.6 6.9-2.6 7.5-7.5z" fill="currentColor" stroke="none"/><path d="M18.5 15.5c.25 1.9 1 2.7 3 3-2 .3-2.75 1.1-3 3-.25-1.9-1-2.7-3-3 2-.3 2.75-1.1 3-3z" fill="currentColor" stroke="none"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
    message: '<path d="M12 4.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L4.5 19.5l1.3-3.6C4.4 14.6 3.5 13.1 3.5 11.5c0-3.9 3.8-7 8.5-7z" fill="currentColor" stroke="none"/>',
    phone: '<path d="M7.2 3.8l2.2-.3 1.6 4.2-1.9 1.5a11 11 0 005.7 5.7l1.5-1.9 4.2 1.6-.3 2.2c-.2 1.4-1.4 2.4-2.8 2.3C10.3 18.7 5.3 13.7 4.9 6.6c-.1-1.4.9-2.6 2.3-2.8z" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3.2"/>',
    forward: '<path d="M3.5 6.5v11l8-5.5zM12.5 6.5v11l8-5.5z" fill="currentColor" stroke="none"/>',
    backward: '<path d="M20.5 6.5v11l-8-5.5zM11.5 6.5v11l-8-5.5z" fill="currentColor" stroke="none"/>',
    location: '<path d="M20 4L4 11l7 2 2 7z" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2.5" fill="currentColor" stroke="none"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
    bolt: '<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" fill="currentColor" stroke="none"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5v3.5"/>',
    camera: '<path d="M4 8.5a2 2 0 012-2h2.2l1.4-2h4.8l1.4 2H18a2 2 0 012 2V17a2 2 0 01-2 2H6a2 2 0 01-2-2z"/><circle cx="12" cy="12.6" r="3.3"/>',
    music: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5" fill="currentColor"/><circle cx="16.5" cy="15.5" r="2.5" fill="currentColor"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"/>',
    person: '<circle cx="12" cy="8.5" r="3.8" fill="currentColor" stroke="none"/><path d="M4.5 20c.8-3.9 3.9-6 7.5-6s6.7 2.1 7.5 6z" fill="currentColor" stroke="none"/>',
    wifi: '<path d="M2.8 9.3a13.5 13.5 0 0118.4 0M6 12.6a9 9 0 0112 0M9.2 15.9a4.5 4.5 0 015.6 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>',
    battery: '<rect x="2.5" y="7" width="17" height="10" rx="3"/><rect x="4.5" y="9" width="11" height="6" rx="1.4" fill="currentColor" stroke="none"/><path d="M21.5 10.5v3"/>',
    signal: '<path d="M4 18v-2M9 18v-5M14 18v-8M19 18V7" stroke-width="3"/>',
    send: '<path d="M12 19.5v-14M6.5 11L12 5.5l5.5 5.5"/>',
    home: '<path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 01-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 014 19z"/>',
    cart: '<path d="M3 4.5h2.5l2.2 10.5h10.8L20.5 8H7"/><circle cx="9.5" cy="19" r="1.4" fill="currentColor"/><circle cx="17" cy="19" r="1.4" fill="currentColor"/>',
    share: '<path d="M12 3.5v11M8 7.5l4-4 4 4M7 10.5H5.5v10h13v-10H17"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z"/>',
    photo: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.7" fill="currentColor"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>',
    flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.3-5.4 3.6-7.9.5 1.7 1.4 2.8 2.4 3.2-.2-3.3 1-6.1 3.5-7.6-.3 3.2 1.6 5 2.8 6.9.9 1.4 1.7 3 1.7 5.2 0 3.6-2.8 6.4-7.5 6.4z" fill="currentColor" stroke="none"/>',
    waveform: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
  };
  function icon(name, attrs = '') {
    const body = ICONS[name];
    if (!body) { warn(`Unknown icon "${name}". Available: ${Object.keys(ICONS).join(', ')}`); return ''; }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${attrs}>${body}</svg>`;
  }
  const CURSORS = {
    // macOS arrow: tip at (8,4) in a 32 box
    arrow: { svg: '<svg viewBox="0 0 32 32"><path d="M8 4v22.2l5.2-5.1 3.5 7.9 3.6-1.5-3.4-7.8h7.3z" fill="#000" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>', tip: [8, 4] },
    // pointing hand: tip at (13,1.8)
    hand: { svg: '<svg viewBox="0 0 32 32"><path d="M11.2 3.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8V12h.4c.1-.9.9-1.6 1.8-1.6 1 0 1.8.8 1.8 1.8v.8c.3-.6.9-1 1.6-1 1 0 1.8.8 1.8 1.8v.9c.3-.5.8-.8 1.4-.8 1 0 1.8.8 1.8 1.8v5.9c0 4.6-3.2 8.2-7.4 8.2h-2.3c-2.4 0-4.2-1-5.6-3l-4.3-6.2c-.6-.8-.4-1.9.4-2.5.8-.5 1.8-.4 2.4.3l1.9 2.2z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/><path d="M15.2 12.3v5.4M18.6 13v4.8M22 14v3.8" stroke="#000" stroke-width="1.2" stroke-linecap="round"/></svg>', tip: [13, 1.8] },
  };
  function fillIcons(root) {
    root.querySelectorAll('[data-icon]').forEach(el => { if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon); });
    root.querySelectorAll('.cursor').forEach(el => {
      if (el.firstElementChild) return;
      const c = el.classList.contains('hand') ? CURSORS.hand : CURSORS.arrow;
      el.innerHTML = c.svg;
      const w = el.offsetWidth || 44, k = w / 32;
      el.style.transformOrigin = `${c.tip[0] * k}px ${c.tip[1] * k}px`;
      el.style.margin = `${-c.tip[1] * k}px 0 0 ${-c.tip[0] * k}px`;
    });
    if (root.querySelector('.goo') && !document.getElementById('m-goo')) {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('style', 'position:absolute;width:0;height:0');
      s.innerHTML = '<defs><filter id="m-goo" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="14" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 26 -11" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></defs>';
      document.body.appendChild(s);
    }
  }

  // ─────────────────────────────────────────────────────── player ──

  class Player {
    constructor(scene) {
      this.scene = scene;
      this.playing = false;
      this.speed = 1;
      this.loop = true;
      const q = new URLSearchParams(location.search);
      if (q.has('speed')) this.speed = parseFloat(q.get('speed')) || 1;
      this.showUI = q.get('controls') !== '0' && scene.opts.controls !== false;
      document.documentElement.classList.add('m-preview');
      this.fit = this.fit.bind(this);
      window.addEventListener('resize', this.fit);
      this.fit();
      if (this.showUI) this.buildUI();
      this.tick = this.tick.bind(this);
    }
    fit() {
      const sc = this.scene, W = window.innerWidth, H = window.innerHeight - (this.showUI ? 0 : 0);
      const s = Math.min(W / sc.width, H / sc.height);
      const ox = (W - sc.width * s) / 2, oy = (H - sc.height * s) / 2;
      sc._fit = s;
      Object.assign(sc.stage.style, { position: 'absolute', left: '0px', top: '0px', transformOrigin: '0 0', transform: `translate(${ox}px, ${oy}px) scale(${s})` });
    }
    buildUI() {
      const bar = document.createElement('div');
      bar.className = 'm-bar';
      bar.innerHTML = `
        <button class="m-play" title="Play/Pause (Space)"></button>
        <span class="m-time">0:00.00</span>
        <div class="m-track"><div class="m-fill"></div><div class="m-knob"></div></div>
        <span class="m-dur"></span>
        <button class="m-speed" title="Playback speed (1/2/3)">1×</button>
        <button class="m-loop on" title="Loop (L)">⟲</button>`;
      document.body.appendChild(bar);
      this.bar = bar;
      this.$play = bar.querySelector('.m-play');
      this.$time = bar.querySelector('.m-time');
      this.$fill = bar.querySelector('.m-fill');
      this.$knob = bar.querySelector('.m-knob');
      this.$speed = bar.querySelector('.m-speed');
      this.$loop = bar.querySelector('.m-loop');
      bar.querySelector('.m-dur').textContent = fmtTime(this.scene.duration);
      this.$play.onclick = () => this.toggle();
      this.$loop.onclick = () => { this.loop = !this.loop; this.$loop.classList.toggle('on', this.loop); };
      const speeds = [1, 0.5, 0.25, 2];
      this.$speed.onclick = () => this.setSpeed(speeds[(speeds.indexOf(this.speed) + 1) % speeds.length]);
      this.$speed.textContent = this.speed + '×';
      const trk = bar.querySelector('.m-track');
      const scrub = e => {
        const r = trk.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        this.pause();
        this.seek(p * this.scene.duration);
      };
      trk.addEventListener('pointerdown', e => {
        trk.setPointerCapture(e.pointerId);
        scrub(e);
        const mv = ev => scrub(ev);
        trk.addEventListener('pointermove', mv);
        trk.addEventListener('pointerup', () => trk.removeEventListener('pointermove', mv), { once: true });
      });
      let idle;
      const wake = () => {
        document.documentElement.classList.remove('m-idle');
        clearTimeout(idle);
        idle = setTimeout(() => { if (this.playing) document.documentElement.classList.add('m-idle'); }, 1800);
      };
      window.addEventListener('pointermove', wake);
      window.addEventListener('keydown', e => {
        if (e.target && /input|textarea/i.test(e.target.tagName)) return;
        const fr = 1 / this.scene.fps;
        if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
        else if (e.key === 'ArrowRight') { this.pause(); this.seek(this.scene.time + (e.shiftKey ? 1 : fr)); }
        else if (e.key === 'ArrowLeft') { this.pause(); this.seek(this.scene.time - (e.shiftKey ? 1 : fr)); }
        else if (e.key === 'Home' || e.key === '0') { this.seek(0); }
        else if (e.key === 'l' || e.key === 'L') this.$loop.click();
        else if (e.key === '1') this.setSpeed(1);
        else if (e.key === '2') this.setSpeed(0.5);
        else if (e.key === '3') this.setSpeed(0.25);
        wake();
      });
      wake();
    }
    setSpeed(s) {
      this.speed = s;
      if (this.$speed) this.$speed.textContent = s + '×';
      if (this.playing) { this.origin = performance.now(); this.originT = this.scene.time; }
    }
    seek(t) {
      const d = this.scene.duration;
      t = Math.max(0, Math.min(d, t));
      this.scene.seek(t);
      this.updateUI();
    }
    updateUI() {
      if (!this.bar) return;
      const t = this.scene.time, d = this.scene.duration;
      this.$time.textContent = fmtTime(t);
      const p = (100 * t) / d;
      this.$fill.style.width = p + '%';
      this.$knob.style.left = p + '%';
      this.$play.classList.toggle('playing', this.playing);
    }
    start(t0, autoplay) {
      this.seek(t0);
      if (autoplay) this.play();
      else this.updateUI();
    }
    play() {
      if (this.playing) return;
      if (this.scene.time >= this.scene.duration - 1e-3) this.scene.time = 0;
      this.playing = true;
      this.origin = performance.now();
      this.originT = this.scene.time;
      requestAnimationFrame(this.tick);
      this.updateUI();
    }
    pause() { this.playing = false; this.updateUI(); }
    toggle() { this.playing ? this.pause() : this.play(); }
    tick(now) {
      if (!this.playing) return;
      const d = this.scene.duration;
      let t = this.originT + ((now - this.origin) / 1000) * this.speed;
      if (t >= d) {
        if (this.loop) { t = t % d; this.origin = now; this.originT = t; }
        else { t = d; this.playing = false; }
      }
      this.scene.seek(t);
      this.updateUI();
      if (this.playing) requestAnimationFrame(this.tick);
    }
  }

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  // ─────────────────────────────────────────────────────── export ──

  let current = null;
  const Motion = {
    scene(opts) {
      current = new Scene(opts);
      global.__MOTION__ = {
        get ready() { return current.ready.then(() => true); },
        get duration() { return current.duration; },
        get fps() { return current.fps; },
        get width() { return current.width; },
        get height() { return current.height; },
        seek: (t, frameTime) => { current.seek(t, frameTime); },
        motionBetween: (a, b) => current.motionBetween(a, b),
        get cues() { return current.cues; },
        describe: () => current.describe(),
      };
      return current;
    },
    ease: Object.assign({}, EASES, { bezier, dampedCos, spring: makeSpring, resolve: (s, o = {}) => resolveEase(s, o) }),
    springs: SPRINGS,
    split,
    icon,
    icons: Object.keys(ICONS),
    rand: mulberry32,
    center: el => center(typeof el === 'string' ? document.querySelector(el) : el, current),
    color: { parse: parseColor, mix: mixColor },
    get current() { return current; },
    version: '1.0.0',
  };
  global.Motion = Motion;
})(typeof window !== 'undefined' ? window : globalThis);
