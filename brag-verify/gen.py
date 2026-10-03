#!/usr/bin/env python3
"""BAID X: 60-second glassmorphism explainer, get verified. Phone mockups use real screenshots of auth.html."""
TOTAL = 60
CSS = '''
@font-face { font-family: Inter; font-weight: 400; src: url(assets/fonts/inter-latin-400-normal.woff2) format("woff2"); }
@font-face { font-family: Inter; font-weight: 600; src: url(assets/fonts/inter-latin-600-normal.woff2) format("woff2"); }
@font-face { font-family: Inter; font-weight: 800; src: url(assets/fonts/inter-latin-800-normal.woff2) format("woff2"); }
:root { --bg:#050505; --text:#f6f6f7; --muted:#c4c4c4; --gold:#e8c46a; --cream:#e8d9a8; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width:1920px; height:1080px; background:var(--bg); overflow:hidden; font-family:Inter,system-ui,sans-serif; color:var(--text); }
#root { position:relative; width:1920px; height:1080px; background:radial-gradient(1200px 700px at 50% 40%, #14110a, #050505 70%); overflow:hidden; }
.orb { position:absolute; border-radius:50%; filter:blur(10px); }
#o1 { width:1100px; height:1100px; left:-300px; top:-420px; background:radial-gradient(circle, rgba(232,196,106,.55), transparent 62%); }
#o2 { width:900px; height:900px; left:1150px; top:380px; background:radial-gradient(circle, rgba(184,134,11,.5), transparent 62%); }
#o3 { width:700px; height:700px; left:760px; top:-300px; background:radial-gradient(circle, rgba(232,217,168,.22), transparent 62%); }
.grid { position:absolute; inset:0; background-image:linear-gradient(rgba(232,217,168,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(232,217,168,.045) 1px, transparent 1px); background-size:80px 80px; -webkit-mask-image:radial-gradient(circle at 50% 50%, #000 20%, transparent 75%); mask-image:radial-gradient(circle at 50% 50%, #000 20%, transparent 75%); }
.frame { position:absolute; inset:26px; border:1px solid rgba(232,217,168,.22); border-radius:6px; pointer-events:none; }
.frame::before, .frame::after { content:""; position:absolute; width:46px; height:46px; border:2px solid rgba(232,217,168,.6); }
.frame::before { left:-1px; top:-1px; border-right:0; border-bottom:0; } .frame::after { right:-1px; bottom:-1px; border-left:0; border-top:0; }
.mark { position:absolute; left:64px; top:52px; font-weight:800; font-size:21px; letter-spacing:.32em; color:rgba(232,217,168,.8); }
#progw { position:absolute; left:26px; right:26px; bottom:26px; height:3px; background:rgba(255,255,255,.07); } #prog { height:100%; background:linear-gradient(90deg,#b8860b,#e8c46a,#fff); transform-origin:left; }
.glass { background:linear-gradient(135deg, rgba(255,255,255,.13), rgba(255,255,255,.04)); border:1px solid rgba(255,255,255,.2); backdrop-filter:blur(28px) saturate(1.5); -webkit-backdrop-filter:blur(28px) saturate(1.5); box-shadow:inset 0 1px 0 rgba(255,255,255,.3), inset 0 -1px 0 rgba(255,255,255,.05), 0 40px 90px -30px rgba(0,0,0,.85); border-radius:40px; }
.clip { position:absolute; inset:0; }
.eb { font-weight:800; font-size:26px; letter-spacing:.3em; text-transform:uppercase; color:var(--gold); }
h1 { font-weight:800; font-size:92px; line-height:1.02; letter-spacing:-.035em; }
h2 { font-weight:800; font-size:72px; line-height:1.04; letter-spacing:-.03em; margin-top:18px; }
.gold { background:linear-gradient(90deg,#f1d58a,#c99a2e); -webkit-background-clip:text; background-clip:text; color:transparent; }
p.t { font-size:36px; line-height:1.38; color:var(--muted); margin-top:22px; }
.center { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
.logo { width:230px; height:auto; }
.ring { position:absolute; width:520px; height:520px; border-radius:50%; border:1px solid rgba(232,196,106,.5); left:700px; top:140px; }
.ring.b { width:640px; height:640px; left:640px; top:80px; border-color:rgba(232,196,106,.22); }
.pillg { display:inline-block; padding:18px 38px; border-radius:99px; font-weight:800; font-size:30px; letter-spacing:.04em; margin-top:34px; }
.two { display:flex; gap:44px; margin-top:56px; }
.big { width:640px; padding:48px 44px; text-align:left; }
.big i { display:grid; place-items:center; width:84px; height:84px; border-radius:24px; border:1px solid rgba(232,196,106,.6); background:rgba(232,196,106,.14); color:var(--gold); margin-bottom:26px; }
.big b { display:block; font-size:50px; letter-spacing:-.02em; } .big small { display:block; font-size:30px; color:var(--muted); margin-top:12px; line-height:1.35; }
.two.three .big { width:540px; padding:40px 36px; } .two.three { gap:30px; }
.panel { position:absolute; width:800px; top:250px; padding:54px 56px 48px; }
.num { font-weight:800; font-size:30px; display:flex; align-items:center; gap:16px; } .num span { display:grid; place-items:center; width:62px; height:62px; border-radius:50%; background:linear-gradient(135deg,#f1d58a,#c99a2e); color:#14110a; font-size:32px; }
.stp { display:flex; gap:10px; margin-top:40px; flex-wrap:wrap; } .stp em { font-style:normal; font-weight:600; font-size:22px; padding:10px 18px; border-radius:99px; border:1px solid rgba(255,255,255,.2); color:#bdbdbd; background:rgba(255,255,255,.05); } .stp em.on { background:linear-gradient(135deg,#f1d58a,#c99a2e); color:#14110a; border-color:transparent; font-weight:800; } .stp em.dn { color:var(--gold); border-color:rgba(232,196,106,.45); }
/* phone */
#ph { position:absolute; left:1262px; top:104px; width:408px; height:872px; padding:14px; border-radius:68px; background:linear-gradient(145deg, rgba(255,255,255,.22), rgba(255,255,255,.05)); border:1.5px solid rgba(232,217,168,.55); box-shadow:0 50px 110px -30px #000, 0 0 90px rgba(232,196,106,.22), inset 0 1px 0 rgba(255,255,255,.4); opacity:0; }
#scr { position:relative; width:380px; height:844px; border-radius:54px; overflow:hidden; background:#000; }
#scr img.s { position:absolute; inset:0; width:380px; height:822px; object-fit:cover; opacity:0; }
.notch { position:absolute; left:50%; top:10px; margin-left:-52px; width:104px; height:28px; border-radius:20px; background:#000; z-index:5; }
.tap { position:absolute; width:70px; height:70px; margin:-35px 0 0 -35px; border-radius:50%; background:radial-gradient(circle, rgba(232,196,106,.85), rgba(232,196,106,.25) 55%, transparent 70%); border:2px solid rgba(255,255,255,.7); opacity:0; z-index:6; }
.okc { width:150px; height:150px; border-radius:50%; display:grid; place-items:center; background:linear-gradient(135deg,#f1d58a,#c99a2e); color:#14110a; box-shadow:0 0 90px rgba(232,196,106,.55); margin-bottom:34px; }
'''
IC = {
 'user': '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/>',
 'key': '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
}
def ic(k, s=44): return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{IC[k]}</svg>'


