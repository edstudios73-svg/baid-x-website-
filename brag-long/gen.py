#!/usr/bin/env python3
"""Generates composition/index.html: a 6-minute BAID X explainer. All copy comes from the project (ROLES blurbs, UI strings, pricing, flows)."""
import json

IC = {
    'check': '<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'arrow': '<path d="M5 12h14M13 6l6 6-6 6"/>', 'lock': '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    'user': '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/>', 'org': '<path d="M5 21V5l9-3v19M14 9l5 2v10M3 21h18M8 8h2M8 12h2M8 16h2"/>',
    'proj': '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M9 3V2h6v1M8 9h8M8 13h8M8 17h5"/>', 'store': '<path d="M3 9l1.5-5h15L21 9v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 12v8h14v-8"/>',
    'home': '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-6h4v6"/>', 'wallet': '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14" r="1"/>',
    'shield': '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>', 'chat': '<path d="M5 4h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 16h-7l-4.5 4v-4H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 4z"/>',
    'search': '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', 'bolt': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', 'id': '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.6-1.6 1.6-2.2 2.5-2.2s1.9.6 2.5 2.2M14 10h4M14 13.5h3"/>',
    'box': '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>', 'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'phone': '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    'star': '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>', 'grow': '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>', 'task': '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    'tool': '<path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>', 'scale': '<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>', 'bell': '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2H4.5zM10 20a2 2 0 0 0 4 0"/>',
    'mega': '<path d="M3 11v2a1 1 0 0 0 1 1h2l8 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5"/>', 'cal': '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', 'mail': '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
}
def ic(k, s=40, st=1.7): return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{st}" stroke-linecap="round" stroke-linejoin="round">{IC[k]}</svg>'
def seal(c, s=44): return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" style="color:{c};filter:drop-shadow(0 0 8px {c}88)"><use href="#seal"/></svg>'
BLUE, GREEN, VIOLET, GOLD, CREAM = '#38bdf8', '#34d399', '#a78bfa', '#e8c46a', '#e8d9a8'

scenes = []   # (id, start, dur, html, js)
T = [0.0]
N = [0]
def uid(p='x'):
    N[0] += 1
    return f'{p}{N[0]}'

def add(dur, html_fn):
    t0 = T[0]; sid = uid('s'); js = []
    html = html_fn(sid, t0, js)
    scenes.append((sid, t0, dur, html, js)); T[0] += dur

# animation helpers append absolute-time tweens
def rise(js, sel, t, d=0.8, y=46, x=0): js.append(f'tl.fromTo("{sel}",{{opacity:0,y:{y},x:{x}}},{{opacity:1,y:0,x:0,duration:{d},ease:"power3.out"}},{t:.2f});')
def pop(js, sel, t, d=0.6, sc=0.86): js.append(f'tl.fromTo("{sel}",{{opacity:0,scale:{sc}}},{{opacity:1,scale:1,duration:{d},ease:"back.out(1.5)"}},{t:.2f});')
def stag(js, sel, t, each=0.28, d=0.7, y=46): js.append(f'tl.fromTo("{sel}",{{opacity:0,y:{y}}},{{opacity:1,y:0,duration:{d},ease:"power3.out",stagger:{each}}},{t:.2f});')
def line(js, sel, t, d=1.2): js.append(f'tl.fromTo("{sel}",{{scaleX:0}},{{scaleX:1,duration:{d},ease:"power2.inOut"}},{t:.2f});')
def drift(js, sel, t, dur, dx, dy, sc=1.0): js.append(f'tl.to("{sel}",{{x:{dx},y:{dy},scale:{sc},duration:{dur},ease:"none"}},{t:.2f});')

# ---------- layout pieces
def head(eyebrow, headline, sub=None, i=''):
    h = f'<div id="{i}e" class="eb">{eyebrow}</div><h2 id="{i}h">{headline}</h2>'
    h += f'<p id="{i}p" class="sub"' + ('' if sub else ' style="display:none"') + f'>{sub or ""}</p>'
    return h

def card(icon, title, desc, cls='', col=GOLD, extra=''):
    return f'<div class="cd {cls}"><span class="cdi" style="color:{col};border-color:{col}55;background:{col}14">{icon}</span><b>{title}</b><small>{desc}</small>{extra}</div>'

def phone(inner, w=470):
    return f'<div class="dev" style="width:{w}px"><div class="devbar"></div>{inner}</div>'

# ---------- UI mock bits (recreations of real BAID X screens; names/amounts are fictional)
def m_head(t): return f'<div class="mh"><span class="mb">‹</span><b>{t}</b></div>'
def m_row(icon, t, s, right='', col=GOLD): return f'<div class="mr"><span class="mri" style="color:{col}">{icon}</span><span class="mt"><b>{t}</b><small>{s}</small></span>{right}</div>'
def pill(t, c='ok'): return f'<span class="pl {c}">{t}</span>'

# ======================================================================
# 1 · intro
def s_intro(sid, t0, js):
    js.append(f'tl.fromTo("#{sid}logo",{{opacity:0,scale:0.9,y:20}},{{opacity:1,scale:1,y:0,duration:1.6,ease:"power3.out"}},{t0+0.6:.2f});')
    js.append(f'tl.fromTo("#{sid}rule",{{scaleX:0}},{{scaleX:1,duration:1.6,ease:"power2.inOut"}},{t0+2.2:.2f});')
    rise(js, f'#{sid}t', t0+3.0, 1.0); rise(js, f'#{sid}p', t0+4.6, 0.9, 24)
    return f'<div class="sc"><img id="{sid}logo" class="logo" src="assets/logo.png" /><div id="{sid}rule" class="rule"></div><div id="{sid}t" class="big">Ghana\'s work network</div><p id="{sid}p" class="sub">How BAID X works, and what it does for every role.</p></div>'
