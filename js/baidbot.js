/* BAID Bot: a floating assistant on the landing for visitors (same as the app's visitor
   Home). Questions go to the Supabase function "baid-bot", which answers with Claude when
   an AI key is set and from BAID X's own facts otherwise. The conversation stays in this
   tab only (sessionStorage). Text is always escaped; nothing is sent but the chat. */
(() => {
  const URL_BOT = "https://igfmmprlrybxsdzehwid.supabase.co/functions/v1/baid-bot";
  const KEY = "baidx_bot";
  const GREETING = "Hi, I'm BAID Bot. Ask me anything about BAID X: joining, escrow, badges, plans or rates.";
  const SUGGEST = ["Is BAID X free?", "How does escrow protect me?", "What does a badge mean?", "How much are the plans?"];
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
        <div><b>BAID Bot</b><small><i></i>Answers about BAID X</small></div>
        <button class="bb-x" type="button" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="bb-log" aria-live="polite"></div>
      <div class="bb-sugs"></div>
      <form class="bb-form" autocomplete="off">
        <input class="bb-in" maxlength="600" placeholder="Ask about BAID X" aria-label="Your question" />
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
  function paint() {
    log.innerHTML = bubble("assistant", GREETING) + messages.map((m) => bubble(m.role, m.content)).join("") + (busy ? '<div class="bb-msg bot typing" aria-label="BAID Bot is typing"><i></i><i></i><i></i></div>' : "");
    sugs.hidden = messages.length > 0;
    log.scrollTop = log.scrollHeight;
  }
  sugs.innerHTML = SUGGEST.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");

  async function ask(q) {
    q = q.trim().slice(0, 600);
    if (!q || busy) return;
    messages.push({ role: "user", content: q });
    busy = true; paint(); save(messages);
    let reply;
    try {
      const r = await fetch(URL_BOT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: messages.slice(-8) }) });
      const data = await r.json().catch(() => ({}));
      reply = data.reply || "Sorry, I couldn't answer that right now. Please try again.";
    } catch {
      reply = "I couldn't reach BAID X just now. Check your connection and try again.";
    }
    messages.push({ role: "assistant", content: reply });
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