STEPS = ['Profile', 'Email', 'Documents', 'Review', 'Badge']
scenes = []; js = []
def clip(sid, t0, dur, html): scenes.append(f'<div id="{sid}" class="clip" data-start="{t0}" data-duration="{dur}">{html}</div>')
def rise(sel, t, d=0.8, y=44): js.append(f'tl.fromTo("{sel}",{{opacity:0,y:{y}}},{{opacity:1,y:0,duration:{d},ease:"power3.out"}},{t});')
def pop(sel, t, d=0.8, s=0.9): js.append(f'tl.fromTo("{sel}",{{opacity:0,scale:{s}}},{{opacity:1,scale:1,duration:{d},ease:"back.out(1.4)"}},{t});')

IC['id'] = '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.6-1.6 1.6-2.2 2.5-2.2s1.9.6 2.5 2.2M14 10h4M14 13.5h3"/>'
IC['shield'] = '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>'
IC['list'] = '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="m8.5 12 2.5 2.5 4.5-5M8 7h8"/>'

clip('a', 0, 5.4, '<div class="ring" id="ar1"></div><div class="ring b" id="ar2"></div><div class="center" style="position:absolute;inset:0"><img id="alogo" class="logo" src="assets/logo.png"><div id="arule" style="width:200px;height:2px;background:linear-gradient(90deg,transparent,#e8c46a,transparent);margin:34px 0 30px"></div><div id="ae" class="eb">After you sign up</div><h1 id="ah" style="margin-top:26px">Get <span class="gold">verified.</span></h1><div id="ap" class="glass pillg">Earn the badge people trust</div></div>')
js += ['tl.fromTo("#ar1",{opacity:0,scale:.7},{opacity:1,scale:1,duration:2.2,ease:"power2.out"},0.1);','tl.fromTo("#ar2",{opacity:0,scale:.7},{opacity:1,scale:1,duration:2.6,ease:"power2.out"},0.3);',
       'tl.fromTo("#alogo",{opacity:0,scale:.85,y:14},{opacity:1,scale:1,y:0,duration:1.4,ease:"power3.out"},0.5);','tl.fromTo("#arule",{opacity:0,scaleX:0},{opacity:1,scaleX:1,duration:1.0,ease:"power2.inOut"},1.5);']
