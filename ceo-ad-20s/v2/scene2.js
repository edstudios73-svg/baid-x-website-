// BAID X · CEO ad v2 — one timeline for board.html (review), bg.html (studio, opaque) and fg.html (desk gear + graphics, alpha).
// The keyed CEO plate sits between bg and fg in the final ffmpeg composite, with the same #view camera move.
const feed = document.getElementById('feed');
feed.innerHTML = Array.from({ length: 16 }, (_, i) => `<div class="res"><div class="av"></div><div><div class="t" style="width:${240 + (i * 37) % 120}px"></div><div class="s" style="width:${330 + (i * 53) % 140}px"></div></div><div class="rb"></div></div>`).join('');

const m = Motion.scene({ width: 1080, height: 1920, fps: 30, duration: 20 });
const LAYER = document.body.className;
const CAM = LAYER === 'all';   // in the final the camera move is applied in ffmpeg to studio + CEO + desk together (tools/view.py)
const OPEN = 0, PUSH = 2.0, SEARCH = 3.0, DIVE = 5.0, SLOW = 8.6, STILL = 9.5, SEAM = 10.3, HIT = 11.0, UI = 14.0, CEO = 17.0, END = 18.0;

if (LAYER === 'all') [['#pA', 0, 2.0], ['#pB', 2.0, 3.6], ['#pC', 3.6, 17], ['#pD', 17, 20]].forEach(([s, a, b]) => m.show(s, a, b));
m.set(['#touch', '#n1', '#n2', '#n3', '#n4', '#s1', '#pfs', '#full', '#hero', '#ui', '#end', '#still', '#seam', '#htag', '#hline'], { opacity: 0 });

// ── camera: slow push, then into the desk, back out for the search ──
if (CAM) {
m.fromTo('#view', { scale: 1 }, { scale: 1.04 }, { at: 0, dur: PUSH, ease: 'linear' });
m.to('#view', { scale: 1.2, y: -230 }, { at: PUSH, dur: 0.9, ease: 'swoop' });
m.to('#view', { scale: 1.02, y: 0 }, { at: SEARCH, dur: 0.5, ease: 'swoop' });
m.to('#view', { scale: 1.06 }, { at: SEARCH + 0.5, dur: 1.5, ease: 'linear' });
m.to('#view', { scale: 1.06 }, { at: CEO, dur: 0.01 });
m.fromTo('#view', { scale: 1.06 }, { scale: 1.1 }, { at: CEO, dur: 1, ease: 'linear' });
}
m.sfx('whoosh', PUSH, { gain: 0.3 }); m.sfx('whoosh', SEARCH, { gain: 0.35, rate: 1.2 });

// ── 0–3 · opening type ──
m.text('#h1', { at: 0.3, style: 'mask', stagger: 0.09 });
m.set('#s1', { opacity: 1 }, 1.25);
m.text('#s1', { at: 1.25, style: 'rise', stagger: 0.06 });
m.exit(['#h1', '#s1'], { at: PUSH + 0.75, style: 'blur', dur: 0.2 });

// ── 3–5 · searching the platforms ──
m.set('#pfs', { opacity: 1 }, SEARCH + 0.1);
m.from('#pfs .pf', { opacity: 0, scale: 0.86, blur: 14, y: 30 }, { at: SEARCH + 0.15, dur: 0.45, ease: 'out', stagger: 0.12 });
['#pf0', '#pf1', '#pf2', '#pf3'].forEach((s, i) => m.float(s, { amp: 6, period: 2.6 + i * 0.3, from: SEARCH + 0.6, to: DIVE }));
for (let i = 0; i < 4; i++) m.sfx('pop', SEARCH + 0.15 + i * 0.12, { gain: 0.18, rate: 1 + i * 0.05 });
for (let i = 0; i < 10; i++) m.sfx('type', SEARCH + 0.7 + i * 0.07, { gain: 0.12 });

