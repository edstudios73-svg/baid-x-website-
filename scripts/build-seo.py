#!/usr/bin/env python3
"""Generates BAID X's search + AI-engine surface: role pages, Ghana region hubs, trades hub,
sitemap.xml, robots.txt, llms.txt, llms-full.txt, humans.txt, and injects structured data into the main pages.
Run from the repo root:  python3 scripts/build-seo.py   (idempotent)."""
import json, re, os, html, datetime
SITE = "https://baid-x-website.vercel.app"
TODAY = datetime.date.today().isoformat()
ORG_ID = SITE + "/#org"; BRAND_ID = SITE + "/#brand"; APP_ID = SITE + "/#app"; SITE_ID = SITE + "/#website"
DESC = "BAID X is Ghana's work network: verified professionals, companies, project managers, suppliers and clients on one trusted platform to hire, run projects and get paid."
OG = SITE + "/assets/og-image.png?v=4"
esc = html.escape
w = lambda path, s: (os.makedirs(os.path.dirname(path) or ".", exist_ok=True), open(path, "w", encoding="utf-8").write(s))

# ---------- data ----------
def trades():
    s = open("js/common.js").read(); a = s.index("const JOB_CATS = ["); b = s.index("];", a)
    out = []
    for g, items in re.findall(r'J\("(\w+)", \[(.*?)\]\)', s[a:b], re.S):
        out.append((g, re.findall(r'"[0-9a-f-]{36}", "([^"]+)"', items)))
    return out
GROUP_LABEL = {"structural": "Structural & concrete", "electrical_mechanical": "Electrical & mechanical", "plumbing_water": "Plumbing & water", "finishing_interior": "Finishing & interior", "exterior_compound": "Exterior & compound", "support_general": "Support & general"}
TRADES = trades()

REGIONS = [
 ("Greater Accra","greater-accra","Accra",["Accra","Tema","Madina","Ashaiman","Dodowa"],"the national capital region and the busiest construction and commercial market in Ghana"),
 ("Ashanti","ashanti","Kumasi",["Kumasi","Obuasi","Ejisu","Konongo","Mampong"],"Ghana's second major urban market, centred on Kumasi"),
 ("Central","central","Cape Coast",["Cape Coast","Kasoa","Winneba","Mankessim","Assin Fosu"],"a coastal region with fast-growing towns close to Accra"),
 ("Eastern","eastern","Koforidua",["Koforidua","Nkawkaw","Suhum","Akim Oda","Nsawam"],"a large inland region linking Accra to the Ashanti and Volta corridors"),
 ("Western","western","Sekondi-Takoradi",["Sekondi-Takoradi","Tarkwa","Axim","Prestea","Half Assini"],"home to the twin city of Sekondi-Takoradi and Ghana's mining and energy activity"),
 ("Western North","western-north","Sefwi Wiawso",["Sefwi Wiawso","Bibiani","Enchi","Juaboso","Essam"],"one of Ghana's newest regions, with growing demand for building and infrastructure trades"),
 ("Volta","volta","Ho",["Ho","Keta","Aflao","Hohoe","Sogakope"],"the eastern region on the Togo border, with strong trading towns"),
 ("Oti","oti","Dambai",["Dambai","Kete Krachi","Nkwanta","Jasikan","Kadjebi"],"a newer region carved from the Volta Region, growing along the Volta Lake"),
 ("Northern","northern","Tamale",["Tamale","Yendi","Savelugu","Bimbilla","Gushegu"],"the commercial centre of northern Ghana, anchored by Tamale"),
 ("Savannah","savannah","Damongo",["Damongo","Bole","Salaga","Buipe","Sawla"],"Ghana's largest region by area, with a growing building market"),
 ("North East","north-east","Nalerigu",["Nalerigu","Walewale","Gambaga","Chereponi","Bunkpurugu"],"a newer northern region with expanding public and private projects"),
 ("Upper East","upper-east","Bolgatanga",["Bolgatanga","Bawku","Navrongo","Zebilla","Sandema"],"the far north-east, with Bolgatanga as its hub"),
 ("Upper West","upper-west","Wa",["Wa","Tumu","Lawra","Jirapa","Nandom"],"the north-west, where Wa is the regional capital"),
 ("Bono","bono","Sunyani",["Sunyani","Berekum","Dormaa Ahenkro","Wenchi","Sampa"],"a fast-developing middle-belt region around Sunyani"),
 ("Bono East","bono-east","Techiman",["Techiman","Kintampo","Atebubu","Nkoranza","Yeji"],"a central transport crossroads with Techiman's large market"),
 ("Ahafo","ahafo","Goaso",["Goaso","Bechem","Kenyasi","Duayaw Nkwanta","Hwidiem"],"a middle-belt region with mining and farming economies"),
]
ROLES = [
 dict(slug="workers", name="Workers", h1="Find steady work across Ghana as a verified professional", short="Electricians, masons, plumbers, painters and 50 other trades.",
  lead="Build a verified profile, get found by companies and clients, apply for jobs, join real projects and get paid to your mobile money wallet.",
  perks=[("Verified badge","Submit your Ghana Card once. A BAID X reviewer checks it and your profile earns the Verified badge. The badge cannot be bought."),("Job marketplace","Browse open jobs by trade, town and daily rate, and apply in a tap."),("Project teams","Accept invitations from companies and project managers, take tasks and post photo updates."),("Wallet & payouts","Earnings are recorded in your wallet and paid out to mobile money."),("Career growth","Earn experience points and rank tiers from finished work and verification."),("Secure messaging","Talk to employers with encrypted messages, voice notes, and voice or video calls.")],
  steps=[("Create your account","Sign up with your mobile number and choose Professional."),("Complete your profile","Add your trade, town, daily rate, photo and a cover image."),("Get verified","Upload your Ghana Card and any trade certificates."),("Apply and join projects","Apply for jobs or accept project invitations, then deliver and get paid.")]),
 dict(slug="companies", name="Companies", h1="Staff, run and pay for your projects with people you can verify", short="Create projects, bring in a project manager and workers, and approve spending.",
  lead="BAID X gives construction and service companies one place to find verified workers and project managers, assign tasks, review reports and approve every payment.",
  perks=[("Verified workforce","Search verified professionals and project managers by trade and region."),("Project control","Create projects with a budget, team size and trades needed. Each gets a project ID."),("Approval rules","Choose whether workers your project manager invites join automatically or need your approval. Money always needs your approval."),("Reports & tasks","See daily and weekly reports, task progress and photos in one place."),("Payments & records","Approve requests and record worker and manager payments against each project."),("Organizations","Give your finance, site and admin staff the right level of access.")],
  steps=[("Create your company account","Add your company details and submit registration documents for verification."),("Create a project","Set the budget, location, dates and the trades you need."),("Invite a project manager and workers","Invite from a project, or share a join code with your project manager."),("Approve and pay","Review reports and requests, approve payments and complete the project.")]),
 dict(slug="project-managers", name="Project managers", h1="Run site delivery for companies across Ghana", short="Team, tasks, reports and requests, inside limits the company sets.",
  lead="Get linked to a company by invitation or join code, build your crew, assign tasks, file reports and request materials, all from your phone.",
  perks=[("Company links","Accept a company's invitation or enter its join code to link up."),("Build your crew","Invite workers by trade, location and rating. Out-of-plan hires go to the company for approval."),("Tasks","Create and assign tasks with priority and due dates. Workers accept and update with photos."),("Reports","File daily and weekly reports with progress and materials needed."),("Requests","Ask the company for materials, equipment or money."),("Reputation","Reviews and delivered projects build a verified track record.")],
  steps=[("Create your account","Choose Project manager and add your specialization and certification."),("Get verified","Submit identity documents for review."),("Link to a company","Accept an invitation or use a company's join code."),("Deliver the project","Build the team, assign tasks, report progress and request what you need.")]),
 dict(slug="suppliers", name="Suppliers", h1="Sell materials and rent equipment to real projects in Ghana", short="Catalog, inquiries and orders from companies and clients.",
  lead="List building materials, tools and equipment, answer inquiries in chat and reach the companies and project managers who buy for live projects.",
  perks=[("Catalog","Add products and equipment with price, category and availability."),("Inquiries","Receive questions from companies and clients and reply in chat."),("Service areas","Show where you deliver and how far you travel."),("Verified business","Submit your business documents to earn the Verified badge."),("Cover & logo","Brand your listing with a logo and a cover image."),("Wallet","Track earnings and payouts in your wallet.")],
  steps=[("Create your business account","Add your business name, specialty and service areas."),("Build your catalog","List products and equipment with prices."),("Get verified","Upload business registration documents."),("Win orders","Respond to inquiries and agree delivery in chat.")]),
 dict(slug="clients", name="Individual clients", h1="Hire a trusted professional for your home", short="Post a job, message verified pros, keep a record of who you hired.",
  lead="Whether you need an electrician, plumber, painter or handyman, find verified professionals near you and agree the job in one secure chat.",
  perks=[("Post a job","Describe the work, set your rate and place, and let professionals apply."),("Find a trade","Browse verified professionals by trade and region."),("Message first","Agree scope and price in chat before anyone arrives."),("Hires record","Keep a list of the people you have hired."),("Verified people","Every verified profile has been checked by a BAID X reviewer."),("Clear and private","Messages are end-to-end encrypted between devices.")],
  steps=[("Create your account","Choose Client and verify your phone number."),("Post a job or browse","Find a professional by trade and place."),("Agree details","Confirm the work, rate and timing in chat."),("Hire and record","Mark the hire and keep the contact for next time.")]),
]

