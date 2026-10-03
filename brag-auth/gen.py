#!/usr/bin/env python3
"""BAID X: 60-second glassmorphism explainer, sign up and sign in. Phone mockups use real screenshots of auth.html."""
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

STEPS = ['Type', 'Phone', 'Code', 'Name', 'Work', 'Password']
scenes = []; js = []
def clip(sid, t0, dur, html): scenes.append(f'<div id="{sid}" class="clip" data-start="{t0}" data-duration="{dur}">{html}</div>')
def rise(sel, t, d=0.8, y=44): js.append(f'tl.fromTo("{sel}",{{opacity:0,y:{y}}},{{opacity:1,y:0,duration:{d},ease:"power3.out"}},{t});')
def pop(sel, t, d=0.8, s=0.9): js.append(f'tl.fromTo("{sel}",{{opacity:0,scale:{s}}},{{opacity:1,scale:1,duration:{d},ease:"back.out(1.4)"}},{t});')

# 1 splash (small classic logo)
clip('a', 0, 5.4, '<div class="ring" id="ar1"></div><div class="ring b" id="ar2"></div><div class="center" style="position:absolute;inset:0"><img id="alogo" class="logo" src="assets/logo.png"><div id="arule" style="width:200px;height:2px;background:linear-gradient(90deg,transparent,#e8c46a,transparent);margin:34px 0 30px"></div><div id="ae" class="eb">Ghana\'s work network</div><h1 id="ah" style="margin-top:26px">Sign up. <span class="gold">Sign in.</span></h1><div id="ap" class="glass pillg">It takes about a minute</div></div>')
js += ['tl.fromTo("#ar1",{opacity:0,scale:.7},{opacity:1,scale:1,duration:2.2,ease:"power2.out"},0.1);','tl.fromTo("#ar2",{opacity:0,scale:.7},{opacity:1,scale:1,duration:2.6,ease:"power2.out"},0.3);',
       'tl.fromTo("#alogo",{opacity:0,scale:.85,y:14},{opacity:1,scale:1,y:0,duration:1.4,ease:"power3.out"},0.5);','tl.fromTo("#arule",{opacity:0,scaleX:0},{opacity:1,scaleX:1,duration:1.0,ease:"power2.inOut"},1.5);']
rise('#ae', 2.0, .7, 20); rise('#ah', 2.4, .9); rise('#ap', 3.3, .8, 30)

# 2 overview
clip('b', 5.4, 3.8, f'<div class="center" style="position:absolute;inset:0"><div id="be" class="eb">Two ways in</div><div class="two"><div id="bc1" class="glass big"><i>{ic("user")}</i><b>New here?</b><small>Create an account with your phone number.</small></div><div id="bc2" class="glass big"><i>{ic("key")}</i><b>Been here before?</b><small>Sign in with your phone or your email.</small></div></div></div>')
rise('#be', 5.7, .6, 20); pop('#bc1', 6.2); pop('#bc2', 6.9)

def panel(sid, t0, dur, x, n, total_label, title, text, idx, extra=''):
    pills = ''.join(f'<em class="{"on" if i == idx else ("dn" if i < idx else "")}">{s}</em>' for i, s in enumerate(STEPS)) if idx is not None else ''
    head = f'<div class="num"><span>{n}</span><b class="eb" style="font-size:24px">{total_label}</b></div>'
    clip(sid, t0, dur, f'<div id="{sid}p" class="glass panel" style="left:{x}px">{head}<h2>{title}</h2><p class="t">{text}</p><div class="stp">{pills}</div>{extra}</div>')
    rise(f'#{sid}p', t0 + .15, .9, 50)
    js.append(f'tl.to("#{sid}p",{{opacity:0,y:-20,duration:.4,ease:"power2.in"}},{t0 + dur - .45});')

X = 150
panel('s1', 9.2, 5.0, X, 1, 'Sign up', 'Choose your <span class="gold">account type</span>', 'Professional, Company, Project Manager, Supplier or Client. Pick the one that fits how you use BAID X.', 0)
panel('s2', 14.2, 5.0, X, 2, 'Sign up', 'Enter your <span class="gold">phone number</span>', 'Ghana +233 is preset. BAID X sends a verification code to this number.', 1)
panel('s3', 19.2, 5.0, X, 3, 'Sign up', 'Confirm the <span class="gold">code</span>', 'Type the 6-digit code from the SMS. It proves the number is really yours.', 2)
panel('s4', 24.2, 5.0, X, 4, 'Sign up', 'Tell us your <span class="gold">name</span>', 'This is how clients, companies and teams will see you on BAID X.', 3)
panel('s5', 29.2, 5.0, X, 5, 'Sign up', 'Choose what <span class="gold">you do</span>', 'Search and pick your trade or category, so the right people can find you.', 4)
panel('s6', 34.2, 5.8, X, 6, 'Sign up', 'Create a <span class="gold">password</span>', 'At least 8 characters with a letter and a number. Then tap Create account.', 5)