add(12, s_intro)

# 2 · kinetic promise
def s_promise(sid, t0, js):
    words = ['Hire.', 'Work.', 'Supply.', 'Pay safely.']
    for i in range(4): pop(js, f'#{sid}w{i}', t0 + 0.8 + i * 1.6, 0.8, 0.9)
    rise(js, f'#{sid}p', t0 + 8.0, 1.0, 24)
    h = ''.join(f'<span id="{sid}w{i}" class="kw {"gold" if i == 3 else ""}">{w}</span>' for i, w in enumerate(words))
    return f'<div class="sc"><div class="kline">{h}</div><p id="{sid}p" class="sub">One place for professionals, companies, project managers, suppliers and clients.</p></div>'
add(12, s_promise)

# 3 · five roles
ROLES = [
    ('user', 'Professional', 'Set up your personal trade profile and let clients and companies find and hire you.', GOLD),
    ('org', 'Company', 'Post jobs, build projects and hire verified professionals, project managers and suppliers.', BLUE),
    ('proj', 'Project Manager', 'Run delivery on company projects: tasks, teams, reports and resource requests.', VIOLET),
    ('store', 'Supplier', 'List products, equipment and materials, and quote on what projects need.', GREEN),
    ('home', 'Client', 'Hiring for your home? Find a trade, message them and keep a record of your hires.', CREAM),
]
def s_roles(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9)
    stag(js, f'#{sid} .cd', t0 + 3.0, 1.8, 0.9, 60)
    cards = ''.join(card(ic(i, 44), t, d, 'role', c) for i, t, d, c in ROLES)
    return f'<div class="sc">{head("Five account types", "Pick the role that fits you", None, sid)}<div class="grid5">{cards}</div></div>'
add(24, s_roles)

# chapter card
def chapter(num, roman, title, line_, col):
    def f(sid, t0, js):
        rise(js, f'#{sid}n', t0 + 0.2, 0.9, 20); line(js, f'#{sid}r', t0 + 0.6, 1.4); rise(js, f'#{sid}t', t0 + 1.0, 0.9); rise(js, f'#{sid}p', t0 + 2.2, 0.8, 20)
        return f'<div class="sc"><div id="{sid}n" class="chn" style="color:{col}">Chapter {roman}</div><div id="{sid}r" class="rule" style="background:{col}"></div><div id="{sid}t" class="big">{title}</div><p id="{sid}p" class="sub">{line_}</p></div>'
    return f
def chapter_scene(num, roman, title, line_, col, dur=5):
    add(dur, chapter(num, roman, title, line_, col))
    return T[0] - dur

CH = {}
# ---------------- Chapter I
CH[1] = chapter_scene(1, 'I', 'Get started', 'Sign up with your phone number.', GOLD)