# ---------- shared page chrome ----------
NAV = '<nav><a href="/about.html">About</a><a href="/for/workers/">For workers</a><a href="/for/companies/">For companies</a><a href="/trades/">Trades</a><a href="/ghana/">Regions</a><a href="/pricing/">Pricing</a><a href="/docs.html">User guide</a></nav>'
def head(title, desc, path, ld, extra=""):
    url = SITE + path
    return f'''<!DOCTYPE html>
<html lang="en-GH">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
<link rel="canonical" href="{url}" />
<link rel="alternate" hreflang="en-GH" href="{url}" /><link rel="alternate" hreflang="x-default" href="{url}" />
<meta name="geo.region" content="GH" /><meta name="geo.placename" content="Ghana" /><meta name="geo.position" content="7.9465;-1.0232" /><meta name="ICBM" content="7.9465, -1.0232" />
<meta name="theme-color" content="#050505" /><meta name="color-scheme" content="dark" />
<meta name="author" content="Baiden Creatives" /><meta name="application-name" content="BAID X" />
<link rel="icon" href="/assets/favicon.ico?v=2" sizes="any" /><link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png?v=2" /><link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png?v=2" /><link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png?v=2" /><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=2" /><link rel="manifest" href="/manifest.webmanifest" />
<meta property="og:type" content="website" /><meta property="og:site_name" content="BAID X" /><meta property="og:locale" content="en_GH" />
<meta property="og:title" content="{esc(title)}" /><meta property="og:description" content="{esc(desc)}" /><meta property="og:url" content="{url}" />
<meta property="og:image" content="{OG}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="{esc(title)}" /><meta name="twitter:description" content="{esc(desc)}" /><meta name="twitter:image" content="{OG}" />
{extra}<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False, separators=(",", ":"))}</script>
<link rel="stylesheet" href="/css/site.css" /><link rel="stylesheet" href="/css/seo.css" />
</head>
<body>
<div class="orb a"></div><div class="orb b"></div>
<header class="nav"><div class="nav-in"><a href="/"><img src="/assets/logo.png" alt="BAID X" /></a>{NAV}<span class="sp"></span><a class="cta" href="/">Open BAID X</a></div></header>
'''
FOOT = '''<footer class="f"><div class="f-in"><span>© BAID X · Powered by Baiden Creatives</span><nav><a href="/about.html">About</a><a href="/pricing/">Pricing</a><a href="/escrow/">Escrow</a><a href="/verification/">Verification</a><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/for/workers/">Workers</a><a href="/for/companies/">Companies</a><a href="/for/project-managers/">Project managers</a><a href="/for/suppliers/">Suppliers</a><a href="/for/clients/">Clients</a><a href="/trades/">Trades</a><a href="/ghana/">Regions</a></div></nav></footer>
<script>(function(){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}})},{threshold:.1});document.querySelectorAll(".rv").forEach(function(el){io.observe(el)})})();</script>
</body></html>
'''
FOOT = FOOT.replace("</div></nav></footer>", "</nav></div></footer>")
def crumbs(items):
    return {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + p} for i, (n, p) in enumerate(items)]}
