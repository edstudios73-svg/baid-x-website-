/* BAID Bot: a floating assistant on the landing for visitors (same as the app's visitor
   Home). Questions go to the Supabase function "baid-bot", which answers with Claude and
   BAID X's facts and finds real people and open jobs ("a top electrician in Kumasi"): its
   picks come back as cards under the answer. The conversation stays in this tab only
   (sessionStorage). Text is always escaped; only the chat text is sent, never the cards. */
(() => {
  const URL_BOT = "https://igfmmprlrybxsdzehwid.supabase.co/functions/v1/baid-bot";
  const KEY = "baidx_bot";
  const GREETING = "Hi, I'm BAID Bot. Tell me who you need and I'll find the best verified match, or ask me anything about BAID X.";
  const SUGGEST = ["Find me a top electrician in Accra", "I need a mason with experience", "Any jobs for me in Greater Accra?", "How does escrow protect me?"];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const save = (m) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-20))); } catch { /* private mode */ } };

  const ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9z"/><path d="M9 10h.01M15 10h.01"/><path d="M9.5 13c1.4 1 3.6 1 5 0"/></svg>';
  const root = document.createElement("div");
  root.className = "bb";
  root.innerHTML = `
    <button class="bb-fab" type="button" aria-label="Ask BAID Bot" aria-expanded="false" aria-controls="bbPanel">${ICON}<i class="bb-ping" aria-hidden="true"></i></button>
    <span class="bb-hint" aria-hidden="true">Ask BAID Bot</span>
    <section class="bb-panel" id="bbPanel" role="dialog" aria-label="BAID Bot" hidden>
      <header class="bb-head">
        <span class="bb-av">${ICON}</span>
        <div><b>BAID Bot</b><small><i></i>Finds verified people and jobs</small></div>
        <button class="bb-x" type="button" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="bb-log" aria-live="polite"></div>
      <div class="bb-sugs"></div>
      <form class="bb-form" autocomplete="off">
        <input class="bb-in" maxlength="600" placeholder="Who do you need?" aria-label="Your question" />
        <button class="bb-send" type="submit" aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </form>
      <p class="bb-fine">BAID Bot can be wrong. Never share passwords or SMS codes.</p>
    </section>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const fab = $(".bb-fab"), panel = $(".bb-panel"), log = $(".bb-log"), sugs = $(".bb-sugs"), form = $(".bb-form"), input = $(".bb-in");
  let messages = load(), busy = false;

  const bubble = (role, text) => `<div class="bb-msg ${role === "user" ? "me" : "bot"}">${esc(text).replace(/\n/g, "<br>")}</div>`;
  const initials = (n) => String(n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
  const KIND = { worker: "worker", pm: "pm", company: "company", supplier: "business" };
  // A recommended member or open job: photo or initials, name, trade and place, badge and the facts that decide.
  function card(c, i, mi) {
    const job = c.kind === "job", top = i === 0 && !job, place = [...new Set([c.town, c.region].filter(Boolean))].join(", ");
    const rate = Number(c.rate) ? `GH&#8373;${Math.round(Number(c.rate)).toLocaleString("en-GH")} a day` : "";
    const facts = [rate, !job && c.experience ? `${esc(c.experience)} yrs` : "", Number(c.rating) ? `${Number(c.rating).toFixed(1)} rating` : "",
      job && c.workers_needed ? `${esc(c.workers_needed)} needed` : "", job && c.posted_by ? esc(c.posted_by) : ""].filter(Boolean).map((f) => `<span>${f}</span>`).join("")
      + (!job && !c.verified ? '<span class="un">Not verified yet</span>' : "");
    const name = job ? c.title : c.name;
    const av = job ? '<i class="bb-av2 job"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/></svg></i>'
      : `<i class="bb-av2" ${c.photo ? `style="background-image:url('${esc(String(c.photo).replace(/'/g, "%27"))}')"` : ""}>${c.photo ? "" : esc(initials(name))}</i>`;
    return `<button type="button" class="bb-card${top ? " top" : ""}" style="--d:${i * 90}ms" data-card="${mi}:${i}" aria-label="${esc(name)}, ${esc(c.trade || "")}${c.verified ? ", verified" : ""}">${av}
      <span class="bb-cbody"><b><em>${esc(name)}</em>${c.verified ? '<svg class="ok" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.4 2.1 3.2-.4.9 3.1 2.9 1.5-1 3 1 3-2.9 1.5-.9 3.1-3.2-.4L12 22l-2.4-2.1-3.2.4-.9-3.1-2.9-1.5 1-3-1-3 2.9-1.5.9-3.1 3.2.4z"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ""}${top ? '<u>Top match</u>' : c.featured ? '<s>Featured</s>' : ""}</b>
      <small>${esc([c.trade, place].filter(Boolean).join(" · "))}</small>${facts ? `<span class="bb-facts">${facts}</span>` : ""}</span>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`;
  }
  function paint() {
    log.innerHTML = bubble("assistant", GREETING) + messages.map((m, mi) => bubble(m.role, m.content) + (m.cards?.length ? `<div class="bb-cards">${m.cards.map((c, i) => card(c, i, mi)).join("")}</div>` : "")).join("") + (busy ? '<div class="bb-msg bot typing" aria-label="BAID Bot is typing"><i></i><i></i><i></i></div>' : "");
    sugs.hidden = messages.length > 0;
    log.scrollTop = log.scrollHeight;
  }
  sugs.innerHTML = SUGGEST.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");

  async function ask(q) {
    q = q.trim().slice(0, 600);
    if (!q || busy) return;
    messages.push({ role: "user", content: q });
    busy = true; paint(); save(messages);
    let reply, cards = [];
    try {
      const r = await fetch(URL_BOT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: messages.slice(-8).map(({ role, content }) => ({ role, content })) }) });
      const data = await r.json().catch(() => ({}));
      reply = data.reply || "Sorry, I couldn't answer that right now. Please try again.";
      cards = Array.isArray(data.cards) ? data.cards.slice(0, 8) : [];
    } catch {
      reply = "I couldn't reach BAID X just now. Check your connection and try again.";
    }
    messages.push({ role: "assistant", content: reply, cards });
    busy = false; paint(); save(messages);
  }

  function open(on) {
    panel.hidden = !on;
    root.classList.toggle("open", on);
    fab.setAttribute("aria-expanded", String(on));
    if (on) { paint(); setTimeout(() => input.focus(), 50); }
  }
  fab.addEventListener("click", () => open(panel.hidden));
  $(".bb-x").addEventListener("click", () => { open(false); fab.focus(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { open(false); fab.focus(); } });
  sugs.addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) ask(b.dataset.q); });
  // a person opens their profile; a job asks the visitor to join to apply
  log.addEventListener("click", (e) => {
    const b = e.target.closest("[data-card]"); if (!b) return;
    const [mi, i] = b.dataset.card.split(":").map(Number), c = messages[mi]?.cards?.[i]; if (!c) return;
    if (c.kind === "job") { location.href = "auth.html?mode=signup&group=pro"; return; }
    if (window.FEAT?.openCard) { open(false); window.FEAT.openCard(KIND[c.kind] || "worker", c.id); }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; ask(q); });

  // a short "Ask BAID Bot" hint beside the button, once per visit
  try {
    if (!sessionStorage.getItem("baidx_bot_hint")) {
      setTimeout(() => root.classList.add("hint"), 2200);
      setTimeout(() => root.classList.remove("hint"), 8000);
      sessionStorage.setItem("baidx_bot_hint", "1");
    }
  } catch { /* private mode: no hint */ }
})();
