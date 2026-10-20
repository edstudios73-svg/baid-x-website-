/* BAID Bot: the assistant on the landing (floating button, visitors) and on every signed-in
   screen (the button beside the bell, [data-bot]); same as the app. Questions go to the
   Supabase function "baid-bot", which answers with Claude and BAID X's facts and finds real
   people, open jobs, equipment and materials. The answer is one short line; the matches come
   back as cards and are drawn here with the site's own cards: the Discover member card
   (APP.cardHTML, from the member's live row), the Find work job card and the marketplace
   listing card, in a row you swipe. The conversation stays in this tab only
   (sessionStorage). Text is always escaped; only the chat text and the member's account
   type are sent, never the cards. */
(() => {
  const URL_BOT = "https://igfmmprlrybxsdzehwid.supabase.co/functions/v1/baid-bot";
  const KEY = "baidx_bot";
  const GREETING = "Good to see you. Tell me who or what you need, a trade, a town, a budget, and I'll bring you the best verified matches on BAID X.";
  const SUGGEST = {
    visitor: ["Find me a top electrician in Accra", "I need an experienced mason", "Rent an excavator in Accra", "How does escrow protect me?"],
    worker: ["Any jobs for me in Greater Accra?", "Find electrical jobs near me", "How do I get verified?", "How do I get paid?"],
    company: ["Find a project manager in Accra", "Top verified masons", "Rent an excavator", "Suppliers of cement blocks"],
    "project-manager": ["Find verified electricians", "Masons in Accra", "Rent a concrete mixer", "Cement suppliers"],
    business: ["Show me open jobs", "Companies in Accra", "How do boosts work?", "How do I get verified?"],
    "individual-employer": ["Find a plumber near me", "Top verified electricians", "Find a painter in Accra", "How does escrow protect me?"],
  };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // cards are kept with the conversation; the drawn HTML is rebuilt from live rows on each visit
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const save = (m) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-20).map(({ rich, ...x }) => x))); } catch { /* private mode */ } };
  const role = () => window.APP?.state?.me?.role || null;

  const ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z"/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>';
  const root = document.createElement("div");
  root.className = "bb";
  root.innerHTML = `
    <button class="bb-fab" type="button" aria-label="Ask BAID Bot" aria-expanded="false" aria-controls="bbPanel">${ICON}<i class="bb-ping" aria-hidden="true"></i></button>
    <span class="bb-hint" aria-hidden="true">Ask BAID Bot</span>
    <section class="bb-panel" id="bbPanel" role="dialog" aria-label="BAID Bot" hidden>
      <header class="bb-head">
        <span class="bb-av">${ICON}</span>
        <div><b>BAID Bot</b><small><i></i>People, jobs and equipment</small></div>
        <button class="bb-new" type="button" aria-label="New conversation" title="New conversation">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>
        </button>
        <button class="bb-x" type="button" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="bb-log" aria-live="polite"></div>
      <div class="bb-sugs"></div>
      <form class="bb-form" autocomplete="off">
        <input class="bb-in" maxlength="600" placeholder="Who or what do you need?" aria-label="Your question" />
        <button class="bb-send" type="submit" aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </form>
      <p class="bb-fine">Matches come from live profiles. Never share passwords or SMS codes.</p>
    </section>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const fab = $(".bb-fab"), panel = $(".bb-panel"), log = $(".bb-log"), sugs = $(".bb-sugs"), form = $(".bb-form"), input = $(".bb-in");
  let messages = load(), busy = false;

  /* ---------- the cards ---------- */
  const SRC = { worker: "professionals", pm: "managers", company: "companies", supplier: "businesses" };
  const KIND = { worker: "worker", pm: "pm", company: "company", supplier: "business" };
  const NOUN = { worker: ["professional", "professionals"], pm: ["project manager", "project managers"], company: ["company", "companies"], supplier: ["supplier", "suppliers"],
    job: ["open job", "open jobs"], equipment: ["equipment listing", "equipment listings"], material: ["material listing", "material listings"] };
  const money = (v) => (window.BX?.money ? window.BX.money(v) : `GH₵${Math.round(Number(v)).toLocaleString("en-GH")}`);
  const icon = (k, s) => window.BX?.icon?.(k, s) || "";
  const ago = (t) => window.BX?.ago?.(t) || "";

  // the Find work job card (js/dash.js jobList)
  function jobCard(j) {
    const r = role(), act = r === "worker" ? `<button class="btn-light sm" data-bb-go="jobs">View and apply</button>` : r ? "" : `<button class="btn-light sm" data-bb-join>Join to apply</button>`;
    return `<div class="job"><div class="job-top"><div class="jt">${j.featured ? '<span class="job-boost">Featured</span>' : ""}${j.trade ? `<span class="tr">${esc(j.trade)}</span>` : ""}<b>${esc(j.title)}</b></div><span class="rate">${Number(j.rate) ? `${money(j.rate)}<small>per day</small>` : "<small>Rate on request</small>"}</span></div>
      ${j.about ? `<p>${esc(j.about)}</p>` : ""}
      <div class="job-info"><span class="pl">${icon("site", 14)}<i>${esc([j.town, j.region].filter(Boolean).join(", ") || "Ghana")}</i></span><span>${icon("team", 14)} ${esc(j.workers_needed || 1)} needed</span>${j.created_at ? `<span>${icon("cal", 14)} ${esc(ago(j.created_at))}</span>` : ""}</div>
      ${act ? `<div class="job-act">${act}</div>` : ""}</div>`;
  }
  // the marketplace listing card (js/catalog.js cards)
  function listingCard(i) {
    const eq = i.kind === "equipment", img = (i.images || [])[0], n = (i.images || []).length;
    const [p, per] = eq ? (Number(i.daily_rate) > 0 ? [money(i.daily_rate), "/day"] : Number(i.sale_price) > 0 ? [money(i.sale_price), ""] : ["Ask for price", ""]) : (Number(i.price) > 0 ? [money(i.price), ""] : ["Ask for price", ""]);
    return `<button type="button" class="mk-card" data-bb-listing="${eq ? "equipment" : "materials"}">
      <span class="mk-img" ${img ? `style="background-image:url('${esc(String(img).replace(/'/g, "%27"))}')"` : ""}>${img ? "" : `<i class="mk-ph">${icon(eq ? "equip" : "mat", 34)}</i>`}
        ${n > 1 ? `<em class="mk-n">${icon("img", 12)} ${n}</em>` : ""}${i.verified ? `<em class="mk-v">${icon("task", 12)} Verified</em>` : ""}</span>
      <span class="mk-body"><b class="mk-name">${esc(i.name)}</b><span class="mk-price">${esc(p)}<small>${per}</small></span><small class="mk-by">${esc(i.business)}${i.town || i.region ? ` · ${esc(i.town || i.region)}` : ""}</small></span></button>`;
  }
  // a placeholder in the Discover card's shape while the member's live row loads
  const ghost = () => '<div class="bb-ghost" aria-hidden="true"><i></i><b></b><s></s><s></s></div>';

  // Members are drawn from their live Discover row, exactly as Discover shows them.
  async function hydrate(m) {
    if (m.rich || m.hydrating) return;
    const people = (m.cards || []).filter((c) => SRC[c.kind]);
    if (!people.length || !window.APP?.cardHTML || !window.BX?.sb) return;
    m.hydrating = true;
    try {
      const rows = {};
      await Promise.all(Object.keys(SRC).map(async (k) => {
        const ids = people.filter((c) => c.kind === k).map((c) => c.id); if (!ids.length) return;
        const S = window.APP.sources[SRC[k]];
        const { data } = await window.BX.sb.from(S.table).select(`${S.cols},created_at`).in("id", ids);
        (data || []).forEach((r) => { rows[r.id] = { r, S }; });
      }));
      m.rich = people.map((c) => {
        const x = rows[c.id]; if (!x) return null;
        const it = { ...x.S.map(x.r), joined: Date.parse(x.r.created_at) || Infinity, plan: c.plan || null, boosted: !!c.featured };
        return window.APP.cardHTML(it);
      }).filter(Boolean);
    } catch (e) { console.error("bot cards", e); m.rich = []; }
    m.hydrating = false;
    paint();
  }

  function results(m) {
    const cards = m.cards || []; if (!cards.length) return "";
    const kind = cards[0].kind, people = !!SRC[kind];
    if (people) hydrate(m);
    const html = people ? (m.rich ? (m.rich.length ? m.rich : null) : cards.map(ghost)) : cards.map((c) => (c.kind === "job" ? jobCard(c) : listingCard(c)));
    if (!html) return "";
    const noun = NOUN[kind] || ["match", "matches"], place = cards[0].town || cards[0].region;
    const verified = cards.filter((c) => c.verified).length;
    const label = `${cards.length} ${cards.length === 1 ? noun[0] : noun[1]}${people && verified ? ` · ${verified} verified` : ""}${place && cards.every((c) => (c.town || c.region) === place) ? ` · ${esc(place)}` : ""}`;
    return `<div class="bb-res bb-${people ? "people" : kind}"><div class="bb-res-h"><span>${label}</span>${html.length > 1 ? "<small>Swipe for more</small>" : ""}</div>
      <div class="bb-rail" tabindex="0" aria-label="Matches">${html.map((h, i) => `<div class="bb-slot" style="--d:${i * 80}ms">${h}</div>`).join("")}</div></div>`;
  }

  const bubble = (r, text) => `<div class="bb-msg ${r === "user" ? "me" : "bot"}">${esc(text).replace(/\n/g, "<br>")}</div>`;
  function paint() {
    const keep = log.scrollTop, atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = bubble("assistant", GREETING) + messages.map((m) => bubble(m.role, m.content) + (m.role === "assistant" ? results(m) : "")).join("")
      + (busy ? '<div class="bb-msg bot typing" aria-label="BAID Bot is searching"><i></i><i></i><i></i><span>Searching live profiles</span></div>' : "");
    sugs.hidden = messages.length > 0;
    log.scrollTop = atEnd || busy ? log.scrollHeight : keep;
  }
  function paintSugs() { sugs.innerHTML = (SUGGEST[role() || "visitor"] || SUGGEST.visitor).map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join(""); }

  async function ask(q) {
    q = q.trim().slice(0, 600);
    if (!q || busy) return;
    messages.push({ role: "user", content: q });
    busy = true; paint(); save(messages);
    let reply, cards = [];
    try {
      const r = await fetch(URL_BOT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewer: role() || undefined, messages: messages.slice(-8).map(({ role: who, content }) => ({ role: who, content })) }) });
      const data = await r.json().catch(() => ({}));
      reply = data.reply || "Sorry, I couldn't answer that right now. Please try again.";
      cards = Array.isArray(data.cards) ? data.cards.slice(0, 8) : [];
    } catch {
      reply = "I couldn't reach BAID X just now. Check your connection and try again.";
    }
    messages.push({ role: "assistant", content: reply, cards });
    busy = false; paint(); save(messages);
    // bring the answer and its first card into view
    const last = log.querySelectorAll(".bb-msg.bot"); last[last.length - 1]?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function open(on) {
    panel.hidden = !on;
    root.classList.toggle("open", on);
    fab.setAttribute("aria-expanded", String(on));
    if (on) { paintSugs(); paint(); setTimeout(() => input.focus(), 50); }
  }
  fab.addEventListener("click", () => open(panel.hidden));
  document.addEventListener("click", (e) => { if (e.target.closest("[data-bot]")) open(panel.hidden); });
  // the bar on each Home: the field opens BAID Bot, a question asks it straight away
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-bot-q]"); if (!b) return; open(true); if (b.dataset.botQ) ask(b.dataset.botQ); });
  $(".bb-x").addEventListener("click", () => { open(false); fab.focus(); });
  $(".bb-new").addEventListener("click", () => { messages = []; save(messages); paint(); input.focus(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { open(false); fab.focus(); } });
  sugs.addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) ask(b.dataset.q); });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; ask(q); });
  // A member card opens the profile through Discover's own handler (js/app.js); a job opens Find
  // work and a listing the marketplace for members, and sign-up for visitors.
  log.addEventListener("click", (e) => {
    if (e.target.closest(".card")) { open(false); return; }
    const go = e.target.closest("[data-bb-go]"), lst = e.target.closest("[data-bb-listing]");
    if (e.target.closest("[data-bb-join]") || ((go || lst) && !role())) { location.href = "auth.html?mode=signup"; return; }
    if (go) { open(false); window.APP?.go(go.dataset.bbGo); }
    if (lst) { open(false); window.APP?.go(lst.dataset.bbListing); }
  });

  // a short "Ask BAID Bot" hint beside the button, once per visit
  try {
    if (!sessionStorage.getItem("baidx_bot_hint")) {
      setTimeout(() => root.classList.add("hint"), 2200);
      setTimeout(() => root.classList.remove("hint"), 8000);
      sessionStorage.setItem("baidx_bot_hint", "1");
    }
  } catch { /* private mode: no hint */ }
})();