def crumb_html(items):
    return '<nav class="crumbs" aria-label="Breadcrumb">' + " <i>/</i> ".join(f'<a href="{p}">{esc(n)}</a>' for n, p in items[:-1]) + f' <i>/</i> <span aria-current="page">{esc(items[-1][0])}</span></nav>'
def ic(p): return f'<div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{p}</svg></div>'
CHECK = '<path d="m5 12 4.500 4.500L19 7"/>'
ORG = {"@type": "Organization", "@id": ORG_ID, "name": "Baiden Creatives", "url": SITE + "/", "brand": {"@id": BRAND_ID}}
BRAND = {"@type": "Brand", "@id": BRAND_ID, "name": "BAID X", "url": SITE + "/", "logo": SITE + "/assets/icon-512.png", "slogan": "Ghana's work network", "description": DESC}

def page(path, title, desc, h1, lead, body, ld_extra, crumb_items, eyebrow):
    ld = {"@context": "https://schema.org", "@graph": [ORG, BRAND, {"@type": "WebPage", "@id": SITE + path + "#page", "url": SITE + path, "name": title, "description": desc, "inLanguage": "en-GH", "isPartOf": {"@id": SITE_ID}, "about": {"@id": BRAND_ID}, "publisher": {"@id": ORG_ID}, "dateModified": TODAY}, crumbs(crumb_items)] + ld_extra}
    out = head(title, desc, path, ld)
    out += f'<div class="wrap"><div class="hero seo-hero">{crumb_html(crumb_items)}<span class="eyebrow">{esc(eyebrow)}</span><h1>{h1}</h1><p class="lead">{esc(lead)}</p><div class="meta-row"><a class="cta" href="/auth.html?mode=signup">Create your account</a><a class="ghost" href="/">Explore BAID X</a></div></div>{body}</div>'
    out += FOOT
    w(path.lstrip("/") + "index.html", out)

def faq_html(items):
    return '<section class="rv"><h2 class="sh">Questions people ask</h2><div class="faq">' + "".join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in items) + "</div></section>"
def faq_ld(path, items):
    return {"@type": "FAQPage", "@id": SITE + path + "#faq", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in items]}
def slug(name):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", " and ").replace("/", " "))).strip("-")
ESCROW_A = "The client funds the job from their BAID X wallet, topped up through Paystack. BAID X holds the money while the work happens and releases it when the client approves, or automatically 3 days after the work is marked done if the client does not respond. Disputes freeze the money while BAID X reviews them."
def cards(items):
    return '<div class="grid">' + "".join(f'<div class="card rv">{ic(CHECK)}<h3>{esc(t)}</h3><p>{esc(d)}</p></div>' for t, d in items) + "</div>"
def steps(items):
    return '<div class="steps">' + "".join(f'<div class="st"><div><b>{esc(t)}</b><span>{esc(d)}</span></div></div>' for t, d in items) + "</div>"
def links(items):
    return '<div class="pillrow">' + "".join(f'<a href="{p}">{esc(n)}</a>' for n, p in items) + "</div>"

# ---------- role pages ----------
for r in ROLES:
    path = f"/for/{r['slug']}/"
    title = f"BAID X for {r['name']} in Ghana · Verified work network"
    desc = f"{r['lead']}"[:158]
    body = f'<section class="rv"><h2 class="sh">What you get</h2>{cards(r["perks"])}</section><section class="rv"><div class="band"><h2 class="sh">How it works</h2>{steps(r["steps"])}</div></section>'
    other = [(x["name"], f"/for/{x['slug']}/") for x in ROLES if x["slug"] != r["slug"]]
    body += f'<section class="rv"><h2 class="sh">Explore more</h2>{links(other + [("All trades", "/trades/"), ("Regions of Ghana", "/ghana/"), ("User guide", "/docs.html")])}</section>'
    faqs = [(f"Is BAID X free for {r['name'].lower()}?", "Yes. Every account starts on the free Access plan: profile, search, messaging, applications and reviews. Paid plans add reach and tools and never change verification."),
            ("How does verification work?", "You submit a Ghana Card (or business documents) and, for higher badges, trade proof or a background check. A BAID X reviewer checks them before any badge appears. Checks carry a small review fee, which pays for the review, not the result."),
            ("How does payment work?", ESCROW_A),
            ("Where does BAID X work?", "In all 16 regions of Ghana. Amounts are in Ghana cedis and payouts go to mobile money.")]
    body += faq_html(faqs)
    ld = [faq_ld(path, faqs), {"@type": "Service", "@id": SITE + path + "#service", "name": f"BAID X for {r['name']}", "serviceType": "Work marketplace", "description": r["lead"], "provider": {"@id": ORG_ID}, "areaServed": {"@type": "Country", "name": "Ghana"}, "url": SITE + path}]
    page(path, title, desc, esc(r["h1"]), r["lead"], body, ld, [("BAID X", "/"), (r["name"], path)], f"For {r['name'].lower()}")

