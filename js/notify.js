/* Notifications: bell count, notifications page, and phone alerts (Web Push) for when BAID X isn't open. */
(() => {
  "use strict";
  const { sb, esc, icon, ago, toast } = window.BX;
  const uid = () => window.APP?.state?.me?.session?.user?.id;
  const ICON = (n) => ({ message: "chat", chat: "chat", invite: "mail", invitation: "mail", payment: "pay", wallet: "wallet", project: "proj", task: "task", report: "rep", verification: "seal", approval: "task", job: "work" }[String(n.category || n.type || "").split(/[._-]/)[0]] || "bell");
  const pushOk = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  async function refresh() {
    const u = uid(); if (!u) return;
    const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", u).is("read_at", null);
    window.APP.state.notif = count || 0; window.APP.updateBell();
  }
  // called by chat.js the moment a live notification arrives
  function bump() { window.APP.state.notif = (window.APP.state.notif || 0) + 1; window.APP.updateBell(true); }

  /* ---------- page ---------- */
  async function view(c) {
    const { head, empty } = window.DASH.ui;
    const { data } = await sb.from("notifications").select("id,type,category,title,body,href,read_at,created_at").eq("user_id", c.uid).order("created_at", { ascending: false }).limit(60);
    const list = data || [], unread = list.filter((n) => !n.read_at).length;
    window.APP.state.notif = unread; window.APP.updateBell();
    const ask = pushOk() && Notification.permission !== "granted" && Notification.permission !== "denied"
      ? `<div class="push-ask"><span class="n-ic" style="width:40px;height:40px;border-radius:13px;display:grid;place-items:center;background:rgba(56,189,248,.15);color:#7dd3fc">${icon("phone", 20)}</span><span><b>Get alerts on your phone</b><small>Pop-ups for messages, invitations and approvals, even when BAID X is closed.</small></span><button class="btn-light sm" data-notify="enable">Turn on</button></div>`
      : pushOk() && Notification.permission === "denied" ? `<div class="push-ask"><span><b>Alerts are blocked</b><small>Allow notifications for BAID X in your browser's site settings to get phone pop-ups.</small></span></div>` : "";
    return head("Notifications", unread ? `<button class="btn-dark sm" data-notify="all">Mark all read</button>` : "") + ask
      + (list.length ? list.map((n) => `<button class="nt ${n.read_at ? "" : "un"}" data-notify="open" data-id="${esc(n.id)}" data-href="${esc(n.href || "")}"><span class="n-ic">${icon(ICON(n), 19)}</span><span style="flex:1;min-width:0"><span class="nt-top"><b>${esc(n.title || "BAID X")}</b><small>${esc(ago(n.created_at))}</small></span>${n.body ? `<p>${esc(n.body)}</p>` : ""}</span>${n.read_at ? "" : '<i class="udot"></i>'}</button>`).join("")
        : empty("bell", "You're all caught up", "Messages, invitations, approvals and payment updates will show up here."));
  }

  /* ---------- phone alerts ---------- */
  const b64u = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((ch) => ch.charCodeAt(0))); };
  const k64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  async function subscribe(prompt) {
    if (!pushOk() || !uid()) return false;
    let key = window.BAIDX_CONFIG?.VAPID_PUBLIC_KEY;
    if (!key) { try { const r = await fetch("/api/push?key=1"); if (r.ok) key = (await r.json()).publicKey; } catch { /* offline */ } }
    if (!key) { if (prompt) toast("Phone alerts are being set up. Try again soon."); return false; }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
      if (Notification.permission === "default" && prompt) await Notification.requestPermission();
      if (Notification.permission !== "granted") return false;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) }));
      const j = sub.toJSON();
      const { error } = await sb.rpc("save_push_sub", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 160) });
      if (error) throw error;
      return true;
    } catch (e) { console.warn("push subscribe failed", e); if (prompt) toast("Couldn't turn on phone alerts."); return false; }
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-notify]"); if (!el) return;
    const a = el.dataset.notify;
    if (a === "enable") { const ok = await subscribe(true); if (ok) { toast("Phone alerts are on"); window.APP.route(); } else window.APP.route(); }
    else if (a === "all") { await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", uid()).is("read_at", null); window.APP.state.notif = 0; window.APP.updateBell(); window.APP.route(); }
    else if (a === "open") { sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", el.dataset.id).then(() => refresh()); const h = el.dataset.href; if (h && h.startsWith("#/")) location.hash = h; else window.APP.route(); }
  });

  window.addEventListener("baidx:member", () => { refresh(); if (pushOk() && Notification.permission === "granted") subscribe(false); });
  window.NOTIFY = { refresh, bump, subscribe };
  window.DASH.register("notifications", view);
})();