rise('#ae', 2.0, .7, 20); rise('#ah', 2.4, .9); rise('#ap', 3.3, .8, 30)

def bigc(i, ico, t, s): return f'<div id="bc{i}" class="glass big"><i>{ic(ico)}</i><b>{t}</b><small>{s}</small></div>'
clip('b', 5.4, 3.8, '<div class="center" style="position:absolute;inset:0"><div id="be" class="eb">Three steps</div><div class="two three">' + bigc(1,'list','Complete your profile','Work through the checklist, one short step at a time.') + bigc(2,'id','Submit your ID','Upload your documents for a BAID X review.') + bigc(3,'shield','Wear your badge','It shows on your profile, cards and search.') + '</div></div>')
rise('#be', 5.6, .6, 20); pop('#bc1', 6.0); pop('#bc2', 6.6); pop('#bc3', 7.2)

def panel(sid, t0, dur, x, n, label, title, text, idx):
    pills = ''.join(f'<em class="{"on" if i == idx else ("dn" if i < idx else "")}">{s}</em>' for i, s in enumerate(STEPS)) if idx is not None else ''
    head = f'<div class="num"><span>{n}</span><b class="eb" style="font-size:24px">{label}</b></div>'
    clip(sid, t0, dur, f'<div id="{sid}p" class="glass panel" style="left:{x}px">{head}<h2>{title}</h2><p class="t">{text}</p><div class="stp">{pills}</div></div>')
    rise(f'#{sid}p', t0 + .15, .9, 50)
    js.append(f'tl.to("#{sid}p",{{opacity:0,y:-20,duration:.4,ease:"power2.in"}},{t0 + dur - .45});')

X = 150
panel('s1', 9.2, 5.5, X, 1, 'Verification', 'Finish your <span class="gold">setup</span>', 'A banner on Home says your profile is not public yet. Tap Continue setup.', 0)
panel('s2', 14.7, 5.5, X, 2, 'Verification', 'Work through the <span class="gold">checklist</span>', 'Every row opens its own short step. Done rows turn green.', 0)
panel('s3', 20.2, 5.8, X, 3, 'Verification', 'Add your own <span class="gold">email</span>', 'We send a link to confirm it. After that you can sign in with it as well as your phone.', 1)
panel('s4', 26.0, 6.0, X, 4, 'Verification', 'Upload your <span class="gold">documents</span>', 'Your Ghana Card number, front and back, and a clear photo of your face. Only you and BAID X reviewers can open them.', 2)
panel('s5', 32.0, 5.6, X, 5, 'Verification', 'Submit for <span class="gold">review</span>', 'Tap Submit for review. A BAID X reviewer decides, and you are notified.', 3)
panel('s6', 37.6, 5.6, X, 6, 'Verification', 'Get your <span class="gold">badge</span>', 'Approved? Your account shows as Verified, reviewed by BAID X.', 4)
panel('s7', 43.2, 6.4, X, '+', 'Go further', 'Choose a stronger <span class="gold">badge</span>', 'Services and fees has Identity (green), Professional (purple) and Advanced (gold). Pick the level you want.', None)
panel('s8', 49.6, 5.4, X, '+', 'Go further', 'It shows <span class="gold">everywhere</span>', 'On your profile, your cards and in search results, so people know who they are dealing with.', None)

clip('z', 55.0, 5.0, '<div class="center" style="position:absolute;inset:0"><img id="zlogo" class="logo" src="assets/logo.png"><div id="zrule" style="width:200px;height:2px;background:linear-gradient(90deg,transparent,#e8c46a,transparent);margin:34px 0 30px"></div><h1 id="zh" style="font-size:84px">Get verified at <span class="gold">baidx.com</span></h1><div id="zp" class="glass pillg" style="background:linear-gradient(135deg,#f1d58a,#c99a2e);color:#14110a;border:0">Trusted people get hired</div></div>')
js += ['tl.fromTo("#zlogo",{opacity:0,scale:.85},{opacity:1,scale:1,duration:1.0,ease:"power3.out"},55.3);','tl.fromTo("#zrule",{opacity:0,scaleX:0},{opacity:1,scaleX:1,duration:.9,ease:"power2.inOut"},56.0);']
rise('#zh', 56.2, .9); rise('#zp', 57.0, .8, 30)

