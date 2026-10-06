// BAID X · CEO ad (20 s, 1080×1920). One timeline drives three files made from template.html:
// board.html (everything + still cut-outs, for review), bg.html (the studio, opaque) and fg.html (graphics, rendered with alpha).
// The keyed CEO video sits between bg and fg in the ffmpeg composite.

// ── the "every other app" feed: generic cards, no third-party names or logos ──
const APPS = [
  ['Job board', 'search', 'Unverified'], ['Social network', 'person', "Who's real?"], ['Classifieds', 'cart', 'No reviews'],
  ['Freelance app', 'globe', 'No ID check'], ['Group chat', 'message', 'Unverified'], ['Recruiter page', 'bell', 'No reviews'],
  ['Job board', 'search', "Who's real?"], ['Social network', 'person', 'No ID check'], ['Classifieds', 'cart', 'Unverified'],
  ['Freelance app', 'globe', 'No reviews'], ['Group chat', 'message', "Who's real?"], ['Recruiter page', 'bell', 'Unverified'],
];
const card = (a, x, y, id) => `<div class="app" id="${id}" style="left:${x}px;top:${y}px"><div class="ic"><i class="icon" data-icon="${a[1]}"></i></div><div class="tx"><div class="t">${a[0]}</div><div class="m"></div></div><div class="tag">${a[2]}</div></div>`;
document.getElementById('feedR').innerHTML = APPS.map((a, i) => card(a, 830, 520 + i * 158, 'r' + i)).join('');
document.getElementById('feedL').innerHTML = APPS.slice(3, 10).map((a, i) => card(a, 250, 470 + i * 158 - 900, 'l' + i)).join('');

const m = Motion.scene({ width: 1080, height: 1920, fps: 30, duration: 20 });
const LAYER = document.body.className;

// ── beats (seconds) ──
const HOOK = 0.15, NOONE = 2.8, TRUST = 5.1, STRAND = 7.5, THEN = 9.0, LAND = 9.35, CLICK = 10.55, DOWN = 10.95, APP = 11.55, END = 16.0;

// still cut-outs for the board (one per beat)
if (LAYER === 'all') [['#p1', 0, 4], ['#p2', 4, 7.9], ['#p3', 7.9, 8.9], ['#p4', 8.9, 10.2], ['#p5', 10.2, 20]].forEach(([s, a, b]) => m.show(s, a, b));

m.set(['#s1', '#h2', '#h3', '#h4', '#h5', '#streak', '#bx', '#ripple', '#rv', '#c1', '#d1', '#c2', '#d2', '#c3', '#d3', '#logo', '#gwn', '#cta', '#inst', '#by', '#sc2', '#sc3', '#tvB'], { opacity: 0 });

// ── studio: slow push, TV turns to BAID X when it arrives ──
m.fromTo('#bgcam', { scale: 1.0 }, { scale: 1.04 }, { at: 0, dur: DOWN, ease: 'linear' });
m.to('#tvA', { opacity: 0, blur: 10 }, { at: LAND, dur: 0.3, ease: 'in' });
m.set('#tvB', { opacity: 1 }, LAND + 0.1);
m.fromTo('#tvB', { opacity: 0, scale: 1.1, blur: 12 }, { opacity: 1, scale: 1, blur: 0 }, { at: LAND + 0.1, dur: 0.5, ease: 'out' });

// ── 1 · HOOK + SCROLL: the feed scrolls, faster and faster ──
m.text('#h1', { at: HOOK, style: 'mask', stagger: 0.09 });
m.set('#s1', { opacity: 1 }, HOOK + 0.6);
m.text('#s1', { at: HOOK + 0.6, style: 'rise', stagger: 0.05 });
m.from('#feedR .app', { opacity: 0, x: 80, blur: 10 }, { at: 0.6, dur: 0.5, ease: 'out', stagger: 0.08 });
m.from('#feedL .app', { opacity: 0, x: -80, blur: 10 }, { at: 1.4, dur: 0.5, ease: 'out', stagger: 0.08 });
m.fromTo('#feedR', { y: 0 }, { y: -1350 }, { at: 0.6, dur: STRAND - 0.6, ease: 'inSoft' });
m.fromTo('#feedL', { y: 0 }, { y: 1300 }, { at: 1.4, dur: STRAND - 1.4, ease: 'inSoft' });
for (let i = 0; i < 9; i++) m.sfx('tick', 0.8 + i * (0.75 - i * 0.05), { gain: 0.18, rate: 0.9 + i * 0.04 });
m.exit(['#h1', '#s1'], { at: NOONE - 0.2, style: 'blur', dur: 0.2 });
m.set('#h2', { opacity: 1 }, NOONE); m.text('#h2', { at: NOONE, style: 'mask', stagger: 0.09 });
m.exit('#h2', { at: TRUST - 0.2, style: 'blur', dur: 0.2 });
m.set('#h3', { opacity: 1 }, TRUST); m.text('#h3', { at: TRUST, style: 'mask', stagger: 0.09 });
m.exit('#h3', { at: STRAND - 0.2, style: 'blur', dur: 0.2 });
m.sfx('swish', NOONE, { gain: 0.3 }); m.sfx('swish', TRUST, { gain: 0.3, rate: 1.1 });