// ── 5–9 · dive into the interface, fast scrolling across platforms ──
m.set('#full', { opacity: 1 }, DIVE);
m.fromTo('#full', { clip: 'inset(200px 40px 1520px 620px round 26px)' }, { clip: 'inset(0px 0px 0px 0px round 0px)' }, { at: DIVE, dur: 0.45, ease: 'swoop' });
m.to('#pfs', { opacity: 0 }, { at: DIVE + 0.3, dur: 0.15, ease: 'in' });
m.sfx('swoosh-up', DIVE, { gain: 0.45 });
m.fromTo('#feed', { y: 0 }, { y: -2300 }, { at: DIVE + 0.4, dur: SLOW - DIVE - 0.4, ease: 'inSoft' });
m.to('#feed', { y: -2480 }, { at: SLOW, dur: 0.9, ease: 'out' });
const tabX = [0, 0, 0, 0, 0];
m.hook(() => { ['#t0', '#t1', '#t2', '#t3', '#t4'].forEach((s, i) => { const el = document.querySelector(s); tabX[i] = el.offsetLeft; }); });
m.set('#tabSel', { w: el => document.querySelector('#t0').offsetWidth, x: 0 }, 0);
[5.75, 6.45, 7.1, 7.7].forEach((t, i) => {
  m.to('#tabSel', { x: () => document.querySelector('#t' + (i + 1)).offsetLeft, w: () => document.querySelector('#t' + (i + 1)).offsetWidth }, { at: t, dur: 0.3, ease: 'morph' });
  m.fromTo('#feedClip', { x: 0 }, { x: -60 }, { at: t, dur: 0.12, ease: 'in' });
  m.to('#feedClip', { x: 0 }, { at: t + 0.12, dur: 0.3, ease: 'out' });
  m.sfx('swish', t, { gain: 0.35, rate: 1 + i * 0.06 });
  m.to('#n' + i, { opacity: 0, y: -30, blur: 8 }, { at: t, dur: 0.15, ease: 'in' });
  m.set('#n' + (i + 1), { opacity: 1 }, t + 0.1);
  m.fromTo('#n' + (i + 1), { y: 40, blur: 10 }, { y: 0, blur: 0 }, { at: t + 0.1, dur: 0.3, ease: 'out' });
  m.set('#t' + i, { color: '#bdb9b2' }, t + 0.12); m.set('#t' + (i + 1), { color: '#111' }, t + 0.12);
});
m.set('#t0', { color: '#111' }, 0);
for (let i = 0; i < 14; i++) m.sfx('tick', DIVE + 0.5 + i * (0.26 - i * 0.008), { gain: 0.16, rate: 1 + (i % 4) * 0.05 });

// finger swipes on the feed (a micro-interaction per flick)
[5.55, 6.2, 6.85, 7.45, 8.0].forEach((t, i) => {
  m.set('#touch', { opacity: 1 }, t);
  m.fromTo('#touch', { y: 0, scale: 0.7 }, { y: -520, scale: 1 }, { at: t, dur: 0.32, ease: 'out' });
  m.to('#touch', { opacity: 0, scale: 0.6 }, { at: t + 0.3, dur: 0.12, ease: 'in' });
});

// ── 9–11 · frustration: everything slows and empties ──
m.to('#feed .res', { opacity: 0, y: 30, blur: 6 }, { at: SLOW + 0.5, dur: 0.4, ease: 'in', stagger: { each: 0.02, from: 'random' } });
m.to('#fullHead', { opacity: 0.35 }, { at: SLOW + 0.6, dur: 0.5, ease: 'apple' });
m.set('#still', { opacity: 1 }, STILL);
m.text('#still', { at: STILL, style: 'mask', stagger: 0.12 });
m.exit('#still', { at: HIT - 0.3, style: 'blur', dur: 0.2 });
m.set('#seam', { opacity: 1 }, SEAM);
m.fromTo('#seam', { scaleY: 0, opacity: 0.4 }, { scaleY: 1, opacity: 1 }, { at: SEAM, dur: 0.6, ease: 'in' });
m.sfx('rise', SEAM - 0.4, { gain: 0.5, dur: 1.3 });