# success
clip('ok', 40.0, 3.6, '<div class="center" style="position:absolute;left:0;right:0;top:0;bottom:0"><div id="okc" class="okc"><svg width="84" height="84" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div><h1 id="okh" style="font-size:100px">You\'re <span class="gold">in.</span></h1><p id="okp" class="t" style="max-width:1100px">Add your email any time from your profile, then get verified to earn a trust badge.</p></div>')
pop('#okc', 40.3, .8, .6); rise('#okh', 40.6, .8); rise('#okp', 41.1, .8, 30)

SX = 800
panel('i1', 43.6, 6.0, SX, 'A', 'Sign in', 'Sign in with your <span class="gold">phone</span>', 'Enter your number and password, then tap Sign in.', None)
panel('i2', 49.6, 5.4, SX, 'B', 'Sign in', 'Or use your <span class="gold">email</span>', 'Switch the tab to Email. Forgot your password? Tap Forgot password to reset it.', None)

# outro
clip('z', 55.0, 5.0, '<div class="center" style="position:absolute;inset:0"><img id="zlogo" class="logo" src="assets/logo.png"><div id="zrule" style="width:200px;height:2px;background:linear-gradient(90deg,transparent,#e8c46a,transparent);margin:34px 0 30px"></div><h1 id="zh" style="font-size:84px">Join free at <span class="gold">baidx.com</span></h1><div id="zp" class="glass pillg" style="background:linear-gradient(135deg,#f1d58a,#c99a2e);color:#14110a;border:0">Sign up with your phone</div></div>')
js += ['tl.fromTo("#zlogo",{opacity:0,scale:.85},{opacity:1,scale:1,duration:1.0,ease:"power3.out"},55.3);','tl.fromTo("#zrule",{opacity:0,scaleX:0},{opacity:1,scaleX:1,duration:.9,ease:"power2.inOut"},56.0);']
rise('#zh', 56.2, .9); rise('#zp', 57.0, .8, 30)

# phone: persistent, screenshots crossfade
shots = ['01-type','02-phone-empty','03-phone-filled','04-code','05-name','06-cat','07-pass','08-signin-empty','09-signin-filled','10-signin-email']
imgs = ''.join(f'<img class="s" id="sc{i+1}" src="assets/shots/{n}.png">' for i, n in enumerate(shots))
taps = ''.join(f'<div class="tap" id="tp{i}"></div>' for i in range(9))
phone = f'<div id="phw" style="position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none"><div id="ph"><div id="scr"><div class="notch"></div>{imgs}{taps}</div></div></div>'
def show(i, t, d=.5):
    js.append(f'tl.to("#sc{i}",{{opacity:1,duration:{d},ease:"power1.inOut"}},{t});')
def hide(i, t, d=.5):
    js.append(f'tl.to("#sc{i}",{{opacity:0,duration:{d},ease:"power1.inOut"}},{t});')
def tap(i, t, x, y):
    js.append(f'tl.set("#tp{i}",{{left:{x},top:{y}}},{t});')
    js.append(f'tl.fromTo("#tp{i}",{{opacity:0,scale:.3}},{{opacity:1,scale:1.15,duration:.28,ease:"power2.out"}},{t});')
    js.append(f'tl.to("#tp{i}",{{opacity:0,scale:1.7,duration:.45,ease:"power1.in"}},{t+.3});')
# entrance
js.append('tl.fromTo("#ph",{opacity:0,y:70,rotationY:-14,scale:.94},{opacity:1,y:0,rotationY:0,scale:1,duration:1.2,ease:"power3.out"},8.8);')
js.append('tl.to("#phw",{y:-14,duration:30,ease:"none"},10.0);')
show(1, 9.4, .01)
tap(0, 10.7, 85, 246); tap(1, 12.9, 160, 768)
show(2, 14.2); hide(1, 14.3, .4)
show(3, 16.6); hide(2, 16.8, .4); tap(2, 16.4, 190, 158); tap(3, 18.2, 190, 790)
show(4, 19.3); hide(3, 19.5, .4); tap(4, 22.9, 190, 790)
show(5, 24.3); hide(4, 24.5, .4); tap(5, 27.9, 190, 790)
show(6, 29.3); hide(5, 29.5, .4); tap(6, 31.2, 111, 185)
show(7, 34.3); hide(6, 34.5, .4); tap(7, 38.3, 190, 690)
# phone leaves for success, comes back left for sign in
js.append('tl.to("#ph",{opacity:0,scale:.94,duration:.6,ease:"power2.in"},39.7);')
js.append('tl.set("#ph",{x:-1012},40.4);')
js.append('tl.set("#sc7",{opacity:0},40.4);')
js.append('tl.fromTo("#ph",{opacity:0,y:70,rotationY:14,scale:.94},{opacity:1,y:0,rotationY:0,scale:1,duration:1.1,ease:"power3.out",immediateRender:false},43.2);')
js.append('tl.to("#phw",{y:-12,duration:11,ease:"none"},44.4);')
show(8, 43.4, .01)
tap(8, 45.2, 190, 196); show(9, 46.6); hide(8, 46.8, .4); tap(7 if False else 0, 45.8, 190, 196)
tap(1, 48.0, 190, 330)
show(10, 51.0); hide(9, 51.2, .4); tap(2, 50.5, 270, 250); tap(3, 53.2, 190, 790)
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