// ── 2 · STRANDED: the feed dies and falls away ──
m.to(['#feedR', '#feedL'], { grayscale: 1, brightness: 0.55, blur: 3 }, { at: STRAND, dur: 0.35, ease: 'apple' });
m.to('#feedR .app', { y: 520, rotate: (el, i) => (i % 2 ? 9 : -7), opacity: 0 }, { at: STRAND + 0.45, dur: 0.6, ease: 'in', stagger: { each: 0.03, from: 'random' } });
m.to('#feedL .app', { y: 520, rotate: (el, i) => (i % 2 ? -8 : 6), opacity: 0 }, { at: STRAND + 0.5, dur: 0.6, ease: 'in', stagger: { each: 0.03, from: 'random' } });
m.set('#h4', { opacity: 1 }, STRAND); m.text('#h4', { at: STRAND, by: 'char', style: 'blur', stagger: 0.04 });
m.sfx('thud', STRAND, { gain: 0.5 });
m.exit('#h4', { at: THEN - 0.18, style: 'blur', dur: 0.18 });

// ── 3 · THEN BAID X: a streak, the card drops in, he taps it ──
m.set('#h5', { opacity: 1 }, THEN); m.text('#h5', { at: THEN, style: 'mask', stagger: 0.1 });
m.set('#streak', { opacity: 1 }, THEN + 0.05);
m.fromTo('#streak', { scaleY: 0, y: -400 }, { scaleY: 1, y: -60 }, { at: THEN + 0.05, dur: 0.3, ease: 'in' });
m.to('#streak', { opacity: 0 }, { at: LAND, dur: 0.2, ease: 'out' });
m.sfx('whoosh', THEN, { gain: 0.5 });
m.set('#bx', { opacity: 1 }, LAND - 0.12);
m.fromTo('#bx', { y: -520, scale: 1.25, rotateX: 40, blur: 14 }, { y: 0, scale: 1, rotateX: 0, blur: 0 }, { at: LAND - 0.12, dur: 0.42, ease: 'snap' });
m.sfx('thud', LAND + 0.25, { gain: 0.8 });
m.float('#bx', { amp: 6, period: 2.4, from: LAND + 0.5, to: CLICK });
m.set('#ripple', { opacity: 1 }, CLICK);
m.fromTo('#ripple', { scale: 0.3, opacity: 1 }, { scale: 3.2, opacity: 0 }, { at: CLICK, dur: 0.6, ease: 'out' });
m.press('#bx', { at: CLICK });
m.sfx('tap', CLICK, { gain: 0.6 });
m.exit('#h5', { at: DOWN - 0.1, style: 'blur', dur: 0.2 });

// ── 4 · BRING IT DOWN + REVEAL: the card slides down and opens into BAID X ──
m.to('#bx', { y: 260 }, { at: DOWN, dur: 0.35, ease: 'inOut' });
m.set('#rv', { opacity: 1 }, DOWN + 0.3);
m.fromTo('#rv', { clip: 'inset(1055px 620px 695px 40px round 30px)' }, { clip: 'inset(0px 0px 0px 0px round 0px)' }, { at: DOWN + 0.3, dur: 0.55, ease: 'swoop' });
m.to('#bx', { opacity: 0 }, { at: DOWN + 0.35, dur: 0.2, ease: 'in' });
m.sfx('swoosh-up', DOWN + 0.25, { gain: 0.5 });
m.fromTo('#phone', { y: 420, scale: 0.86, rotateX: 18, blur: 10 }, { y: 0, scale: 1, rotateX: 0, blur: 0 }, { at: APP - 0.15, dur: 0.7, ease: 'out' });
m.fromTo('#rvcam', { scale: 1 }, { scale: 1.04 }, { at: APP, dur: END - APP, ease: 'linear' });
[[1, APP + 0.35], [2, 13.3], [3, 14.7]].forEach(([k, t], i) => {
  if (k > 1) { m.swap('#sc' + (k - 1), '#sc' + k, { at: t - 0.15, dur: 0.45 }); m.exit(['#c' + (k - 1), '#d' + (k - 1)], { at: t - 0.22, style: 'blur', dur: 0.18 }); }
  m.set(['#c' + k, '#d' + k], { opacity: 1 }, t);
  m.text('#c' + k, { at: t, style: 'mask', stagger: 0.08 });
  m.text('#d' + k, { at: t + 0.3, style: 'rise', stagger: 0.04 });
  m.sfx('swish', t, { gain: 0.3, rate: 1 + i * 0.05 });
});

// ── 5 · END CARD ──
m.exit(['#c3', '#d3'], { at: END - 0.2, style: 'blur', dur: 0.18 });
m.to('#phone', { y: 300, scale: 0.8, opacity: 0, blur: 12 }, { at: END - 0.15, dur: 0.35, ease: 'in' });
m.set('#logo', { opacity: 1 }, END + 0.1);
m.fromTo('#logo', { scale: 1.6, blur: 26, opacity: 0 }, { scale: 1, blur: 0, opacity: 1 }, { at: END + 0.1, dur: 0.45, ease: 'snap' });
m.sfx('thud', END + 0.12, { gain: 0.9 });
m.set('#gwn', { opacity: 1 }, END + 0.55); m.text('#gwn', { at: END + 0.55, by: 'char', style: 'blur', stagger: 0.02 });
m.set('#cta', { opacity: 1 }, END + 0.9);
m.from('#cta', { w: 128, scale: 0.6 }, { at: END + 0.9, dur: 0.32, inertia: true });
m.from('#cta span', { opacity: 0, blur: 10, y: 14 }, { at: END + 1.05, dur: 0.45, ease: 'out' });
m.sfx('pop', END + 0.9, { gain: 0.5 });
m.set('#inst', { opacity: 1 }, END + 1.35); m.text('#inst', { at: END + 1.35, style: 'rise', stagger: 0.04 });
m.set('#by', { opacity: 1 }, END + 1.8); m.text('#by', { at: END + 1.8, style: 'rise', stagger: 0.03 });