shots = ['v01-home','v02-checklist','v03-email','v04-email-filled','v05-docs-empty','v06-docs-filled','v07-under-review','v08-verified','v09-services','v10-services2','v11-profile-badge']
imgs = ''.join(f'<img class="s" id="sc{i+1}" src="assets/shots/{n}.png">' for i, n in enumerate(shots))
taps = ''.join(f'<div class="tap" id="tp{i}"></div>' for i in range(9))
phone = f'<div id="phw" style="position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none"><div id="ph"><div id="scr"><div class="notch"></div>{imgs}{taps}</div></div></div>'
def show(i, t, d=.5): js.append(f'tl.to("#sc{i}",{{opacity:1,duration:{d},ease:"power1.inOut"}},{t});')
def hide(i, t, d=.5): js.append(f'tl.to("#sc{i}",{{opacity:0,duration:{d},ease:"power1.inOut"}},{t});')
def tap(i, t, x, y):
    js.append(f'tl.set("#tp{i}",{{left:{x},top:{y}}},{t});')
    js.append(f'tl.fromTo("#tp{i}",{{opacity:0,scale:.3}},{{opacity:1,scale:1.15,duration:.28,ease:"power2.out"}},{t});')
    js.append(f'tl.to("#tp{i}",{{opacity:0,scale:1.7,duration:.45,ease:"power1.in"}},{t+.3});')
js.append('tl.fromTo("#ph",{opacity:0,y:70,rotationY:-14,scale:.94},{opacity:1,y:0,rotationY:0,scale:1,duration:1.2,ease:"power3.out"},8.8);')
js.append('tl.to("#phw",{y:-14,duration:44,ease:"none"},10.0);')
show(1, 9.4, .01); tap(0, 12.6, 112, 364)
show(2, 14.8); hide(1, 14.9, .4); tap(1, 18.6, 185, 365)
show(3, 20.3); hide(2, 20.4, .4); tap(2, 21.6, 190, 272); show(4, 22.4); hide(3, 22.6, .4); tap(3, 24.4, 190, 345)
show(5, 26.1); hide(4, 26.3, .4); tap(4, 27.1, 190, 288); show(6, 29.8); hide(5, 30.0, .4)
tap(5, 28.4, 316, 340); tap(6, 29.2, 316, 400)
tap(7, 33.0, 188, 680); show(7, 34.8); hide(6, 35.0, .5)
show(8, 38.0); hide(7, 38.2, .5)
show(9, 43.5); hide(8, 43.7, .5); tap(8, 46.2, 322, 575)
show(10, 47.0); hide(9, 47.2, .5)
show(11, 49.8); hide(10, 50.0, .5)
js.append('tl.to("#ph",{opacity:0,scale:.94,duration:.6,ease:"power2.in"},54.4);')

# ambient & progress
amb = ['tl.fromTo("#o1",{x:0,y:0,opacity:.5},{x:120,y:60,opacity:.9,duration:60,ease:"none"},0);','tl.fromTo("#o2",{x:0,y:0,opacity:.4},{x:-160,y:-80,opacity:.9,duration:60,ease:"none"},0);','tl.fromTo("#o3",{opacity:.3,scale:.9},{opacity:.8,scale:1.3,duration:60,ease:"none"},0);',
       f'tl.fromTo("#prog",{{scaleX:0}},{{scaleX:1,duration:{TOTAL},ease:"none"}},0);']

html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=1920, height=1080" /><style>{CSS}</style></head>
<body>
<div id="root" data-composition-id="root" data-width="1920" data-height="1080" data-start="0" data-duration="{TOTAL}">
  <div class="orb" id="o1"></div><div class="orb" id="o2"></div><div class="orb" id="o3"></div><div class="grid"></div>
  <div class="frame"></div><div class="mark">BAID X</div><div id="progw"><div id="prog"></div></div>
  {''.join(scenes)}
  {phone}
  <audio id="bed" data-start="0" data-duration="{TOTAL}" data-track-index="1" data-volume="0.5" data-fade-in="1.2" data-fade-out="3" src="assets/music/bed.mp3"></audio>
</div>
<script src="vendor/gsap.min.js"></script>
<script>
  const tl = gsap.timeline({{ paused: true }});
  gsap.set("#ph", {{ transformPerspective: 1400 }});
  {chr(10).join("  " + j for j in amb + js)}
  window.__timelines = window.__timelines || {{}};
  window.__timelines["root"] = tl;
</script></body></html>'''
open('composition/index.html', 'w').write(html)
print('ok')