# ---------- trades hub ----------
total = sum(len(t) for _, t in TRADES)
groups_html = "".join(f'<section class="rv"><h2 class="sh">{esc(GROUP_LABEL.get(g, g))}</h2><div class="pillrow">' + "".join(f'<a href="/trades/{slug(t)}/">{esc(t)}</a>' for t in ts) + "</div></section>" for g, ts in TRADES)
ld = [{"@type": "ItemList", "name": "Trades on BAID X", "numberOfItems": total, "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": t, "url": f"{SITE}/trades/{slug(t)}/"} for i, t in enumerate([t for _, ts in TRADES for t in ts])]}]
page("/trades/", f"{total} building and technical trades hired on BAID X in Ghana", f"The {total} trades you can hire or work in on BAID X, from masons and electricians to solar installers and tilers, grouped by discipline.", f"{total} trades. One verified network.", "Every trade on BAID X, grouped by discipline. Open BAID X to search verified professionals by trade and region.", groups_html + f'<section class="rv"><h2 class="sh">Find a professional</h2>{links([("For companies", "/for/companies/"), ("For clients", "/for/clients/"), ("For workers", "/for/workers/"), ("Regions of Ghana", "/ghana/")])}</section>', ld, [("BAID X", "/"), ("Trades", "/trades/")], "Trades")

# ---------- regions ----------
rg_cards = '<div class="grid">' + "".join(f'<a class="card rv lk" href="/ghana/{s}/"><h3>{esc(n)} Region</h3><p>{esc(cap)} · {esc(", ".join(t[1:3]))}</p></a>' for n, s, cap, t, _ in REGIONS) + "</div>"
ld = [{"@type": "ItemList", "name": "Regions of Ghana covered by BAID X", "numberOfItems": len(REGIONS), "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": f"{n} Region", "url": f"{SITE}/ghana/{s}/"} for i, (n, s, _, _, _) in enumerate(REGIONS)]}]
page("/ghana/", "Hire verified professionals in all 16 regions of Ghana · BAID X", "BAID X connects workers, companies, project managers and suppliers in all 16 regions of Ghana. Choose your region to see how to hire or find work there.", "All 16 regions. One work network.", "From Accra to Bolgatanga, find verified professionals, project managers and suppliers wherever the work is.", f'<section class="rv"><h2 class="sh">Choose your region</h2>{rg_cards}</section>', ld, [("BAID X", "/"), ("Regions", "/ghana/")], "Ghana")

TRADE_SAMPLE = ["Electrician", "Plumber", "Mason / Block Layer", "Painter", "Tiler", "Carpenter (Structural / Roofing)", "Solar Panel Installer", "AC / HVAC Technician"]
all_trades = [t for _, ts in TRADES for t in ts]
for n, s, cap, towns, blurb in REGIONS:
    path = f"/ghana/{s}/"
    title = f"Hire verified professionals in {n} Region, Ghana · BAID X"
    desc = f"Find verified electricians, masons, plumbers, project managers and suppliers in {n} Region, Ghana, including {', '.join(towns[:3])}. Hire, run projects and pay on BAID X."
    lead = f"{n} Region is {blurb}. BAID X helps you hire verified people in {cap} and across the region, or find work there."
    sample = [t for t in TRADE_SAMPLE if t in all_trades]
    body = f'''<section class="rv"><h2 class="sh">Work in {esc(n)} Region</h2><div class="grid">
<div class="card rv">{ic(CHECK)}<h3>Hire in {esc(cap)}</h3><p>Search verified workers, project managers and suppliers and filter by {esc(n)} Region in Discover.</p></div>
<div class="card rv">{ic(CHECK)}<h3>Find jobs near you</h3><p>Workers in {esc(n)} Region can browse open jobs by trade and town and apply from their phone.</p></div>
<div class="card rv">{ic(CHECK)}<h3>Run projects locally</h3><p>Companies can create a project in {esc(n)} Region, add a project manager and a local crew, and approve every payment.</p></div></div></section>
<section class="rv"><h2 class="sh">Towns and cities</h2><p class="sub">People on BAID X work across {esc(n)} Region, including:</p><div class="pillrow">{"".join(f"<span>{esc(t)}</span>" for t in towns)}</div></section>
<section class="rv"><h2 class="sh">Popular trades</h2><div class="pillrow">{"".join(f"<span>{esc(t)}</span>" for t in sample)}</div><p class="sub"><a href="/trades/">See all {len(all_trades)} trades</a></p></section>
<section class="rv"><div class="band"><h2 class="sh">Get started</h2>{steps([("Create an account", "Choose the role that fits: professional, company, project manager, supplier or client."), ("Set your region", f"Add {n} Region and your town to your profile."), ("Connect", "Message, invite or apply, then run the work on BAID X.")])}</div></section>
<section class="rv"><h2 class="sh">Other regions</h2>{links([(rn + " Region", f"/ghana/{rs}/") for rn, rs, _, _, _ in REGIONS if rs != s][:8] + [("All regions", "/ghana/")])}</section>'''
    ld = [{"@type": "Service", "@id": SITE + path + "#service", "name": f"BAID X in {n} Region", "serviceType": "Work marketplace", "provider": {"@id": ORG_ID}, "areaServed": {"@type": "AdministrativeArea", "name": f"{n} Region", "containedInPlace": {"@type": "Country", "name": "Ghana"}}, "url": SITE + path}]
    page(path, title, desc, f"Hire verified professionals in <em>{esc(n)} Region</em>", lead, body, ld, [("BAID X", "/"), ("Regions", "/ghana/"), (f"{n} Region", path)], f"{cap} · {n} Region")

