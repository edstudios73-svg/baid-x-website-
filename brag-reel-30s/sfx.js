/*!
 * sfx.js — tiny procedural UI sound kit (pop, click, whoosh, …) for motion.js scenes.
 * The same code runs in the browser preview (WebAudio) and in scripts/render.mjs (WAV),
 * so what you hear while previewing is what ends up in the video.
 *
 *   m.sfx('pop', 1.20)                    // at 1.2 s
 *   m.sfx('whoosh', 3.0, { gain: 0.7, pan: -0.3, rate: 1.1 })
 *
 * Sounds: pop, bubble, click, tap, tick, type, whoosh, swish, swoosh-up, rise, thud, chime, success, error, send
 */
(function (g) {
  'use strict';

  // deterministic noise so renders are reproducible
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) / 4294967296) * 2 - 1; };
  }

  // one-pole / biquad helpers
  function biquad(type, f, q, sr) {
    const w = (2 * Math.PI * f) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return x => { const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  }

  // Chamberlin state-variable filter, cascaded twice (24 dB/oct) — smooth, sweepable "air"
  function svf2() {
    let l1 = 0, b1 = 0, l2 = 0, b2 = 0;
    return (x, fc, q, sr) => {
      const f = 2 * Math.sin(Math.PI * Math.min(fc, sr / 7) / sr), d = 1 / q;
      l1 += f * b1; const h1 = x - l1 - d * b1; b1 += f * h1;
      l2 += f * b2; const h2 = l1 - l2 - d * b2; b2 += f * h2;
      return { low: l2, band: b1 };
    };
  }

  const DEFS = {
    // bubbly UI pop: fast pitch drop + soft click
    pop(sr, o) {
      const n = Math.round(sr * 0.16), out = new Float32Array(n), r = rng(7);
      const f0 = 820 * o.rate, f1 = 360 * o.rate;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = f1 + (f0 - f1) * Math.exp(-t / 0.018);
        ph += (2 * Math.PI * f) / sr;
        const env = Math.min(1, t / 0.0015) * Math.exp(-t / 0.032);
        out[i] = env * (Math.sin(ph) * 0.9 + Math.sin(2 * ph) * 0.18) + r() * Math.exp(-t / 0.0012) * 0.25;
      }
      return out;
    },
    // rounder, wetter pop (message bubble)
    bubble(sr, o) {
      const n = Math.round(sr * 0.2), out = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = (380 + 520 * (1 - Math.exp(-t / 0.03))) * o.rate;
        ph += (2 * Math.PI * f) / sr;
        const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.045);
        out[i] = env * Math.sin(ph) * 0.9;
      }
      return out;
    },
    // crisp UI click (button press, cursor click)
    click(sr, o) {
      const n = Math.round(sr * 0.05), out = new Float32Array(n), r = rng(3), bp = biquad('bp', 3200 * o.rate, 1.2, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        out[i] = bp(r()) * Math.exp(-t / 0.004) * 2.2 + Math.sin(2 * Math.PI * 1900 * o.rate * t) * Math.exp(-t / 0.006) * 0.5;
      }
      return out;
    },
    // softer, lower tap
    tap(sr, o) {
      const n = Math.round(sr * 0.06), out = new Float32Array(n), r = rng(5), lp = biquad('lp', 2400, 0.7, sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        out[i] = Math.sin(2 * Math.PI * 1150 * o.rate * t) * Math.exp(-t / 0.012) * 0.8 + lp(r()) * Math.exp(-t / 0.003) * 0.6;
      }
      return out;
    },
    // tiny tick (counters, pickers)
    tick(sr, o) {
      const n = Math.round(sr * 0.02), out = new Float32Array(n), r = rng(9), hp = biquad('hp', 4000, 0.8, sr);
      for (let i = 0; i < n; i++) { const t = i / sr; out[i] = hp(r()) * Math.exp(-t / 0.0018) * 1.6 + Math.sin(2 * Math.PI * 5200 * o.rate * t) * Math.exp(-t / 0.002) * 0.3; }
      return out;
    },
    // keyboard key
    type(sr, o) {
      const n = Math.round(sr * 0.045), out = new Float32Array(n), r = rng(11 + Math.floor(o.seed * 97)), bp = biquad('bp', (1800 + o.seed * 900) * o.rate, 1.4, sr);
      for (let i = 0; i < n; i++) { const t = i / sr; out[i] = bp(r()) * (Math.exp(-t / 0.0035) * 2 + Math.exp(-Math.max(0, t - 0.012) / 0.004) * (t > 0.012 ? 0.7 : 0)); }
      return out;
    },
    // air moving past: band-passed noise with a sweep and swell
    whoosh(sr, o) {
      const dur = 0.6 / o.rate, n = Math.round(sr * dur), out = new Float32Array(n), r = rng(21), f = svf2();
      for (let i = 0; i < n; i++) {
        const p = i / n;
        const fc = 260 + 1700 * Math.pow(Math.sin(Math.PI * Math.pow(p, 0.75)), 1.5);
        const y = f(r(), fc * o.rate, 0.9, sr);
        const env = Math.pow(Math.sin(Math.PI * Math.pow(p, 0.62)), 2.2);
        out[i] = (y.low + y.band * 0.35) * env;
      }
      return out;
    },
    // short, brighter whoosh
    swish(sr, o) {
      const dur = 0.3 / o.rate, n = Math.round(sr * dur), out = new Float32Array(n), r = rng(23), f = svf2();
      for (let i = 0; i < n; i++) {
        const p = i / n, fc = 700 + 2600 * Math.sin(Math.PI * p);
        const y = f(r(), fc * o.rate, 1.1, sr);
        out[i] = (y.low + y.band * 0.4) * Math.pow(Math.sin(Math.PI * Math.pow(p, 0.5)), 2);
      }
      return out;
    },
    // upward swoosh (send / launch)
    'swoosh-up'(sr, o) {
      const dur = 0.38 / o.rate, n = Math.round(sr * dur), out = new Float32Array(n), r = rng(29), f = svf2();
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const p = i / n, fc = 400 + 2800 * p * p;
        const y = f(r(), fc * o.rate, 1.2, sr);
        ph += (2 * Math.PI * (320 + 880 * p) * o.rate) / sr;
        const env = Math.pow(Math.sin(Math.PI * Math.pow(p, 0.8)), 1.6);
        out[i] = (y.low + y.band * 0.5 + Math.sin(ph) * 0.05) * env;
      }
      return out;
    },
    // riser into a transition (use 0.5–1.5 s before the hit)
    rise(sr, o) {
      const dur = (o.dur || 1.2), n = Math.round(sr * dur), out = new Float32Array(n), r = rng(31), f = svf2();
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const p = i / n, fc = 250 + 3800 * p * p * p;
        const y = f(r(), fc * o.rate, 1.4, sr);
        ph += (2 * Math.PI * (160 + 640 * p * p) * o.rate) / sr;
        const env = Math.pow(p, 2.2) * (1 - Math.pow(p, 40));
        out[i] = (y.low + y.band * 0.6 + Math.sin(ph) * 0.08) * env;
      }
      return out;
    },
    // soft low landing
    thud(sr, o) {
      const n = Math.round(sr * 0.3), out = new Float32Array(n), r = rng(37), lp = biquad('lp', 400, 0.7, sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, f = (70 + 90 * Math.exp(-t / 0.03)) * o.rate;
        ph += (2 * Math.PI * f) / sr;
        out[i] = Math.sin(ph) * Math.exp(-t / 0.08) * 0.9 + lp(r()) * Math.exp(-t / 0.01) * 0.5;
      }
      return out;
    },
    // gentle bell (notification, reveal)
    chime(sr, o) {
      const n = Math.round(sr * 3.2), out = new Float32Array(n);
      const partials = [[1, 1, 0.9], [2.01, 0.35, 0.55], [2.76, 0.18, 0.35], [5.4, 0.06, 0.2]];
      const f0 = 1046.5 * o.rate;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let v = 0;
        for (const [m, a, d] of partials) v += a * Math.sin(2 * Math.PI * f0 * m * t) * Math.exp(-t / d);
        out[i] = v * Math.min(1, t / 0.002) * 0.55;
      }
      return out;
    },
    // two rising notes (done / success)
    success(sr, o) {
      const n = Math.round(sr * 1.6), out = new Float32Array(n);
      const notes = [[0, 880], [0.09, 1318.5]];
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let v = 0;
        for (const [st, f] of notes) if (t >= st) { const u = t - st; v += (Math.sin(2 * Math.PI * f * o.rate * u) + 0.3 * Math.sin(4 * Math.PI * f * o.rate * u)) * Math.exp(-u / 0.28) * Math.min(1, u / 0.003); }
        out[i] = v * 0.45;
      }
      return out;
    },
    // two low buzzes (error / denied)
    error(sr, o) {
      const n = Math.round(sr * 0.35), out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr, gate = (t < 0.12 || (t > 0.17 && t < 0.3)) ? 1 : 0;
        const f = 180 * o.rate;
        out[i] = gate * (Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.12 + Math.sin(2 * Math.PI * f * t) * 0.3) * Math.min(1, (t % 0.17) / 0.004);
      }
      return out;
    },
    // message sent: quick upward chirp + air
    send(sr, o) {
      const n = Math.round(sr * 0.24), out = new Float32Array(n), r = rng(41), f = svf2();
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, p = t / 0.24;
        ph += (2 * Math.PI * (520 + 1400 * p) * o.rate) / sr;
        const y = f(r(), (1200 + 2400 * p) * o.rate, 1.3, sr);
        out[i] = (Math.sin(ph) * 0.35 + y.low + y.band * 0.4) * Math.sin(Math.PI * p) * Math.exp(-p * 1.4);
      }
      return out;
    },
  };

  /** Synthesize one sound → Float32Array (mono). opts: { rate, seed, dur } */
  function synth(name, sr = 48000, opts = {}) {
    const def = DEFS[name];
    if (!def) return null;
    const o = { rate: opts.rate || 1, seed: opts.seed || 0, dur: opts.dur };
    const buf = def(sr, o);
    // normalise each sound to a consistent peak so gains mean the same thing
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    const k = peak > 0 ? 0.5 / peak : 1;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
    // click-free tail: 15 ms raised-cosine fade at the end of every sound
    const f = Math.min(buf.length, Math.round(sr * 0.015));
    for (let i = 0; i < f; i++) buf[buf.length - f + i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / f);
    return buf;
  }

  /** Mix cues into stereo buffers. cues: [{name, at, gain, pan, rate}] */
  function mix(cues, seconds, sr = 48000, loadFile, opts = {}) {
    const n = Math.ceil(seconds * sr) + sr;
    const L = new Float32Array(n), R = new Float32Array(n);
    cues.forEach((c, idx) => {
      let mono = synth(c.name, sr, { rate: c.rate, seed: c.seed ?? idx * 0.37 % 1, dur: c.dur });
      let stereo = null;
      if (!mono && loadFile) stereo = loadFile(c.name);
      if (!mono && !stereo) return;
      const g = c.gain ?? 1, pan = Math.max(-1, Math.min(1, c.pan || 0));
      const gl = g * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, gr = g * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
      const start = Math.round(c.at * sr);
      const len = stereo ? stereo[0].length : mono.length;
      for (let i = 0; i < len; i++) {
        const j = start + i;
        if (j < 0 || j >= n) continue;
        L[j] += (stereo ? stereo[0][i] : mono[i]) * gl;
        R[j] += (stereo ? stereo[1][i] : mono[i]) * gr;
      }
    });
    // master bus: cue gains are relative; normalize the whole bus to a consistent peak (default -6 dBFS)
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const target = Math.pow(10, (opts.peakDb ?? -6) / 20);
    const k = peak > 1e-6 ? target / peak : 1;
    // gentle soft-clip so stacked sounds never crackle
    for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * k * 1.05) / 1.05; R[i] = Math.tanh(R[i] * k * 1.05) / 1.05; }
    return [L, R];
  }

  function toWav([L, R], sr = 48000) {
    const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++, o += 4) {
      v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    return buf;
  }

  // ── browser preview: play cues in sync with the player (unmute with the 🔊 button or "M")
  function attachPreview(scene) {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    let ctx = null, on = false, lastT = null;
    const cache = new Map();
    const play = c => {
      if (!ctx) return;
      const key = c.name + '|' + (c.rate || 1);
      let mono = cache.get(key);
      if (!mono) { mono = synth(c.name, ctx.sampleRate, { rate: c.rate }); if (!mono) return; cache.set(key, mono); }
      const b = ctx.createBuffer(1, mono.length, ctx.sampleRate);
      b.copyToChannel(mono, 0);
      const src = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      src.buffer = b; gain.gain.value = c.gain ?? 1; pan.pan.value = c.pan || 0;
      src.connect(gain).connect(pan).connect(ctx.destination);
      src.start();
    };
    scene.onFrame(t => {
      if (on && scene._player && scene._player.playing && lastT != null && t > lastT && t - lastT < 0.25) {
        for (const c of scene.cues) if (c.at > lastT && c.at <= t) play(c);
      }
      lastT = t;
    });
    const toggle = () => {
      on = !on;
      if (on && !ctx) ctx = new AudioContext();
      if (ctx && on) ctx.resume();
      if (btn) btn.textContent = on ? '🔊' : '🔇';
    };
    let btn = null;
    const bar = document.querySelector('.m-bar');
    if (bar && scene.cues.length) {
      btn = document.createElement('button');
      btn.title = 'Sound (M)';
      btn.textContent = '🔇';
      btn.onclick = toggle;
      bar.appendChild(btn);
    }
    window.addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M') toggle(); });
  }

  g.MotionSFX = { synth, mix, toWav, attachPreview, names: Object.keys(DEFS) };
})(typeof window !== 'undefined' ? window : globalThis);