// ── 11–14 · BAID X hero ──
m.set('#hero', { opacity: 1 }, HIT - 0.02);
m.fromTo('#hero', { clip: 'inset(0px 537px 0px 537px)' }, { clip: 'inset(0px 0px 0px 0px)' }, { at: HIT - 0.02, dur: 0.28, ease: 'snap' });
m.fromTo('#hlogo', { x: -520, scaleX: 1.35, blur: 26, opacity: 0 }, { x: 0, scaleX: 1, blur: 0, opacity: 1 }, { at: HIT, dur: 0.32, ease: 'snap' });
m.fromTo('#hlogo', { scale: 1.08 }, { scale: 1 }, { at: HIT + 0.3, dur: 0.6, ease: 'out' });
m.sfx('thud', HIT, { gain: 1 });
m.fromTo('#sweep', { x: -800 }, { x: 1180 }, { at: HIT + 0.5, dur: 1.1, ease: 'inOut' });
m.set('#hline', { opacity: 1 }, HIT + 0.55);
m.fromTo('#hline', { scaleX: 0 }, { scaleX: 1 }, { at: HIT + 0.55, dur: 0.5, ease: 'out' });
m.set('#htag', { opacity: 1 }, HIT + 0.85);
m.text('#htag', { at: HIT + 0.85, style: 'mask', stagger: 0.1 });
m.fromTo('#hero', { scale: 1 }, { scale: 1.03 }, { at: HIT, dur: UI - HIT, ease: 'linear' });

// ── 14–17 · the BAID X interface comes down from the top ──
m.set('#ui', { opacity: 1 }, UI);
m.fromTo('#ui', { y: -1920 }, { y: 0 }, { at: UI, dur: 0.55, ease: 'swoop' });
m.sfx('whoosh', UI, { gain: 0.5 });
m.from(['#uiTitle', '#uiPhone', '#f0', '#f1', '#f2', '#f3', '#f4'], { opacity: 0, y: -40, blur: 8 }, { at: UI + 0.3, dur: 0.45, ease: 'out', stagger: 0.08 });
m.set('#uiCap', { opacity: 0 }, 0); m.to('#uiCap', { opacity: 1 }, { at: UI + 1.0, dur: 0.4, ease: 'apple' });
for (let i = 0; i < 5; i++) m.sfx('tap', UI + 0.45 + i * 0.08, { gain: 0.15 });
m.set(['#hero', '#full'], { opacity: 0 }, UI + 0.6);
m.to('#ui', { y: -1920 }, { at: CEO - 0.15, dur: 0.4, ease: 'in' });

// ── 17–18 · back to the CEO (confident) ──
m.sfx('swish', CEO - 0.1, { gain: 0.35 });

// ── 18–20 · end card ──
m.set('#end', { opacity: 1 }, END);
m.fromTo('#end', { clip: 'circle(0% at 50% 50%)' }, { clip: 'circle(75% at 50% 50%)' }, { at: END, dur: 0.45, ease: 'swoop' });
m.fromTo('#elogo', { scale: 1.25, blur: 16, opacity: 0 }, { scale: 1, blur: 0, opacity: 1 }, { at: END + 0.1, dur: 0.45, ease: 'snap' });
m.sfx('thud', END + 0.12, { gain: 0.8 });
m.text('#esub', { at: END + 0.55, style: 'mask', stagger: 0.07 });
m.fromTo('#eurl', { opacity: 0, letterSpacing: '0.32em' }, { opacity: 1, letterSpacing: '0.2em' }, { at: END + 0.9, dur: 0.6, ease: 'out' });
m.from('#ebtn', { w: 116, scale: 0.6, opacity: 0 }, { at: END + 1.1, dur: 0.32, inertia: true });
m.from('#ebtn span', { opacity: 0, blur: 8, y: 12 }, { at: END + 1.25, dur: 0.4, ease: 'out' });
m.sfx('pop', END + 1.1, { gain: 0.5 });