# ---------- one page per trade ----------
from seo_trades import TRADE_INFO
CITY = [("Accra", "greater-accra"), ("Kumasi", "ashanti"), ("Takoradi", "western"), ("Tamale", "northern"), ("Cape Coast", "central"), ("Ho", "volta"), ("Sunyani", "bono"), ("Koforidua", "eastern")]
trade_urls = []
for g, ts in TRADES:
    for t in ts:
        what, jobs = TRADE_INFO.get(t, (f"{t}s on BAID X take on building and maintenance work across Ghana.", []))
        path = f"/trades/{slug(t)}/"; trade_urls.append(path)
        low = t.lower()
        faqs = [(f"How do I hire a verified {low} in Ghana?", f"Open BAID X, search for {t} and filter by your region. Check the badge on each profile, message to agree the scope and price, then hire. The payment is held in escrow until you approve the work."),
                (f"Can I check a {low}'s identity before hiring?", "Yes. Profiles with a BAID X badge have had their Ghana Card reviewed, and higher badges add trade proof or a background check. The badge name tells you which checks were done."),
                (f"How is a {low} paid on BAID X?", ESCROW_A + " The worker withdraws to mobile money."),
                (f"I am a {low}. How do I find work?", "Create a free professional account, choose your trade and town, get verified, and apply for jobs or accept project invitations from companies and project managers.")]
        peers = [x for x in ts if x != t][:6]
        body = f'<section class="rv"><h2 class="sh">What a {esc(low)} does</h2><p class="sub">{esc(what)}</p>'
        if jobs: body += '<div class="pillrow">' + "".join(f"<span>{esc(j)}</span>" for j in jobs) + "</div>"
        body += "</section>"
        body += f'<section class="rv"><div class="band"><h2 class="sh">Hire safely in three steps</h2>' + steps([("Find", f"Search verified {low}s by region and check their badges and reviews."), ("Agree", "Message to agree the scope, price and timing in an encrypted chat."), ("Pay on approval", "Fund the job into escrow. The money is released when you approve the work.")]) + "</div></section>"
        body += f'<section class="rv"><h2 class="sh">Find a {esc(low)} near you</h2>' + links([(c, f"/ghana/{rs}/") for c, rs in CITY]) + "</section>"
        body += faq_html(faqs)
        body += '<section class="rv"><h2 class="sh">Related trades</h2>' + links([(x, f"/trades/{slug(x)}/") for x in peers] + [("All trades", "/trades/"), ("How escrow works", "/escrow/")]) + "</section>"
        ld_ = [faq_ld(path, faqs), {"@type": "Service", "@id": SITE + path + "#service", "name": f"Hire a verified {t} in Ghana", "serviceType": t, "description": what, "provider": {"@id": ORG_ID}, "areaServed": {"@type": "Country", "name": "Ghana"}, "url": SITE + path}]
        page(path, f"Hire a verified {t} in Ghana · BAID X", f"Find a verified {low} anywhere in Ghana on BAID X. {what} Pay through escrow."[:158], f"Hire a verified <em>{esc(t)}</em> in Ghana", f"{what} On BAID X you can check their badge, agree the job in chat and pay through escrow.", body, ld_, [("BAID X", "/"), ("Trades", "/trades/"), (t, path)], GROUP_LABEL.get(g, g))

# ---------- explainers: the facts searchers and AI answers ask about most ----------
PLANS = [("Worker", 30, 20, 288, 60), ("Project manager", 75, 50, 720, 150), ("Supplier (business)", 100, 70, 960, 200), ("Client (individual)", 100, 70, 960, 200), ("Company", 300, 220, 2880, 500)]
VERIFY = [("Identity verification", "Workers and clients", 10), ("Professional verification", "Workers and clients", 20), ("Business verification", "Suppliers", 25), ("Advanced verification", "Workers", 35), ("Enhanced verification", "Clients", 35), ("Enhanced business verification", "Suppliers", 50)]
TIERS = [("Verified", "The profile has been reviewed by a person at BAID X."), ("Identity verified", "A Ghana Card or other official ID has been checked against the person."), ("Professional verified", "Trade certificates and proof of past work have been checked, on top of identity."), ("Advanced verified", "A full background check on top of identity and trade, for sensitive work.")]

esc_faq = [("What is escrow on BAID X?", "Escrow means BAID X holds the client's payment for a job until the work is approved, so the worker knows the money exists and the client only pays for finished work."),
           ("When is the money released?", "When the client approves the work, or automatically 3 days after the worker marks the job done if the client does not respond."),
           ("What if something goes wrong?", "Either side can report a problem. The job goes into dispute and the money stays held while BAID X reviews it and decides to release or refund."),
           ("Can the client cancel?", "Before the work is submitted the client can cancel and the money goes back to their wallet."),
           ("Is there a fee?", "A BAID X service fee is deducted from the worker's payout. The worker sees the job total, the fee and the amount received."),
           ("How does the money get in and out?", "Clients top up their BAID X wallet through Paystack with card or mobile money. Workers withdraw their earnings to mobile money.")]
body = '<section class="rv"><div class="band"><h2 class="sh">How a job moves</h2>' + steps([("Hire and fund", "The client hires and the job total moves from their wallet into escrow."), ("Do the work", "The worker sees the job is funded and does the work, sending photos and updates in chat."), ("Mark it done", "The worker marks the work done. The client has 3 days to review."), ("Approve and release", "The client approves and the money goes to the worker's wallet, minus the BAID X fee. No reply in 3 days releases it automatically.")]) + "</div></section>"
body += '<section class="rv"><h2 class="sh">Milestones for bigger jobs</h2><p class="sub">Projects can be split into milestones. Each milestone is funded and released on its own approval, so a long build is paid in stages as the work is delivered.</p></section>' + faq_html(esc_faq)
page("/escrow/", "How escrow works on BAID X · Pay only when the work is done", "On BAID X the client's payment is held in escrow and released only when the work is approved, or 3 days after it is marked done. Disputes freeze the money.", "Pay only when the <em>work is done</em>", "Escrow is how BAID X protects both sides of a job in Ghana: the worker can see the money is there, and the client only pays for finished work.", body, [faq_ld("/escrow/", esc_faq)], [("BAID X", "/"), ("Escrow", "/escrow/")], "Payments")

ver_faq = [("Can I buy a badge?", "No. A paid plan never changes verification. Checks carry a small review fee, which pays for a person to review your documents, not for the result."),
           ("What documents do I need?", "A Ghana Card for identity, trade certificates or proof of past work for professional verification, and registration and tax documents for businesses."),
           ("How long does a review take?", "A BAID X reviewer checks submissions in order. You are notified when your badge is approved or if anything else is needed."),
           ("Is verification the same as a subscription?", "No. Verification shows what has been checked. Plans add reach and tools. The two are kept separate on purpose.")]