def s_signup(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
    stag(js, f'#{sid} .stp', t0 + 3.2, 2.6, 0.8, 40)
    pop(js, f'#{sid}dev', t0 + 3.0, 0.9)
    js.append(f'tl.fromTo("#{sid} .otpb",{{opacity:0,scale:0.8}},{{opacity:1,scale:1,duration:0.45,ease:"back.out(1.6)",stagger:0.35}},{t0+6.2:.2f});')
    otp = ''.join(f'<i class="otpb">{d}</i>' for d in '482917')
    mock = phone(f'{m_head("Verify your number")}<p class="mp">We texted a 6-digit code to +233 24 ••• 8347</p><div class="otp">{otp}</div><div class="mbtn">Continue</div><div class="mfine">Resend in 0:24</div>')
    steps = [('1', 'Enter your phone number', 'No email needed to start.'), ('2', 'Type the one-time code', 'Sent by SMS to your number.'), ('3', 'Choose a password', 'At least 8 characters, with a letter, a number and a capital letter or symbol.'), ('4', 'Choose your account type', 'Professional, Company, Project Manager, Supplier or Client.')]
    st = ''.join(f'<div class="stp"><i>{a}</i><div><b>{b}</b><small>{c}</small></div></div>' for a, b, c in steps)
    return f'<div class="sc split"><div class="col">{head("Sign up", "Your phone number is your key", "Quick, and no password reset by email.", sid)}<div class="stps">{st}</div></div><div id="{sid}dev" class="col r">{mock}</div></div>'
add(18, s_signup)

def s_checklist(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
    pop(js, f'#{sid}dev', t0 + 2.6, 0.9)
    js.append(f'tl.fromTo("#{sid} .ck",{{opacity:0,x:30}},{{opacity:1,x:0,duration:0.6,ease:"power3.out",stagger:0.7}},{t0+3.4:.2f});')
    rows = [('Phone number', 'Done', 'ok'), ('Email', 'Pending', 'warn'), ('Basic profile', 'Pending', 'warn'), ('Trade category', 'Pending', 'warn'), ('About you', 'Pending', 'warn'), ('Portfolio', 'Pending', 'warn'), ('Location', 'Done', 'ok')]
    r = ''.join(f'<div class="ck">{pill("✓" if s == "Done" else "…", c)}<b>{n}</b><span class="ckt {c}">{s}</span></div>' for n, s, c in rows)
    mock = phone(f'{m_head("Verification checklist")}<div class="prog"><span>2 of 10 completed</span><span>20%</span></div><div class="bar"><i style="width:20%"></i></div>{r}')
    side = [('Every item opens its own step', 'Only that item\'s questions, nothing repeated.'), ('Add your own email', 'Confirm it with a link, then sign in with it too.'), ('Take it step by step', 'Save, continue to the next unfinished step.')]
    sd = ''.join(f'<div class="stp"><i>{ic("check", 22, 2.4)}</i><div><b>{a}</b><small>{b}</small></div></div>' for a, b in side)
    return f'<div class="sc split"><div class="col">{head("Your profile", "Finish your profile, one step at a time", "A short checklist builds trust before anyone hires you.", sid)}<div class="stps s2">{sd}</div></div><div id="{sid}dev" class="col r">{mock}</div></div>'
def _w(sid, t0, js):
    html = s_checklist(sid, t0, js)
    js.append(f'tl.fromTo("#{sid}s",{{opacity:0,y:30}},{{opacity:1,y:0,duration:0.8,ease:"power3.out"}},{t0+8:.2f});')
    return html
add(16, s_checklist)

# ---------------- Chapter II
CH[2] = chapter_scene(2, 'II', 'Discover & trust', 'Find the right people, and know who they are.', BLUE)

def s_directory(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
    pop(js, f'#{sid}dev', t0 + 2.4, 0.9)
    js.append(f'tl.fromTo("#{sid} .dc",{{opacity:0,y:40}},{{opacity:1,y:0,duration:0.7,ease:"power3.out",stagger:0.9}},{t0+3.6:.2f});')
    chips = ''.join(f'<span class="chp {"on" if i == 0 else ""}">{c}</span>' for i, c in enumerate(['All', 'Companies', 'Professionals', 'Project Managers']))
    def dc(n, sub, kind, col): return f'<div class="dc"><span class="dav">{n[:2].upper()}</span><div><b>{n} {seal(col, 18)}</b><small>{sub}</small><em>{kind}</em></div></div>'
    cards = dc('Ama K.', 'Electrician · Accra', 'Professional', GOLD) + dc('Kofi Builders', 'Construction · Kumasi', 'Company', BLUE) + dc('Mensah Supply', 'Cement & Concrete · Tema', 'Supplier', GREEN)
    mock = phone(f'<div class="srch">{ic("search", 18)} Search</div><div class="chps">{chips}</div>{cards}')
    pts = [('search', 'Search and filter', 'By type, category and location across Ghana.'), ('chat', 'Message anyone', 'Start a conversation right from a card.'), ('shield', 'Every member is public', 'Verified members show a coloured badge.')]
    sd = ''.join(f'<div class="stp"><i>{ic(a, 22, 2)}</i><div><b>{b}</b><small>{c}</small></div></div>' for a, b, c in pts)
    return f'<div class="sc split"><div class="col">{head("Discover verified professionals", "One directory for everyone", "Companies, professionals, project managers and suppliers.", sid)}<div class="stps s2">{sd}</div></div><div id="{sid}dev" class="col r">{mock}</div></div>'
add(16, s_directory)

def s_badges(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
    stag(js, f'#{sid} .bdc', t0 + 3.4, 2.4, 0.9, 50)
    rise(js, f'#{sid}f', t0 + 14.5, 0.9, 24)
    items = [(BLUE, 'Verified', 'Reviewed by BAID X', 'Free after review'), (GREEN, 'Identity', 'Your ID document is checked', 'GH₵10'), (VIOLET, 'Professional', 'ID plus trade and certificates checked', 'GH₵20'), (GOLD, 'Advanced', 'Everything, plus references and a background check', 'GH₵35')]
    cards = ''.join(f'<div class="bdc" style="border-color:{c}55"><div class="bds">{seal(c, 78)}</div><b style="color:{c}">{n}</b><small>{d}</small><span class="bdp">{p}</span></div>' for c, n, d, p in items)
    return f'<div class="sc">{head("Verification badges", "Your badge colour shows how you were verified", None, sid)}<div class="grid4">{cards}</div><p id="{sid}f" class="sub">Paying starts the review. Approval is decided by BAID X, and the badge colour updates automatically.</p></div>'
add(20, s_badges)

# ---------------- Chapter III roles
CH[3] = chapter_scene(3, 'III', 'Five roles', 'What each account does on BAID X.', VIOLET)

def role_scene(icon_k, role, col, tagline, feats, mock_html, dur):
    def f(sid, t0, js):
        rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
        pop(js, f'#{sid}dev', t0 + 2.6, 0.9)
        gap = (dur - 6.0) / max(len(feats), 1)
        stag(js, f'#{sid} .stp', t0 + 3.4, gap, 0.8, 40)
        sd = ''.join(f'<div class="stp"><i style="color:{col};border-color:{col}66">{ic(a, 22, 2)}</i><div><b>{b}</b><small>{c}</small></div></div>' for a, b, c in feats)
        return f'<div class="sc split"><div class="col"><div id="{sid}e" class="eb" style="color:{col}">{role}</div><h2 id="{sid}h">{tagline[0]}</h2><p id="{sid}p" class="sub">{tagline[1]}</p><div class="stps">{sd}</div></div><div id="{sid}dev" class="col r">{phone(mock_html)}</div></div>'
    add(dur, f)

role_scene('user', 'Professional', GOLD, ('Get found. Get hired. Get paid.', 'Set up your personal trade profile and let clients and companies find and hire you.'), [
    ('work', 'Apply to jobs', 'Browse the Job Marketplace and apply to jobs that match your trade.') if False else ('search', 'Browse the Job Marketplace', 'Apply to jobs that match your trade.'),
    ('star', 'Show your best finished work', 'Add portfolio photos to your public profile.'),
    ('grow', 'Grow your career', 'Experience, level and certifications build your reputation.'),
    ('wallet', 'Withdraw to Mobile Money', 'Earnings land in your wallet when work is approved.')],
    f'{m_head("Work")}<div class="tabs"><span class="tb on">Applications</span><span class="tb">Active</span><span class="tb">Completed</span></div>{m_row(ic("task", 22), "Electrician for a 3-bedroom house", "Madina · applied 2h ago", pill("Submitted", "warn"))}{m_row(ic("task", 22), "Site wiring, new office", "Kumasi · you asked GH₵180", pill("Accepted", "ok"))}{m_row(ic("task", 22), "Lighting install", "Accra · applied 3d ago", pill("Shortlisted", "ok"))}', 22)

role_scene('org', 'Company', BLUE, ('Build projects. Hire with confidence.', 'Post jobs, build projects and hire verified professionals, project managers and suppliers.'), [
    ('task', 'Post jobs and pick applicants', 'See who applied, message them and hire.'),
    ('proj', 'Run projects in a workspace', 'Overview, Team, Tasks, Reports, Finance and Milestones.'),
    ('check', 'Approve what matters', 'Expenses, materials, equipment and payments always need your approval.'),
    ('box', 'Find equipment and materials', 'Compare supply from suppliers across Ghana.')],
    f'{m_head("Project workspace")}<div class="tabs"><span class="tb on">Overview</span><span class="tb">Team</span><span class="tb">Tasks</span><span class="tb">Finance</span></div><div class="mst"><div><small>Workers</small><b>12</b></div><div><small>Tasks done</small><b>24/31</b></div><div><small>Overdue</small><b>2</b></div></div>{m_row(ic("check", 22), "Approvals", "3 items waiting for you", pill("Review", "warn"))}{m_row(ic("wallet", 22), "Milestones", "GH₵4,500 held in escrow", pill("Funded", "ok"))}', 24)

role_scene('proj', 'Project Manager', VIOLET, ('Run delivery, step by step.', 'Tasks, teams, reports and resource requests, all in one project workspace.'), [
    ('task', 'Assign and track tasks', 'Everyone knows what is next.'),
    ('mail', 'Send reports', 'Reports go to the company for review.'),
    ('box', 'Request resources', 'Ask for equipment, materials and payments for approval.'),
    ('star', 'Show past projects', 'Build a track record clients can see.')],
    f'{m_head("Tasks")}{m_row(ic("task", 22), "Pour foundation slab", "Due Fri · Kwame M.", pill("In progress", "warn"), VIOLET)}{m_row(ic("task", 22), "Order roofing sheets", "Due next week · Esi A.", pill("Open", ""), VIOLET)}{m_row(ic("mail", 22), "Weekly report", "Waiting for company review", pill("Sent", "ok"), VIOLET)}{m_row(ic("box", 22), "Resource request", "Concrete mixer, 3 days", pill("Pending", "warn"), VIOLET)}', 20)

role_scene('store', 'Supplier', GREEN, ('Sell to the people who build.', 'List products, equipment and materials, and quote on what projects need.'), [
    ('box', 'Build your catalog', 'Products and equipment, with prices and photos.'),
    ('check', 'Accept orders', 'Payment is already held in escrow when an order arrives.'),
    ('bolt', 'Boost your listings', 'Appear higher in search and listings for the time you choose.'),
    ('wallet', 'Get paid', 'Money lands in your wallet when the buyer confirms.')],
    f'{m_head("Orders")}{m_row(ic("box", 22), "Cement × 4", "Kofi Builders · GH₵200.00", pill("Awaiting you", "warn"), GREEN)}{m_row(ic("tool", 22), "Concrete mixer, 3 days", "Esi A. · GH₵360.00", pill("Preparing", "warn"), GREEN)}{m_row(ic("box", 22), "Roofing sheets × 20", "Ama K. · GH₵1,100.00", pill("Paid", "ok"), GREEN)}', 22)

role_scene('home', 'Client', CREAM, ('Find a trade. Keep a record.', 'Hiring for your home? Find a trade, message them and keep a record of your hires.'), [
    ('search', 'Find the right trade', 'Mason, electrician, plumber, carpenter and more.'),
    ('task', 'Post a job', 'Describe it, set a daily rate, choose your workers.'),
    ('shield', 'Pay safely', 'Money is held in escrow until you approve the work.'),
    ('box', 'Order materials and equipment', 'Track every order in one place.')],
    f'{m_head("Hires")}{m_row(ic("user", 22), "Ama K. · Electrician", "3 days · GH₵600.00 held in escrow", pill("In progress", "warn"), CREAM)}{m_row(ic("user", 22), "Yaw T. · Plumber", "1 day · GH₵250.00", pill("Paid", "ok"), CREAM)}<div class="mbtn" style="margin-top:14px">Post a job</div>', 20)

# ---------------- Chapter IV money
CH[4] = chapter_scene(4, 'IV', 'Money, made safe', 'Wallet and escrow protect both sides.', GOLD)

def s_wallet(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
    pop(js, f'#{sid}dev', t0 + 2.6, 0.9)
    stag(js, f'#{sid} .stp', t0 + 3.4, 2.6, 0.8, 40)
    mock = phone(f'{m_head("Wallet")}<div class="wal"><small>Available balance</small><b>GH₵1,250.00</b><div class="walb"><span class="mbtn s">Add money</span><span class="mbtn s g">Withdraw</span></div></div>{m_row(ic("wallet", 22), "Deposit", "Paystack · today", "<span class=amt>+ GH₵500.00</span>")}{m_row(ic("shield", 22), "Held in escrow", "Electrician job", "<span class=amt>− GH₵600.00</span>")}')
    pts = [('wallet', 'Add money with Paystack', 'Pay securely by Mobile Money or card. Your balance updates the moment the payment is confirmed.'), ('lock', 'Withdraw with your password', 'Payouts go to Mobile Money after you authorize them.'), ('shield', 'Fees shown before you pay', 'The Paystack fee is shown in the sheet.')]
    sd = ''.join(f'<div class="stp"><i>{ic(a, 22, 2)}</i><div><b>{b}</b><small>{c}</small></div></div>' for a, b, c in pts)
    return f'<div class="sc split"><div class="col">{head("Wallet", "Add money. Withdraw earnings.", "Companies and clients add money; professionals, suppliers and project managers withdraw it.", sid)}<div class="stps">{sd}</div></div><div id="{sid}dev" class="col r">{mock}</div></div>'
add(16, s_wallet)

def flow_scene(eyebrow, headline, sub, steps, foot, dur, col=GOLD):
    def f(sid, t0, js):
        rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
        gap = (dur - 8.0) / max(len(steps), 1)
        js.append(f'tl.fromTo("#{sid} .fs",{{opacity:0,y:50}},{{opacity:1,y:0,duration:0.8,ease:"power3.out",stagger:{gap:.2f}}},{t0+3.4:.2f});')
        js.append(f'tl.fromTo("#{sid} .far",{{opacity:0,x:-16}},{{opacity:1,x:0,duration:0.5,ease:"power2.out",stagger:{gap:.2f}}},{t0+4.2:.2f});')
        rise(js, f'#{sid}f', t0 + dur - 4.0, 0.9, 24)
        parts = []
        for i, (lab, big, d) in enumerate(steps):
            parts.append(f'<div class="fs"><small>{lab}</small><b>{big}</b><span>{d}</span></div>')
            if i < len(steps) - 1: parts.append(f'<div class="far" style="color:{col}">{ic("arrow", 44, 2)}</div>')
        return f'<div class="sc">{head(eyebrow, headline, sub, sid)}<div class="flow">{"".join(parts)}</div><p id="{sid}f" class="sub gold2">{foot}</p></div>'
    add(dur, f)

flow_scene('Escrow for jobs', 'Hire, and your payment is held in escrow', 'You set the daily rate and the days. The total moves from your wallet into escrow.', [
    ('1 · Hire', 'GH₵200.00', 'Held in escrow'), ('2 · Work done', 'Submitted', 'The worker marks it complete'), ('3 · You approve', 'GH₵170.00', 'Paid to the worker'), ('BAID X fee', 'GH₵30.00', 'Commission on release')],
    'No reply from you? Payment releases automatically 3 days after the work is submitted.', 18)

flow_scene('Product & equipment orders', 'Order from a supplier, paid through escrow', 'Buy a product, rent equipment (price per day) or buy equipment.', [
    ('1 · Place order', 'GH₵200.00', 'Held in escrow'), ('2 · Supplier accepts', 'Accepted', 'No reply in 3 days? Refunded automatically'), ('3 · Delivered', 'Delivered', 'You confirm you received it'), ('4 · Supplier paid', 'GH₵170.00', 'After the BAID X fee')],
    'If you do nothing, payment releases automatically 3 days after delivery.', 16)

flow_scene('Project milestones', 'Pay your team as they deliver', 'The project owner defines a milestone for a team member and funds it into escrow.', [
    ('1 · Add milestone', 'Planned', 'Nothing is charged yet'), ('2 · Fund it', 'GH₵300.00', 'Moves into escrow'), ('3 · Team member submits', 'Submitted', 'You review the work'), ('4 · Approve', 'GH₵255.00', 'Released after the fee')],
    'No review for 5 days? The milestone releases automatically.', 16)

def s_disputes(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
    stag(js, f'#{sid} .cd', t0 + 3.6, 2.8, 0.9, 50)
    c = card(ic('scale', 40), 'Report a problem', 'Either side can open a dispute. The money stays safe in escrow while BAID X reviews it.', 'w3', GOLD) + card(ic('shield', 40), 'BAID X settles it', 'Pay the worker in full, split it, or refund. A note explains the decision to both people.', 'w3', GOLD) + card(ic('bell', 40), 'Both sides are told', 'Funds move once, and everyone is notified.', 'w3', GOLD)
    return f'<div class="sc">{head("Disputes", "When something goes wrong, the money waits", None, sid)}<div class="grid3">{c}</div></div>'
add(16, s_disputes)

# ---------------- Chapter V
CH[5] = chapter_scene(5, 'V', 'Grow', 'Plans, boosts and a digital ID.', VIOLET)

def s_plans(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.4, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.9, 0.9); rise(js, f'#{sid}p', t0 + 1.8, 0.8, 20)
    stag(js, f'#{sid} .cd', t0 + 3.4, 2.2, 0.9, 50)
    c = (card(ic('user', 40), 'Access', 'Free for good. Profile, search, messaging, applications, reviews, reputation and XID lookup.', 'w4', CREAM)
         + card(ic('star', 40), 'Pro, Premium, Enterprise', 'Choose a plan, pay with Paystack and your access starts when the payment is confirmed.', 'w4', GOLD)
         + card(ic('bolt', 40), 'Boosts', 'Appear higher in search for 24 hours up to 30 days.', 'w4', GOLD)
         + card(ic('id', 40), 'Digital ID', 'A shareable ID card, valid for a year.', 'w4', GOLD))
    return f'<div class="sc">{head("Plans & services", "Start free. Grow when you are ready.", None, sid)}<div class="grid4">{c}</div></div>'
add(14, s_plans)

def s_recap(sid, t0, js):
    rise(js, f'#{sid}e', t0 + 0.3, 0.7, 20); rise(js, f'#{sid}h', t0 + 0.7, 0.9)
    stag(js, f'#{sid} .rc', t0 + 2.0, 0.7, 0.7, 30)
    rows = [('user', 'Professional', 'finds work and gets paid', GOLD), ('org', 'Company', 'hires and runs projects', BLUE), ('proj', 'Project Manager', 'delivers on time', VIOLET), ('store', 'Supplier', 'sells to builders', GREEN), ('home', 'Client', 'hires with confidence', CREAM)]
    r = ''.join(f'<div class="rc"><span style="color:{c}">{ic(i, 34)}</span><b>{n}</b><small>{d}</small></div>' for i, n, d, c in rows)
    return f'<div class="sc">{head("One network", "Five roles. One place. Paid safely.", None, sid)}<div class="rcs">{r}</div></div>'
add(7, s_recap)

def s_outro(sid, t0, js):
    js.append(f'tl.fromTo("#{sid}logo",{{opacity:0,scale:0.92}},{{opacity:1,scale:1,duration:1.4,ease:"power3.out"}},{t0+0.3:.2f});')
    rise(js, f'#{sid}t', t0 + 1.6, 0.9, 24); rise(js, f'#{sid}p', t0 + 2.8, 0.9, 20)
    return f'<div class="sc"><img id="{sid}logo" class="logo" src="assets/logo.png" /><div id="{sid}t" class="big">Ghana\'s work network</div><p id="{sid}p" class="sub">baid-x-website.vercel.app</p></div>'
add(6, s_outro)

TOTAL = T[0]
assert abs(TOTAL - 360) < 0.01, TOTAL

# ---------- background light (soft glowing blobs, per-chapter colour) + chrome
bounds = [0] + [CH[k] for k in (1, 2, 3, 4, 5)] + [TOTAL]
hues = [GOLD, GOLD, BLUE, VIOLET, GOLD, VIOLET]  # intro, I..V
blob_js = []
cols = {'bgold': GOLD, 'bblue': BLUE, 'bviolet': VIOLET, 'bgreen': GREEN}
for k in cols: blob_js.append(f'tl.set("#{k}",{{opacity:0.0}},0);')
want = {0: {'bgold'}, 1: {'bgold', 'bblue'}, 2: {'bblue', 'bgreen'}, 3: {'bviolet', 'bgold'}, 4: {'bgold', 'bgreen'}, 5: {'bviolet', 'bgold'}}
for i, t in enumerate(bounds[:-1]):
    for k in cols:
        blob_js.append(f'tl.to("#{k}",{{opacity:{0.85 if k in want[i] else 0.0},duration:2.5,ease:"sine.inOut"}},{t:.2f});')
blob_js.append('tl.fromTo("#bgold",{x:-200,y:-120},{x:260,y:140,duration:360,ease:"none"},0);')
blob_js.append('tl.fromTo("#bblue",{x:240,y:160},{x:-260,y:-100,duration:360,ease:"none"},0);')
blob_js.append('tl.fromTo("#bviolet",{x:-120,y:200},{x:220,y:-160,duration:360,ease:"none"},0);')
blob_js.append('tl.fromTo("#bgreen",{x:180,y:-140},{x:-200,y:180,duration:360,ease:"none"},0);')
blob_js.append('tl.fromTo("#prog",{scaleX:0},{scaleX:1,duration:360,ease:"none"},0);')

CSS = '''
@font-face { font-family: Inter; font-weight: 400; src: url(assets/fonts/inter-latin-400-normal.woff2) format("woff2"); }
@font-face { font-family: Inter; font-weight: 600; src: url(assets/fonts/inter-latin-600-normal.woff2) format("woff2"); }
@font-face { font-family: Inter; font-weight: 800; src: url(assets/fonts/inter-latin-800-normal.woff2) format("woff2"); }
:root { --bg:#050505; --card:#0e0e0e; --line:rgba(255,255,255,.12); --text:#f6f6f7; --muted:#b9b9b9; --gold:#e8c46a; --cream:#e8d9a8; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width:1920px; height:1080px; background:var(--bg); overflow:hidden; font-family:Inter,system-ui,sans-serif; color:var(--text); }
#root { position:relative; width:1920px; height:1080px; background:var(--bg); overflow:hidden; }
.blob { position:absolute; width:1300px; height:1300px; border-radius:50%; left:310px; top:-110px; opacity:0; }
#bgold { background:radial-gradient(circle, rgba(232,196,106,.34), transparent 62%); }
#bblue { background:radial-gradient(circle, rgba(56,189,248,.26), transparent 62%); }
#bviolet { background:radial-gradient(circle, rgba(167,139,250,.28), transparent 62%); }
#bgreen { background:radial-gradient(circle, rgba(52,211,153,.22), transparent 62%); }
.frame { position:absolute; inset:26px; border:1px solid rgba(232,217,168,.20); border-radius:6px; pointer-events:none; }
.frame::before, .frame::after { content:""; position:absolute; width:46px; height:46px; border:2px solid rgba(232,217,168,.55); }
.frame::before { left:-1px; top:-1px; border-right:0; border-bottom:0; } .frame::after { right:-1px; bottom:-1px; border-left:0; border-top:0; }
#progw { position:absolute; left:26px; right:26px; bottom:26px; height:3px; background:rgba(255,255,255,.06); } #prog { height:100%; background:linear-gradient(90deg,#e8c46a,#fff); transform-origin:left; }
.mark { position:absolute; left:64px; top:52px; font-weight:800; font-size:22px; letter-spacing:.3em; color:rgba(232,217,168,.8); }
.sc { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:96px 130px; text-align:center; }
.sc.split { flex-direction:row; gap:90px; text-align:left; justify-content:center; }
.col { flex:1; max-width:860px; } .col.r { flex:none; display:flex; justify-content:center; }
.eb { font-weight:600; font-size:28px; letter-spacing:.24em; text-transform:uppercase; color:var(--cream); margin-bottom:22px; }
h2 { font-weight:800; font-size:78px; line-height:1.06; letter-spacing:-.025em; margin-bottom:22px; }
.sc.split h2 { font-size:64px; }
.sub { font-size:34px; line-height:1.35; color:var(--muted); max-width:1500px; } .sc.split .sub { font-size:30px; margin-bottom:6px; }
.big + .sub { margin-top:30px; }
.gold2 { color:var(--cream); margin-top:40px; }
.big { font-weight:800; font-size:118px; line-height:1.05; letter-spacing:-.03em; margin-top:34px; }
.logo { width:620px; } .rule { width:420px; height:3px; background:var(--cream); margin:26px 0 6px; transform-origin:center; }
.chn { font-weight:600; font-size:30px; letter-spacing:.34em; text-transform:uppercase; }
.kline { display:flex; gap:56px; flex-wrap:wrap; justify-content:center; } .kw { font-weight:800; font-size:150px; letter-spacing:-.035em; } .kw.gold { color:var(--gold); }
.grid5 { display:grid; grid-template-columns:repeat(5,1fr); gap:26px; margin-top:36px; width:100%; } .grid4 { display:grid; grid-template-columns:repeat(4,1fr); gap:28px; margin-top:44px; width:100%; } .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:34px; margin-top:44px; width:100%; }
.cd { background:var(--card); border:1px solid var(--line); border-radius:28px; padding:34px 28px; text-align:left; display:flex; flex-direction:column; gap:14px; }
.cdi { width:78px; height:78px; border:1px solid; border-radius:22px; display:grid; place-items:center; } .cd b { font-size:36px; } .cd small { font-size:26px; line-height:1.4; color:var(--muted); }
.cd.w3 small, .cd.w4 small { font-size:28px; }
.bdc { background:var(--card); border:1px solid; border-radius:28px; padding:32px 24px; display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; } .bdc b { font-size:38px; } .bdc small { font-size:25px; color:var(--muted); line-height:1.35; min-height:70px; } .bdp { font-size:34px; font-weight:800; color:var(--cream); margin-top:8px; }
.stps { display:flex; flex-direction:column; gap:20px; margin-top:20px; } .stp { display:flex; gap:20px; align-items:flex-start; background:rgba(255,255,255,.035); border:1px solid var(--line); border-radius:22px; padding:18px 22px; }
.stp i { flex:none; width:50px; height:50px; border-radius:50%; border:2px solid rgba(232,217,168,.5); display:grid; place-items:center; font-style:normal; font-weight:800; font-size:24px; color:var(--cream); }
.stp b { display:block; font-size:30px; } .stp small { display:block; font-size:24px; color:var(--muted); margin-top:4px; line-height:1.35; }
.flow { display:flex; align-items:stretch; justify-content:center; gap:22px; margin-top:54px; width:100%; }
.fs { flex:1; background:var(--card); border:1px solid var(--line); border-radius:28px; padding:30px 28px; text-align:left; display:flex; flex-direction:column; gap:10px; max-width:380px; } .fs small { font-size:22px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); font-weight:600; } .fs b { font-size:50px; font-weight:800; color:var(--cream); } .fs span { font-size:25px; color:var(--muted); line-height:1.35; }
.far { align-self:center; flex:none; }
.rcs { display:flex; gap:22px; margin-top:44px; } .rc { background:var(--card); border:1px solid var(--line); border-radius:26px; padding:30px 24px; width:320px; display:flex; flex-direction:column; align-items:center; gap:10px; } .rc b { font-size:32px; } .rc small { font-size:24px; color:var(--muted); }
/* device mocks */
.dev { background:#0a0a0a; border:2px solid rgba(232,217,168,.28); border-radius:54px; padding:30px 24px 26px; box-shadow:0 40px 90px -30px rgba(0,0,0,.9); min-height:760px; }
.devbar { width:120px; height:8px; border-radius:9px; background:#222; margin:0 auto 22px; }
.mh { display:flex; gap:14px; align-items:center; margin-bottom:18px; } .mh b { font-size:30px; } .mb { width:44px; height:44px; border-radius:50%; background:#1a1a1a; display:grid; place-items:center; font-size:30px; }
.mp { font-size:24px; color:var(--muted); line-height:1.4; margin-bottom:24px; }
.otp { display:flex; gap:12px; justify-content:center; margin-bottom:26px; } .otp i { width:60px; height:76px; border-radius:16px; border:2px solid rgba(255,255,255,.18); background:#101010; display:grid; place-items:center; font-style:normal; font-weight:800; font-size:38px; }
.mbtn { background:#f6f6f7; color:#0a0a0a; font-weight:800; font-size:26px; text-align:center; padding:18px; border-radius:99px; } .mbtn.s { display:inline-block; padding:12px 26px; font-size:22px; } .mbtn.g { background:transparent; color:#fff; border:1px solid rgba(255,255,255,.3); }
.mfine { text-align:center; color:var(--muted); font-size:21px; margin-top:16px; }
.mr { display:flex; gap:14px; align-items:center; background:#101010; border:1px solid #232323; border-radius:20px; padding:16px; margin-bottom:12px; } .mri { flex:none; } .mt { flex:1; min-width:0; } .mt b { display:block; font-size:24px; } .mt small { display:block; font-size:19px; color:var(--muted); margin-top:2px; }
.pl { font-weight:800; font-size:17px; padding:5px 12px; border-radius:99px; background:#1d1d1d; color:#ddd; white-space:nowrap; } .pl.ok { background:rgba(52,211,153,.18); color:#34d399; } .pl.warn { background:rgba(232,196,106,.18); color:#e8c46a; }
.tabs { display:flex; gap:10px; margin-bottom:16px; } .tb { padding:9px 16px; border-radius:99px; border:1px solid #2a2a2a; font-weight:700; font-size:19px; color:#cfcfcf; } .tb.on { background:#f6f6f7; color:#0a0a0a; border-color:#f6f6f7; }
.mst { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .mst div { background:#101010; border:1px solid #232323; border-radius:16px; padding:14px; } .mst small { display:block; font-size:17px; color:var(--muted); } .mst b { font-size:30px; color:var(--cream); }
.ck { display:flex; gap:12px; align-items:center; background:#101010; border:1px solid #232323; border-radius:18px; padding:14px 16px; margin-bottom:10px; } .ck b { flex:1; font-size:23px; } .ckt { font-size:19px; font-weight:800; } .ckt.ok { color:#34d399; } .ckt.warn { color:#e8c46a; }
.prog { display:flex; justify-content:space-between; font-size:21px; color:var(--muted); margin-bottom:8px; } .bar { height:8px; background:#222; border-radius:9px; margin-bottom:18px; overflow:hidden; } .bar i { display:block; height:100%; background:var(--cream); }
.srch { display:flex; gap:10px; align-items:center; background:#101010; border:1px solid #2a2a2a; border-radius:99px; padding:14px 20px; font-size:22px; color:var(--muted); margin-bottom:14px; }
.chps { display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; } .chp { padding:9px 15px; border-radius:99px; border:1px solid #2a2a2a; font-weight:700; font-size:18px; color:#cfcfcf; } .chp.on { background:#f6f6f7; color:#0a0a0a; border-color:#f6f6f7; }
.dc { display:flex; gap:16px; align-items:center; background:#101010; border:1px solid #232323; border-radius:22px; padding:16px; margin-bottom:12px; } .dav { width:64px; height:64px; border-radius:50%; background:#1d1d1d; display:grid; place-items:center; font-weight:800; font-size:22px; flex:none; } .dc b { display:flex; gap:8px; align-items:center; font-size:25px; } .dc small { display:block; font-size:19px; color:var(--muted); } .dc em { display:block; font-style:normal; font-size:15px; letter-spacing:.14em; text-transform:uppercase; color:var(--cream); margin-top:6px; font-weight:600; }
.wal { background:linear-gradient(145deg,#1b1b1b,#0b0b0b); border:1px solid rgba(255,255,255,.16); border-radius:26px; padding:24px; margin-bottom:16px; } .wal small { color:var(--muted); font-size:20px; } .wal b { display:block; font-size:52px; margin:8px 0 18px; } .walb { display:flex; gap:12px; }
.amt { font-weight:800; font-size:22px; color:var(--cream); }
'''

def build():
    body = []
    for sid, t0, dur, html, js in scenes:
        body.append(f'<div id="{sid}" class="clip" data-start="{t0:.2f}" data-duration="{dur:.2f}" style="position:absolute;inset:0">{html}</div>')
    allj = '\n  '.join(blob_js + [j for s in scenes for j in s[4]])
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=1920, height=1080" /><style>{CSS}</style></head>
<body>
<div id="root" data-composition-id="root" data-width="1920" data-height="1080" data-start="0" data-duration="{int(TOTAL)}">
  <div class="blob" id="bgold"></div><div class="blob" id="bblue"></div><div class="blob" id="bviolet"></div><div class="blob" id="bgreen"></div>
  <div class="frame"></div><div class="mark">BAID X</div><div id="progw"><div id="prog"></div></div>
  {chr(10).join(body)}
  <svg width="0" height="0" style="position:absolute"><defs><symbol id="seal" viewBox="0 0 24 24"><path d="M12 2.5 14.6 4.4 17.8 4.3 18.8 7.3 21.4 9.2 20.4 12.2 21.4 15.2 18.8 17.1 17.8 20.1 14.6 20 12 21.9 9.4 20 6.2 20.1 5.2 17.1 2.6 15.2 3.6 12.2 2.6 9.2 5.2 7.3 6.2 4.3 9.4 4.4z" fill="currentColor"/><path d="m8.6 12.2 2.4 2.4 4.4-4.9" stroke="#0a0a0a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol></defs></svg>
  <audio id="bed" data-start="0" data-duration="{int(TOTAL)}" data-track-index="1" data-volume="0.45" data-fade-in="1.5" data-fade-out="5" src="assets/music/bed.mp3"></audio>
</div>
<script src="vendor/gsap.min.js"></script>
<script>
  const tl = gsap.timeline({{ paused: true }});
  {allj}
  window.__timelines = window.__timelines || {{}};
  window.__timelines["root"] = tl;
</script></body></html>'''

open('composition/index.html', 'w').write(build())
print('scenes', len(scenes), 'total', TOTAL)