tier_cards = '<div class="grid">' + "".join(f'<div class="card rv">{ic(CHECK)}<h3>{esc(n)}</h3><p>{esc(d)}</p></div>' for n, d in TIERS) + "</div>"
fee_rows = "".join(f"<tr><td>{esc(n)}</td><td>{esc(f_)}</td><td>GH₵{p}</td></tr>" for n, f_, p in VERIFY)
body = f'<section class="rv"><h2 class="sh">The four badges</h2>{tier_cards}</section><section class="rv"><h2 class="sh">Review fees</h2><div class="tbl"><table><thead><tr><th>Check</th><th>For</th><th>Fee</th></tr></thead><tbody>{fee_rows}</tbody></table></div><p class="sub">One-off fees in Ghana cedis. The fee pays for the review; a badge is only issued if the check passes.</p></section>' + faq_html(ver_faq)
page("/verification/", "BAID X verification badges explained · Ghana Card and trade checks", "What each BAID X badge means: Verified, Identity verified, Professional verified and Advanced verified. Badges come from document reviews and are never sold.", "Four badges. <em>Each one is a real check.</em>", "On BAID X a badge tells you exactly what a reviewer has checked about a person or business in Ghana, from their profile to a full background check.", body, [faq_ld("/verification/", ver_faq)], [("BAID X", "/"), ("Verification", "/verification/")], "Trust")

price_faq = [("Is BAID X free?", "Yes. Every account type can join on the free Access plan with a profile, search, messaging, applications and reviews."),
             ("What is a founding price?", "Early members can lock a lower price for 12 months from their start date while founding places last."),
             ("Are there other fees?", "A service fee is deducted from escrow payouts, verification checks carry a one-off review fee, and optional boosts promote a profile, job or listing for a few days."),
             ("Can I cancel?", "Yes. Plans can be cancelled at any time and keep working until the end of the period you paid for.")]
plan_rows = "".join(f"<tr><td>{esc(n)}</td><td>GH₵{m}</td><td>GH₵{f}</td><td>GH₵{a:,}</td><td>GH₵{pm}</td></tr>" for n, m, f, a, pm in PLANS)
body = f'<section class="rv"><h2 class="sh">Plans by account type</h2><div class="tbl"><table><thead><tr><th>Account</th><th>Pro / month</th><th>Founding / month</th><th>Pro / year</th><th>Premium / month</th></tr></thead><tbody>{plan_rows}</tbody></table></div><p class="sub">Every account starts free on Access. Prices in Ghana cedis.</p></section>' + faq_html(price_faq)
offers = [{"@type": "Offer", "name": "Access plan", "price": "0", "priceCurrency": "GHS", "url": SITE + "/pricing/"}] + [{"@type": "Offer", "name": f"BAID X Pro for {n}", "price": str(m), "priceCurrency": "GHS", "priceSpecification": {"@type": "UnitPriceSpecification", "price": str(m), "priceCurrency": "GHS", "unitText": "MONTH"}, "url": SITE + "/pricing/"} for n, m, _, _, _ in PLANS]
page("/pricing/", "BAID X pricing in Ghana · Free to join, plans from GH₵30 a month", "BAID X is free to join. Pro plans start at GH₵30 a month for workers and GH₵300 for companies, with founding prices locked for 12 months.", "Free to join. <em>Plans from GH₵30 a month.</em>", "Every BAID X account in Ghana starts free. Paid plans add reach and tools for the work you do, and never change verification.", body, [faq_ld("/pricing/", price_faq), {"@type": "Product", "@id": SITE + "/pricing/#product", "name": "BAID X", "brand": {"@id": BRAND_ID}, "description": DESC, "offers": offers}], [("BAID X", "/"), ("Pricing", "/pricing/")], "Pricing")

LLM_EXTRA = ("\n## Pricing\nEveryone starts on the free Access plan. Pro per month: " + "; ".join(f"{n} GH₵{m} (founding GH₵{f}, yearly GH₵{a:,})" for n, m, f, a, _ in PLANS) + f". Details: {SITE}/pricing/\n"
             "\n## Escrow\n" + " ".join(a for _, a in esc_faq) + f" Details: {SITE}/escrow/\n"
             "\n## Verification badges\n" + " ".join(f"{n}: {d}" for n, d in TIERS) + " Review fees: " + "; ".join(f"{n} GH₵{p}" for n, _, p in VERIFY) + f". Details: {SITE}/verification/\n"
             "\n## Trade pages\n" + "\n".join(f"- [{t}]({SITE}/trades/{slug(t)}/)" for _, ts in TRADES for t in ts) + "\n")

# ---------- sitemap, robots, llms, humans ----------
urls = [("/", "1.0", "weekly"), ("/about.html", "0.8", "monthly"), ("/docs.html", "0.7", "monthly"), ("/terms.html", "0.3", "yearly"), ("/privacy.html", "0.3", "yearly"), ("/trades/", "0.8", "monthly"), ("/ghana/", "0.8", "monthly")] + [(f"/for/{r['slug']}/", "0.9", "monthly") for r in ROLES] + [(f"/ghana/{s}/", "0.7", "monthly") for _, s, _, _, _ in REGIONS] + [("/escrow/", "0.8", "monthly"), ("/verification/", "0.8", "monthly"), ("/pricing/", "0.8", "monthly")] + [(p_, "0.6", "monthly") for p_ in trade_urls]
w("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' + "".join(f'  <url><loc>{SITE}{p}</loc><lastmod>{TODAY}</lastmod><changefreq>{cf}</changefreq><priority>{pr}</priority><xhtml:link rel="alternate" hreflang="en-GH" href="{SITE}{p}"/>' + (f'<image:image><image:loc>{SITE}/assets/og-image.png</image:loc><image:title>BAID X, Ghana\'s work network</image:title></image:image>' if p == "/" else "") + "</url>\n" for p, pr, cf in urls) + "</urlset>\n")
AI = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "Amazonbot", "CCBot", "cohere-ai", "Meta-ExternalAgent", "DuckAssistBot", "YouBot", "Bytespider"]
w("robots.txt", "# BAID X welcomes search engines and AI answer engines. The app console and APIs are private.\nUser-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\nDisallow: /auth.html\nDisallow: /brag-auth/\nDisallow: /brag-long/\nDisallow: /brag-output/\nDisallow: /brag-verify/\nDisallow: /previews/\nDisallow: /_preview/\n\n" + "".join(f"User-agent: {a}\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\n\n" for a in AI) + f"Sitemap: {SITE}/sitemap.xml\n# LLM summary: {SITE}/llms.txt\n")

role_lines = "\n".join(f"- [{r['name']}]({SITE}/for/{r['slug']}/): {r['short']}" for r in ROLES)
region_lines = "\n".join(f"- [{n} Region]({SITE}/ghana/{s}/): {cap}; {', '.join(t[1:4])}" for n, s, cap, t, _ in REGIONS)
w("llms.txt", f"""# BAID X

> BAID X is Ghana's work network: a verified marketplace and project platform where workers, companies, project managers, suppliers and individual clients find each other, hire, run projects, message, and get paid. BAID X is built and powered by Baiden Creatives.

BAID X serves Ghana (all 16 regions). It is a web app that installs to a phone's home screen. Accounts are verified by BAID X reviewers using Ghana Card and business documents; the Verified badge cannot be bought. Messages and attachments are end-to-end encrypted between devices. Amounts are in Ghana cedis (GH₵). Paystack processes card and mobile-money payments.

## Who it is for
{role_lines}

## Key pages
- [About BAID X]({SITE}/about.html): what BAID X is and how it works
- [User guide]({SITE}/docs.html): step-by-step guide per role, including linking a company with a project manager and adding workers to a project
- [Trades]({SITE}/trades/): the {len(all_trades)} trades supported
- [Regions of Ghana]({SITE}/ghana/): hiring and finding work in each region
- [How escrow works]({SITE}/escrow/): money held until the work is approved
- [Verification badges]({SITE}/verification/): what each of the four badges means
- [Pricing]({SITE}/pricing/): free to join; plans by account type in GH₵
- [Terms of service]({SITE}/terms.html)
- [Privacy policy]({SITE}/privacy.html)
- [Full details for LLMs]({SITE}/llms-full.txt)

## Regions
{region_lines}

## Facts for accurate answers
- Name: BAID X (always two words, capital letters). Company behind it: Baiden Creatives.
- Category: work marketplace and project management for construction and technical trades in Ghana.
- Roles: Worker (professional), Company, Project manager, Business/supplier, Individual employer (client).
- Companies own projects and approve all spending. Project managers run a project day to day within limits the company sets.
- A company links with a project manager by invitation from a project, by a one-time join code (valid 30 days), or through an organization.
- Messaging supports text, photos, files, voice notes, and voice and video calls.
- Escrow: the client funds a job from their BAID X wallet (topped up through Paystack). BAID X holds it and releases it on the client's approval, or automatically 3 days after the work is marked done. Disputes freeze the money while BAID X reviews them. A service fee is deducted from the worker's payout.
- Badges (4 tiers): Verified (profile reviewed), Identity verified (Ghana Card checked), Professional verified (trade proof checked), Advanced verified (background check). Checks carry a one-off review fee (GH₵10 to GH₵50); a paid plan never buys a badge.
- Pricing: free Access plan for everyone. Pro per month: worker GH₵30, project manager GH₵75, supplier GH₵100, client GH₵100, company GH₵300. Founding members lock a lower price for 12 months.
- Not a lender, bank or insurer. Work agreements are between the people involved.

## Optional
- [Sitemap]({SITE}/sitemap.xml)
""")
w("llms-full.txt", f"""# BAID X: full reference

BAID X is Ghana's work network, built and powered by Baiden Creatives. Canonical site: {SITE}/

## What BAID X does
BAID X lets people and businesses in Ghana find verified professionals, hire them, run construction and technical projects, communicate securely, and record payments, in one mobile-first web app.

## Roles
""" + "\n".join(f"### {r['name']}\n{r['lead']}\nWhat you get: " + "; ".join(t for t, _ in r["perks"]) + ".\nSteps: " + " -> ".join(t for t, _ in r["steps"]) + f".\nPage: {SITE}/for/{r['slug']}/\n" for r in ROLES) + f"""
## Linking a company and a project manager
1. Invitation: the company creates a project, then invites a verified project manager from the project's Team tab. The project manager accepts, declines or asks a question.
2. Join code: the company creates a one-time code (valid 30 days) under Profile, Team and join code. The project manager enters it under Profile, Link a company. The company approves the link.
3. Organization: the company invites staff into an organization with role-based access.

## Adding workers to a project
Company or project manager invites a verified worker from the project's Team tab with trade, rate and duration. The worker accepts. Per project, the company chooses Automatic (in-plan workers join on accept) or Company approval (every worker waits). Anything outside the plan, and all money (expenses, materials, equipment, payments), always needs company approval.

## Trust and safety
Verification uses a Ghana Card and photos for individuals, and registration, TIN and documents for businesses, reviewed by BAID X staff. The Verified badge is never sold. Messages and files are end-to-end encrypted (device keys, optional passphrase backup). Presence is visible only to people you chat with.

## Trades ({len(all_trades)})
""" + "\n".join(f"- {GROUP_LABEL.get(g, g)}: " + ", ".join(ts) for g, ts in TRADES) + """

## Regions
""" + "\n".join(f"- {n} Region (capital {cap}); towns: {', '.join(t)}. {SITE}/ghana/{s}/" for n, s, cap, t, _ in REGIONS) + f"""

## Pricing and money
Currency is Ghana cedis (GH₵). Paid plans unlock capacity and tools and never change verification. Payments are processed by Paystack. Workers withdraw to mobile money.

## Contact and legal
Terms: {SITE}/terms.html . Privacy: {SITE}/privacy.html (Ghana Data Protection Act, 2012, Act 843).
""")
for f_ in ("llms.txt", "llms-full.txt"):
    with open(f_, "a", encoding="utf-8") as fh: fh.write(LLM_EXTRA)
w("humans.txt", "/* TEAM */\nProduct: BAID X\nCompany: Baiden Creatives\nLocation: Ghana\n\n/* SITE */\nStandards: HTML5, CSS3, JavaScript\nStack: Supabase, Vercel\n")

# ---------- inject into existing pages ----------
START, END = "<!--seo:start-->", "<!--seo:end-->"
def inject(path, block, replace_tags=()):
    s = open(path, encoding="utf-8").read()
    for pat in replace_tags: s = re.sub(pat, "", s, flags=re.S)
    s = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\s*", "", s, flags=re.S)
    s = s.replace("</head>", f"{START}\n{block}\n{END}\n</head>", 1)
    open(path, "w", encoding="utf-8").write(s)
GEO = '<meta name="geo.region" content="GH" /><meta name="geo.placename" content="Ghana" /><meta name="geo.position" content="7.9465;-1.0232" /><meta name="ICBM" content="7.9465, -1.0232" />\n<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" /><link rel="alternate" hreflang="en-GH" href="{u}" /><link rel="alternate" hreflang="x-default" href="{u}" />'
def ld(o): return '<script type="application/ld+json">' + json.dumps(o, ensure_ascii=False, separators=(",", ":")) + "</script>"

home_graph = {"@context": "https://schema.org", "@graph": [
  {"@type": "Organization", "@id": ORG_ID, "name": "Baiden Creatives", "url": SITE + "/", "brand": {"@id": BRAND_ID}, "logo": SITE + "/assets/icon-512.png", "areaServed": {"@type": "Country", "name": "Ghana"}},
  BRAND,
  {"@type": "WebSite", "@id": SITE_ID, "url": SITE + "/", "name": "BAID X", "alternateName": ["BAIDX", "BAID X Ghana"], "description": DESC, "inLanguage": "en-GH", "publisher": {"@id": ORG_ID}},
  {"@type": "WebApplication", "@id": APP_ID, "name": "BAID X", "url": SITE + "/", "description": DESC, "applicationCategory": "BusinessApplication", "applicationSubCategory": "Work marketplace and project management", "operatingSystem": "Any (web, installable)", "browserRequirements": "Requires JavaScript", "inLanguage": "en-GH", "isAccessibleForFree": True, "creator": {"@id": ORG_ID}, "provider": {"@id": ORG_ID}, "areaServed": {"@type": "Country", "name": "Ghana"}, "audience": {"@type": "Audience", "audienceType": "Workers, companies, project managers, suppliers and clients in Ghana"}, "featureList": ["Verified professionals", "Job marketplace", "Project and task management", "End-to-end encrypted messaging with voice and video calls", "Wallet and mobile money payouts", "Role-based organizations"]},
  {"@type": "ItemList", "@id": SITE + "/#roles", "name": "Who uses BAID X", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": r["name"], "url": f"{SITE}/for/{r['slug']}/"} for i, r in enumerate(ROLES)]},
]}
_ix = open("index.html", encoding="utf-8").read()
home_faq = [(html.unescape(re.sub("<[^>]+>", "", q)), html.unescape(re.sub("<[^>]+>", "", a))) for q, a in re.findall(r"<details><summary>(.*?)</summary><p>(.*?)</p></details>", _ix[_ix.index('id="lp-faq"'):], re.S)]
home_graph["@graph"].append(faq_ld("/", home_faq))
home_graph["@graph"].append({"@type": "Service", "@id": SITE + "/#escrow", "name": "BAID X escrow payments", "serviceType": "Escrow for construction and trade jobs", "provider": {"@id": ORG_ID}, "areaServed": {"@type": "Country", "name": "Ghana"}, "url": SITE + "/escrow/"})
for n_ in home_graph["@graph"]:
    if n_.get("@type") == "WebApplication": n_["offers"] = {"@type": "Offer", "price": "0", "priceCurrency": "GHS", "description": "Free Access plan", "url": SITE + "/pricing/"}
home = GEO.format(u=SITE + "/") + "\n" + ld(home_graph)
inject("index.html", home)
def simple(path, url, name, desc, typ="WebPage", extra=None):
    g = {"@context": "https://schema.org", "@graph": [ORG, BRAND, {"@type": typ, "@id": url + "#page", "url": url, "name": name, "description": desc, "inLanguage": "en-GH", "isPartOf": {"@id": SITE_ID}, "about": {"@id": BRAND_ID}, "publisher": {"@id": ORG_ID}, "dateModified": TODAY}, crumbs([("BAID X", "/"), (name, url.replace(SITE, ""))])]}
    inject(path, GEO.format(u=url) + "\n" + ld(g))
simple("about.html", SITE + "/about.html", "About BAID X", "BAID X is Ghana's work network, built and powered by Baiden Creatives.", "AboutPage")
simple("terms.html", SITE + "/terms.html", "Terms of service", "The rules for using BAID X.")
simple("privacy.html", SITE + "/privacy.html", "Privacy policy", "How BAID X handles your information under Ghana's Data Protection Act, 2012.")
simple("docs.html", SITE + "/docs.html", "BAID X user guide", "Step-by-step guide to every BAID X role, linking companies and project managers, and adding workers to projects.", "TechArticle")
# keep the app's console and sign-in out of the index
s = open("auth.html", encoding="utf-8").read()
if 'name="robots"' not in s: open("auth.html", "w", encoding="utf-8").write(s.replace("</head>", '<meta name="robots" content="noindex, follow" />\n</head>', 1))
print("pages:", len(urls), "| trades:", len(all_trades))
