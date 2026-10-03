/* BAID X messaging: live (no refresh), optimistic sends, end-to-end encryption, photos, files, voice notes,
   and voice / video calls. Message text and attachments are encrypted in the browser with keys that never leave
   the device unwrapped, so the server (and BAID X staff) only ever store ciphertext for new chats. */
(() => {
  "use strict";
  const { sb, esc, icon, toast, ago } = window.BX;
  const U8 = (b) => new Uint8Array(b);
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = (buf) => { const a = U8(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const uid4 = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const av = (name, photo, cls = "") => `<span class="av ${cls}" ${photo ? `style="background-image:url('${esc(photo)}')"` : ""}>${photo ? "" : esc(initials(name))}</span>`;
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const me = () => window.APP?.state.me?.session?.user?.id || null;
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
  const dayLabel = (iso) => { const d = new Date(iso), n = new Date(), y = new Date(Date.now() - 864e5); const same = (a, b) => a.toDateString() === b.toDateString(); return same(d, n) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString("en-GH", { day: "numeric", month: "long", year: "numeric" }); };
  const fsize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const fdur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  /* ======================================================================
     Keys: one ECDH P-256 key pair per device, private half kept in IndexedDB
     ====================================================================== */
  const idb = (() => {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open("baidx-chat", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("kv", mode), s = t.objectStore("kv"), q = fn(s); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
    return { get: (k) => run("readonly", (s) => s.get(k)), set: (k, v) => run("readwrite", (s) => s.put(v, k)) };
  })();
  const K = { ring: null, ready: null, publishedChecked: false };
  const ECDH = { name: "ECDH", namedCurve: "P-256" };
  async function genKey() {
    const kp = await crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
    const priv = await crypto.subtle.exportKey("jwk", kp.privateKey), pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const id = b64(crypto.getRandomValues(new Uint8Array(9))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    return { id, priv, pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } };
  }
  async function passKey(pass, salt) { const base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]); return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
  async function wrapRing(pass, ring) { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), k = await passKey(pass, salt); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, te.encode(JSON.stringify(ring))); return { salt: b64(salt), iv: b64(iv), ct: b64(ct) }; }
  async function unwrapRing(pass, w) { const k = await passKey(pass, unb64(w.salt)); return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv) }, k, unb64(w.ct)))); }

  async function ensureKeys() {
    if (K.ring) return K.ring;
    if (K.ready) return K.ready;
    K.ready = (async () => {
      const u = me(); if (!u) throw new Error("not signed in");
      let ring = await idb.get("ring:" + u);
      if (!ring?.current) {
        const { data: bk } = await sb.from("key_backups").select("wrapped").eq("user_id", u).maybeSingle();
        if (bk?.wrapped && !sessionStorage.getItem("baidx_skip_restore")) { const restored = await askRestore(bk.wrapped); if (restored) ring = restored; }
      }
      if (!ring?.current) { const k = await genKey(); ring = { current: k.id, keys: { [k.id]: { priv: k.priv, pub: k.pub } } }; await idb.set("ring:" + u, ring); }
      await idb.set("ring:" + u, ring);
      const cur = ring.keys[ring.current];
      const mine = await rpc("peer_keys", { p_user: u });
      if (!mine.some((x) => x.id === ring.current && x.current)) await rpc("publish_key", { p_key_id: ring.current, p_public: cur.pub });
      K.ring = ring; return ring;
    })();
    try { return await K.ready; } catch (e) { K.ready = null; throw e; }
  }
  function askRestore(wrapped) {
    return new Promise((resolve) => {
      window.FEAT.openSheet("Restore secure chat", `<p class="cap2">This account has a secure-chat key backup. Enter your backup password to read your earlier messages on this device, or start fresh (older messages stay unreadable here).</p><form id="rsf">${window.FEAT.fld("Backup password", `<input class="in" type="password" name="p" autocomplete="off" />`)}<div class="btn-row"><button class="btn-light sm" type="submit">Restore</button><button type="button" class="btn-dark sm" id="rsx">Start fresh</button></div><div class="cap2 warnt" id="rse"></div></form>`);
      document.getElementById("rsf").onsubmit = async (e) => { e.preventDefault(); try { const r = await unwrapRing(e.target.p.value, wrapped); window.FEAT.closeSheet(); resolve(r); } catch { document.getElementById("rse").textContent = "That password didn't unlock the backup."; } };
      document.getElementById("rsx").onclick = () => { sessionStorage.setItem("baidx_skip_restore", "1"); window.FEAT.closeSheet(); resolve(null); };
    });
  }
  async function backupKeys(pass) { const ring = await ensureKeys(), w = await wrapRing(pass, ring); const { error } = await sb.from("key_backups").upsert({ user_id: me(), wrapped: w, updated_at: new Date().toISOString() }); if (error) throw error; }

  const peerKeyCache = new Map(), sharedCache = new Map();
  async function peerKeys(peerId, force) { if (!force && peerKeyCache.has(peerId)) return peerKeyCache.get(peerId); const l = await rpc("peer_keys", { p_user: peerId }); peerKeyCache.set(peerId, l); return l; }
  async function shared(myKid, peerKid, peerJwk) {
    const ck = myKid + ":" + peerKid + ":" + (peerJwk.x || "").slice(0, 12); if (sharedCache.has(ck)) return sharedCache.get(ck);
    const priv = await crypto.subtle.importKey("jwk", K.ring.keys[myKid].priv, ECDH, false, ["deriveKey"]), pub = await crypto.subtle.importKey("jwk", peerJwk, ECDH, false, []);
    const key = await crypto.subtle.deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    sharedCache.set(ck, key); return key;
  }
  async function encryptFor(peerId, payload) {
    await ensureKeys(); const list = await peerKeys(peerId, true), pk = list.find((x) => x.current) || list[0];
    if (!pk) return null; // the other person has not set up secure chat yet
    const key = await shared(K.ring.current, pk.id, pk.jwk), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(payload)));
    return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct), s: K.ring.current, r: pk.id });
  }
  async function decryptMsg(m, peerId) {
    if (!m.v) { if (m.type !== "text" && m.type !== "system") { try { const o = JSON.parse(m.body); if (o && o.a) return o; } catch { /* plain legacy body */ } } return { t: m.type, x: m.body }; }
    try {
      await ensureKeys(); const o = JSON.parse(m.body), myKid = m.mine ? o.s : o.r, peerKid = m.mine ? o.r : o.s;
      if (!K.ring.keys[myKid]) return { t: "locked" };
      let list = await peerKeys(peerId), pk = list.find((x) => x.id === peerKid); if (!pk) { list = await peerKeys(peerId, true); pk = list.find((x) => x.id === peerKid); }
      if (!pk) return { t: "locked" };
      const key = await shared(myKid, pk.id, pk.jwk);
      return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.ct))));
    } catch { return { t: "locked" }; }
  }
  async function encryptBytes(buf) {
    const raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12)), key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
    return { ct: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf), key: b64(raw), iv: b64(iv) };
  }
  async function decryptBytes(buf, keyB64, ivB64) { const key = await crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, ["decrypt"]); return crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, buf); }

  /* ======================================================================
     State + realtime
     ====================================================================== */
  const S = { convs: [], byId: new Map(), previews: {}, th: null, ch: null, calls: null, notifPerm: "Notification" in window ? Notification.permission : "denied" };
  S.pres = {};
  const isOn = (id) => { const p = S.pres[id]; return !!p && p.status === "online" && Date.now() - new Date(p.last_seen_at).getTime() < 110000; };
  const seenText = (id) => (isOn(id) ? "Active now" : S.pres[id]?.last_seen_at ? `Last seen ${ago(S.pres[id].last_seen_at)}` : "Offline");
  const avp = (name, photo, id, cls = "") => `<span class="av-wrap">${av(name, photo, cls)}<i class="pres ${isOn(id) ? "on" : ""}" data-pres="${esc(id || "")}"></i></span>`;
  async function beat(status) { const u = me(); if (!u) return; const now = new Date().toISOString(); try { await sb.from("user_presence").upsert({ user_id: u, status: status || "online", last_seen_at: now, updated_at: now }); } catch { /* offline */ } }
  async function loadPresence() { const ids = [...new Set(S.convs.map((c) => c.peer_id).filter(Boolean))]; if (!ids.length) return; const { data } = await sb.from("user_presence").select("user_id,status,last_seen_at").in("user_id", ids); (data || []).forEach((r) => { S.pres[r.user_id] = r; }); paintPresence(); }
  function paintPresence() {
    document.querySelectorAll("[data-pres]").forEach((el) => el.classList.toggle("on", isOn(el.dataset.pres)));
    const h = document.getElementById("chSub"), T = S.th; if (h && T) h.innerHTML = `<span class="${isOn(T.peer.id) ? "on-line" : ""}">${esc(seenText(T.peer.id))}</span> · ${si("lock", 11)} ${T.noKey ? "Not encrypted yet" : "Encrypted"}`;
  }
  let beatT = null;
  function startPresence() {
    if (beatT) return; beat("online"); loadPresence();
    beatT = setInterval(() => { if (document.visibilityState === "visible") beat("online"); loadPresence(); }, 40000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { beat("online"); loadPresence(); } else beat("offline"); });
    window.addEventListener("pagehide", () => beat("offline"));
  }
  const blobCache = new Map();
  let audioCtx = null;
  const blip = () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = "sine"; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18); o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.2); } catch { /* sound is optional */ } };
  const unreadTotal = () => S.convs.reduce((a, c) => a + (c.unread || 0), 0);
  const syncNav = () => { if (window.APP) { window.APP.state.unread = unreadTotal(); window.APP.renderNav?.(); } };

  async function loadConvs() { const l = (await rpc("my_conversations")) || []; S.convs = l; S.byId = new Map(l.map((c) => [c.id, c])); return l; }
  function notify(title, body, href) {
    const visible = document.visibilityState === "visible";
    if (visible) { blip(); window.BX.toast(`${title}: ${body}`); }
    else if (S.notifPerm === "granted") { try { const n = new Notification(title, { body, icon: "assets/icon-192.png", tag: href }); n.onclick = () => { window.focus(); if (href) location.hash = href; n.close(); }; } catch { /* ignore */ } }
  }

  function startRealtime() {
    const u = me(); if (!u || S.ch) return;
    S.ch = sb.channel("rt-" + u)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => onMessage(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_participants" }, (p) => onParticipant(p.new))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${u}` }, (p) => onNotification(p.new))
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, (p) => { const r = p.new; if (r && r.user_id) { S.pres[r.user_id] = r; paintPresence(); } })
      .subscribe((st) => { S.rtState = st; });
    startPresence();
    S.inbox = sb.channel("inbox-" + u, { config: { broadcast: { self: false } } }).on("broadcast", { event: "call" }, (p) => onCallSignal(p.payload)).subscribe();
  }
  async function onMessage(row) {
    const u = me(); if (!row || !u) return;
    const th = S.th;
    if (th && th.id === row.conversation_id) { await th.receive(row); }
    else if (row.sender_id !== u) {
      let c = S.byId.get(row.conversation_id); if (!c) { await loadConvs(); c = S.byId.get(row.conversation_id); }
      if (c) { c.unread = (c.unread || 0) + 1; c.last_message_at = row.created_at; c.preview = row.encryption_version ? "🔒 Message" : row.body; S.convs.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)); decryptPreview(c, row); syncNav(); renderList(); notify(c.peer_name, row.encryption_version ? "New message" : String(row.body || "").slice(0, 80), `#/chat/${c.id}`); }
    } else { const c = S.byId.get(row.conversation_id); if (c) { c.last_message_at = row.created_at; renderList(); } }
  }
  async function decryptPreview(c, row) {
    if (row.message_type === "system") { S.previews[c.id] = row.body; renderList(); return; }
    const d = await decryptMsg({ body: row.body, v: row.encryption_version || 0, mine: row.sender_id === me(), type: row.message_type }, c.peer_id);
    S.previews[c.id] = d.t === "locked" ? "🔒 Message" : d.t === "image" ? "📷 Photo" : d.t === "audio" ? "🎤 Voice note" : d.t === "file" ? "📎 " + (d.a?.name || "File") : d.x || ""; renderList();
  }
  function onParticipant(row) { if (S.th && row.conversation_id === S.th.id && row.user_id !== me()) S.th.peerRead(row.last_read_at); }
  function onNotification(n) { if (!n) return; window.NOTIFY?.bump(); notify(n.title || "BAID X", n.body || "", n.href && n.href.startsWith("#/") ? n.href : "#/home"); if (location.hash.startsWith("#/home")) window.APP?.route(); }

  /* ======================================================================
     Chats list
     ====================================================================== */
  let listBox = null;
  function rowHtml(x) { const prev = S.previews[x.id] || x.preview || "No messages yet"; return `<button class="row chat" data-go="chat/${esc(x.id)}">${avp(x.peer_name, x.peer_photo, x.peer_id)}<span class="tx"><b>${esc(x.peer_name)}</b><small>${esc(prev)}</small></span><span class="meta2">${x.last_message_at ? esc(hhmmShort(x.last_message_at)) : ""}</span>${x.unread ? `<span class="badge">${x.unread}</span>` : ""}</button>`; }
  const hhmmShort = (iso) => { const d = new Date(iso), n = new Date(); return d.toDateString() === n.toDateString() ? hhmm(iso) : d.toLocaleDateString("en-GH", { day: "numeric", month: "short" }); };
  function renderList() {
    if (!listBox || !document.body.contains(listBox)) return;
    const alert = S.notifPerm === "default" ? `<button class="alertbar" data-chat="perm">${icon("chat", 16)} Turn on message alerts</button>` : "";
    const bk = (() => { try { return localStorage.getItem("baidx_bk_" + me()) ? "" : `<button class="alertbar" data-chat="backup">${si("lock", 16)} Back up your secure-chat key to keep old messages on a new phone</button>`; } catch { return ""; } })();
    listBox.innerHTML = alert + bk + (S.convs.length ? `<div class="list">${S.convs.map(rowHtml).join("")}</div>` : `<div class="empty">${icon("chat", 56)}<h2>No conversations yet</h2><p>Open someone's profile in Discover and tap Message to start a chat.</p><button class="btn-light" data-tab="${window.APP.state.me.role === "worker" ? "jobs" : "discover"}">${window.APP.state.me.role === "worker" ? "Browse jobs" : "Find people"}</button></div>`);
  }
  async function list(box) {
    listBox = box; box.innerHTML = '<div class="skel" style="height:72px;margin-top:14px"></div>'.repeat(3);
    try { await loadConvs(); startRealtime(); renderList(); syncNav(); loadPresence(); S.convs.slice(0, 12).forEach((c) => { /* warm previews for encrypted chats */ }); } catch (e) { console.error(e); box.innerHTML = '<div class="state"><b>Couldn\'t load chats</b>Check your connection and try again.</div>'; }
  }

  /* ======================================================================
     Thread
     ====================================================================== */
  const ICONS = { send: '<path d="m4 12 16-8-6 16-3-7z"/>', clip: '<path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.500 3.500 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', phone: '<path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>', back: '<path d="m15 6-6 6 6 6"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', mute: '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>', end: '<path d="M3 15c5-4 13-4 18 0l-2 3-4-2v-2c-2-.7-4-.7-6 0v2l-4 2z"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' };
  const si = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

  async function thread(c, id) {
    closeThread();
    const sk = '<div class="ct-skel"><div class="skel" style="height:44px;margin:16px 0"></div><div class="skel" style="height:44px;width:60%;margin:10px 0 10px auto"></div><div class="skel" style="height:44px;width:70%"></div></div>';
    setTimeout(() => openThread(id), 0);
    return `<div class="chat-wrap" id="chatWrap"><div class="chat-head" id="chHead"><button class="icon-btn" data-go="chats" aria-label="Back">${si("back", 22)}</button><span class="tx"><b>Loading…</b></span></div><div class="msg-area" id="msgArea">${sk}</div><div class="comp" id="comp"></div></div>`;
  }
  function closeThread() { if (S.th) { S.th.destroy(); S.th = null; } }

  async function openThread(id) {
    const root = document.getElementById("chatWrap"); if (!root) return;
    let data;
    try { await loadConvs().catch(() => {}); data = await rpc("chat_thread", { p_conv: id }); } catch (e) { root.querySelector("#msgArea").innerHTML = `<div class="state"><b>Couldn't open this chat</b>${esc(e.message || "")}</div>`; return; }
    startRealtime(); loadPresence();
    const peer = data.peer || {}, u = me();
    const T = { id, peer, msgs: [], pending: new Map(), peerReadAt: peer.last_read_at ? new Date(peer.last_read_at).getTime() : 0, typingT: null, lastTypingSent: 0, noKey: false, recording: null, oldest: null, atEnd: true };
    S.th = T; let readT = null;
    const headHtml = `<button class="icon-btn" data-go="chats" aria-label="Back">${si("back", 22)}</button>${avp(peer.name, peer.photo, peer.id)}<span class="tx"><b>${esc(peer.name || "Chat")}</b><small id="chSub">${esc(String(peer.role || "").replace(/[_-]/g, " "))}</small></span><button class="icon-btn" id="callA" aria-label="Voice call">${si("phone")}</button><button class="icon-btn" id="callV" aria-label="Video call">${si("video")}</button>`;
    document.getElementById("chHead").innerHTML = headHtml;
    document.getElementById("comp").innerHTML = `<div class="comp-sec" id="compSec" hidden></div><div class="comp-row" id="compRow"><label class="ib" title="Attach">${si("clip")}<input type="file" id="fileIn" accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip,.txt" multiple hidden /></label><textarea id="msgIn" rows="1" placeholder="Message" maxlength="4000" enterkeyhint="send"></textarea><button class="ib mic" id="micBtn" aria-label="Voice note">${si("mic")}</button><button class="ib send" id="sendBtn" aria-label="Send" hidden>${si("send")}</button></div>`;
    const area = document.getElementById("msgArea"), input = document.getElementById("msgIn"), sendBtn = document.getElementById("sendBtn"), micBtn = document.getElementById("micBtn");

    /* ---- rendering ---- */
    const tick = (m) => (!m.mine ? "" : m.status === "sending" ? '<i class="tk">🕓</i>' : m.status === "failed" ? '<i class="tk bad">!</i>' : (new Date(m.at).getTime() <= T.peerReadAt ? '<i class="tk rd">✓✓</i>' : '<i class="tk">✓</i>'));
    const attHtml = (m) => {
      const a = m.att; if (!a) return "";
      const kind = m.type === "image" ? "image" : m.type === "audio" ? "audio" : (a.mime || "").startsWith("video/") ? "video" : "file";
      if (kind === "image") return `<div class="att img" data-att="${esc(m.key)}" data-kind="image"><span class="ph"></span></div>`;
      if (kind === "audio") return `<div class="att aud" data-att="${esc(m.key)}" data-kind="audio"><button class="play" data-play="${esc(m.key)}" aria-label="Play">▶</button><span class="wave"><i></i></span><small>${a.dur ? fdur(a.dur / 1000) : "0:00"}</small></div>`;
      if (kind === "video") return `<div class="att vid" data-att="${esc(m.key)}" data-kind="video"><span class="ph">🎬 Video</span></div>`;
      return `<button class="att file" data-file="${esc(m.key)}"><span class="fi">📎</span><span><b>${esc(a.name || "File")}</b><small>${esc(fsize(a.size || 0))} · tap to download</small></span></button>`;
    };
    const bubble = (m) => {
      if (m.system) return `<div class="sysmsg">${esc(m.text)}</div>`;
      const body = m.locked ? `<p class="lockedm">${si("lock", 14)} Can't be decrypted on this device</p>` : `${attHtml(m)}${m.text ? `<p>${esc(m.text)}</p>` : ""}`;
      return `<div class="cb ${m.mine ? "me" : ""} ${m.status === "failed" ? "failed" : ""}" data-key="${esc(m.key)}">${body}<span class="mt">${esc(hhmm(m.at))} ${tick(m)}</span></div>`;
    };
    const renderAll = () => { let last = ""; area.innerHTML = (T.atStart ? "" : '<button class="older" data-chat="older">Load earlier messages</button>') + T.msgs.map((m) => { const d = dayLabel(m.at), sep = d !== last ? `<div class="dsep"><span>${d}</span></div>` : ""; last = d; return sep + bubble(m); }).join("") + '<div id="endMark"></div>'; hydrate(); };
    const append = (m) => { const near = area.scrollHeight - area.scrollTop - area.clientHeight < 140; T.msgs.push(m); const lastDay = T.msgs.length > 1 ? dayLabel(T.msgs[T.msgs.length - 2].at) : ""; const d = dayLabel(m.at); const end = area.querySelector("#endMark"); end.insertAdjacentHTML("beforebegin", (d !== lastDay ? `<div class="dsep"><span>${d}</span></div>` : "") + bubble(m)); hydrate(); if (near || m.mine) area.scrollTop = area.scrollHeight; else showPill(); };
    const refreshOne = (m) => { const el = area.querySelector(`[data-key="${CSS.escape(m.key)}"]`); if (el) { el.outerHTML = bubble(m); hydrate(); } };
    const showPill = () => { let p = document.getElementById("newPill"); if (!p) { p = document.createElement("button"); p.id = "newPill"; p.className = "newpill"; p.textContent = "New messages ↓"; p.onclick = () => { area.scrollTop = area.scrollHeight; p.remove(); }; document.getElementById("chatWrap").appendChild(p); } };
    area.addEventListener("scroll", () => { if (area.scrollHeight - area.scrollTop - area.clientHeight < 80) document.getElementById("newPill")?.remove(); });

    /* ---- attachments (decrypt on demand) ---- */
    const loadBlob = async (m) => {
      const a = m.att; if (blobCache.has(a.path)) return blobCache.get(a.path);
      const { data, error } = await sb.storage.from("chat-attachments").download(a.path); if (error) throw error;
      const dec = await decryptBytes(await data.arrayBuffer(), a.key, a.iv), url = URL.createObjectURL(new Blob([dec], { type: a.mime || "application/octet-stream" })); blobCache.set(a.path, url); return url;
    };
    const findMsg = (key) => T.msgs.find((x) => x.key === key);
    function hydrate() {
      area.querySelectorAll("[data-att]:not([data-done])").forEach(async (el) => {
        const m = findMsg(el.dataset.att); if (!m?.att) return; el.dataset.done = "1";
        if (el.dataset.kind === "audio") return; // loaded on play
        if (m.pendingUrl) { fillMedia(el, m, m.pendingUrl); return; }
        try { fillMedia(el, m, await loadBlob(m)); } catch { el.innerHTML = '<span class="ph">Couldn\'t load</span>'; }
      });
    }
    const fillMedia = (el, m, url) => { if (el.dataset.kind === "image") { el.innerHTML = `<img src="${url}" alt="Photo" data-lightbox="${url}" />`; } else if (el.dataset.kind === "video") el.innerHTML = `<video src="${url}" controls playsinline preload="metadata"></video>`; };
    area.addEventListener("click", async (e) => {
      const lb = e.target.closest("[data-lightbox]"); if (lb) { const o = document.createElement("div"); o.className = "lightbox"; o.innerHTML = `<img src="${lb.dataset.lightbox}" alt="Photo" />`; o.onclick = () => o.remove(); document.body.appendChild(o); return; }
      const pl = e.target.closest("[data-play]"); if (pl) {
        const m = findMsg(pl.dataset.play), wrap = pl.closest(".att"); if (!m) return;
        let au = wrap._au; if (!au) { pl.textContent = "…"; try { const url = m.pendingUrl || (await loadBlob(m)); au = wrap._au = new Audio(url); au.ontimeupdate = () => { wrap.querySelector(".wave i").style.width = (au.currentTime / (au.duration || 1)) * 100 + "%"; }; au.onended = () => { pl.textContent = "▶"; wrap.querySelector(".wave i").style.width = "0"; }; } catch { pl.textContent = "!"; return; } }
        if (au.paused) { document.querySelectorAll(".att.aud").forEach((w) => { if (w._au && w._au !== au) { w._au.pause(); w.querySelector(".play").textContent = "▶"; } }); au.play(); pl.textContent = "❚❚"; } else { au.pause(); pl.textContent = "▶"; } return;
      }
      const fl = e.target.closest("[data-file]"); if (fl) { const m = findMsg(fl.dataset.file); try { const url = await loadBlob(m), a = document.createElement("a"); a.href = url; a.download = m.att.name || "file"; a.click(); } catch { toast("Couldn't download that file."); } return; }
      const rt = e.target.closest(".cb.failed"); if (rt) { const m = T.msgs.find((x) => x.key === rt.dataset.key); if (m?.retry) m.retry(); return; }
      if (e.target.closest("[data-chat=older]")) loadOlder();
    });

    /* ---- load + decrypt initial messages ---- */
    const toLocal = async (r) => {
      const d = await decryptMsg({ body: r.body, v: r.v, mine: r.mine, type: r.type }, peer.id);
      const m = { key: r.client || r.id, id: r.id, mine: r.mine, at: r.at, status: "sent", type: r.type, system: r.type === "system", text: r.type === "system" ? r.body : (d.x || ""), locked: d.t === "locked" };
      if (d.a) m.att = d.a; else if (r.att?.length && !r.v) m.att = { path: r.att[0].path, name: r.att[0].name, mime: r.att[0].mime, size: r.att[0].size, dur: r.att[0].dur };
      return m;
    };
    T.msgs = await Promise.all((data.messages || []).map(toLocal));
    T.oldest = data.messages?.[0]?.at || null; T.atStart = (data.messages || []).length < 60;
    renderAll(); area.scrollTop = area.scrollHeight;
    const last = T.msgs[T.msgs.length - 1]; if (last) S.previews[id] = last.system ? last.text : last.locked ? "🔒 Message" : last.type === "image" ? "📷 Photo" : last.type === "audio" ? "🎤 Voice note" : last.type === "file" ? "📎 File" : last.text;
    markRead(true); const c0 = S.byId.get(id); if (c0) { c0.unread = 0; syncNav(); }
    ensureKeys().then(async () => { const pk = await peerKeys(peer.id, true); T.noKey = !pk.length; banner(); }).catch(() => {});
    async function loadOlder() { try { const o = await rpc("chat_thread", { p_conv: id, p_before: T.oldest }); const more = await Promise.all((o.messages || []).map(toLocal)); if (!more.length) { T.atStart = true; } else { T.oldest = o.messages[0].at; T.msgs = more.concat(T.msgs); T.atStart = o.messages.length < 60; } const h = area.scrollHeight; renderAll(); area.scrollTop = area.scrollHeight - h; } catch { toast("Couldn't load earlier messages."); } }
    function banner() { paintPresence(); }

    /* ---- receiving ---- */
    T.receive = async (row) => {
      if (T.msgs.some((x) => x.id === row.id || (row.client_id && x.key === row.client_id))) { const m = T.msgs.find((x) => x.key === row.client_id); if (m && m.status !== "sent") { m.status = "sent"; m.id = row.id; refreshOne(m); } return; }
      const att = row.message_type !== "text" && row.message_type !== "system" ? await rpc("chat_thread", { p_conv: id, p_limit: 1 }).then((x) => x.messages?.[0]?.att || []).catch(() => []) : [];
      const m = await toLocal({ id: row.id, client: row.client_id, mine: row.sender_id === u, body: row.body, v: row.encryption_version || 0, type: row.message_type, at: row.created_at, att });
      append(m);
      if (!m.mine) { S.previews[id] = m.system ? m.text : m.locked ? "🔒 Message" : m.type === "image" ? "📷 Photo" : m.type === "audio" ? "🎤 Voice note" : m.type === "file" ? "📎 File" : m.text; if (document.visibilityState === "visible") { markRead(); blip(); } }
      document.getElementById("chSub") && (T.typingT = null, banner());
    };
    T.peerRead = (iso) => { T.peerReadAt = iso ? new Date(iso).getTime() : 0; area.querySelectorAll(".cb.me").forEach((el) => { const m = findMsg(el.dataset.key); if (m && m.status === "sent") { const t = el.querySelector(".tk"); if (t && new Date(m.at).getTime() <= T.peerReadAt) { t.className = "tk rd"; t.textContent = "✓✓"; } } }); };
    function markRead(now) { clearTimeout(readT); readT = setTimeout(() => rpc("mark_conversation_read", { p_conv: id }).catch(() => {}), now ? 0 : 400); }
    const visH = () => { if (document.visibilityState === "visible" && S.th === T) markRead(); }; document.addEventListener("visibilitychange", visH);

    /* ---- typing (broadcast) ---- */
    T.tch = sb.channel("typing-" + id, { config: { broadcast: { self: false } } }).on("broadcast", { event: "typing" }, (p) => { if (p.payload?.uid === u) return; const h = document.getElementById("chSub"); if (!h) return; h.textContent = p.payload.on ? "typing…" : ""; clearTimeout(T.typingT); if (p.payload.on) T.typingT = setTimeout(banner, 4000); else banner(); }).subscribe();
    const sendTyping = (on) => { const now = Date.now(); if (on && now - T.lastTypingSent < 2500) return; T.lastTypingSent = now; T.tch.send({ type: "broadcast", event: "typing", payload: { uid: u, on } }); };

    /* ---- composer ---- */
    const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 130) + "px"; const has = input.value.trim().length > 0; sendBtn.hidden = !has; micBtn.hidden = has; };
    input.addEventListener("input", () => { grow(); sendTyping(input.value.length > 0); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); doSend(); } });
    sendBtn.addEventListener("click", doSend);
    function doSend() { const text = input.value.trim(); if (!text) return; input.value = ""; grow(); sendTyping(false); push({ type: "text", text }); input.focus(); }

    // one path for every kind of message: show it instantly, encrypt + send in the background
    async function push({ type, text, file, dur, blob }) {
      const client = uid4(), m = { key: client, id: null, mine: true, at: new Date().toISOString(), status: "sending", type, text: text || "", att: null };
      if (file || blob) { const f = blob || file; m.att = { name: file?.name || (type === "audio" ? "voice.webm" : "file"), mime: f.type || "application/octet-stream", size: f.size, dur: dur || null }; m.pendingUrl = URL.createObjectURL(f); }
      append(m);
      const run = async () => {
        m.status = "sending"; refreshOne(m);
        try {
          const payload = { t: type, x: text || "" }; let attach = [];
          const pk = (await peerKeys(peer.id, true))[0]; T.noKey = !pk; banner();
          if (file || blob) {
            let f = blob || file; if (type === "image") f = await shrink(f);
            const { ct, key, iv } = await encryptBytes(await f.arrayBuffer()), path = `${u}/${uid4()}`;
            const up = await sb.storage.from("chat-attachments").upload(path, new Blob([ct]), { contentType: "application/octet-stream", upsert: false }); if (up.error) throw up.error;
            payload.a = { path, name: m.att.name, mime: f.type || m.att.mime, size: f.size, dur: dur || null, key, iv }; attach = [{ path, name: "encrypted", mime: "application/octet-stream", size: ct.byteLength, dur: dur || null }];
          }
          const body = pk ? await encryptFor(peer.id, payload) : null;
          // without a recipient key there is nothing to encrypt to, so text goes as plain text and the chat says so
          const sendBody = body || (type === "text" ? text : JSON.stringify(payload)), ver = body ? 1 : 0;
          const r = await rpc("send_chat", { p_conv: id, p_body: sendBody, p_type: type, p_client: client, p_version: ver, p_attach: attach });
          m.id = r.id; m.status = "sent"; if (m.att && payload.a) { m.att = { ...m.att, ...payload.a }; } S.previews[id] = type === "image" ? "📷 Photo" : type === "audio" ? "🎤 Voice note" : type === "file" ? "📎 " + (m.att?.name || "File") : text;
          const c = S.byId.get(id); if (c) { c.last_message_at = m.at; c.preview = S.previews[id]; }
        } catch (e) { console.error(e); m.status = "failed"; m.retry = run; }
        refreshOne(m);
      };
      m.retry = run; run();
    }
    async function shrink(file) { if (!file.type.startsWith("image/") || file.type === "image/gif") return file; try { const bmp = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s); cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); return await new Promise((r) => cv.toBlob((b) => r(b ? new File([b], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file), "image/jpeg", 0.82)); } catch { return file; } }
    document.getElementById("fileIn").addEventListener("change", (e) => { [...e.target.files].slice(0, 5).forEach((f) => { if (f.size > 25 * 1048576) return toast(`${f.name} is over 25 MB.`); const type = f.type.startsWith("image/") ? "image" : "file"; push({ type, file: f }); }); e.target.value = ""; });

    /* ---- voice notes ---- */
    micBtn.addEventListener("click", async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Voice notes aren't supported in this browser.");
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast("Allow microphone access to send voice notes."); }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((x) => MediaRecorder.isTypeSupported(x)) || "", rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [], t0 = Date.now(); let cancelled = false;
      rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); clearInterval(tick); document.getElementById("compRow").hidden = false; document.getElementById("compSec").hidden = true; if (cancelled) return; const dur = Date.now() - t0; if (dur < 500) return; const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" }); push({ type: "audio", blob, dur }); };
      rec.start(); const sec = document.getElementById("compSec"); document.getElementById("compRow").hidden = true; sec.hidden = false;
      sec.innerHTML = `<button class="ib" id="recX" aria-label="Cancel">${si("trash")}</button><span class="recdot"></span><b id="recT">0:00</b><span class="mut" style="flex:1">Recording…</span><button class="ib send" id="recS" aria-label="Send voice note">${si("send")}</button>`;
      const tick = setInterval(() => { const e = document.getElementById("recT"); if (e) e.textContent = fdur((Date.now() - t0) / 1000); }, 250);
      document.getElementById("recX").onclick = () => { cancelled = true; rec.stop(); }; document.getElementById("recS").onclick = () => rec.stop();
    });

    /* ---- calls ---- */
    document.getElementById("callA").onclick = () => startCall(T, false); document.getElementById("callV").onclick = () => startCall(T, true);

    T.destroy = () => { document.removeEventListener("visibilitychange", visH); try { sb.removeChannel(T.tch); } catch { /* ignore */ } clearTimeout(readT); };
    // safety net: if realtime is not connected, catch up every few seconds
    T.poll = setInterval(async () => { if (S.th !== T) return clearInterval(T.poll); if (S.rtState === "SUBSCRIBED" && document.visibilityState === "visible") return; try { const d = await rpc("chat_thread", { p_conv: id, p_limit: 20 }); for (const r of d.messages || []) { if (!T.msgs.some((x) => x.id === r.id || x.key === r.client)) append(await toLocal(r)); } T.peerRead(d.peer?.last_read_at); } catch { /* offline */ } }, 6000);
    input.focus({ preventScroll: true });
  }

  /* ======================================================================
     Calls (WebRTC; signalling over Realtime broadcast, media is peer to peer and encrypted)
     ====================================================================== */
  const ICE = (window.BAIDX_CONFIG && window.BAIDX_CONFIG.ICE_SERVERS) || [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
  let CALL = null, ringTimer = null, ringCtx = null;
  const ring = (on) => { clearInterval(ringTimer); if (!on) return; ringTimer = setInterval(() => { blip(); }, 1400); blip(); };
  function callUI(html) { let o = document.getElementById("callUI"); if (!o) { o = document.createElement("div"); o.id = "callUI"; o.className = "callui"; document.body.appendChild(o); } o.innerHTML = html; return o; }
  function endUI() { document.getElementById("callUI")?.remove(); ring(false); }
  async function startCall(T, video) {
    if (CALL) return toast("You're already in a call.");
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast("Calls aren't supported in this browser.");
    const callId = uid4(); let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: "user" } : false }); } catch { return toast(video ? "Allow camera and microphone access to start a video call." : "Allow microphone access to start a call."); }
    CALL = { id: callId, conv: T.id, peerId: T.peer.id, peerName: T.peer.name, peerPhoto: T.peer.photo, video, role: "caller", stream, t0: null };
    mountCall("Calling…"); prepareCall();
    const invite = sb.channel("inbox-" + T.peer.id, { config: { broadcast: { self: false } } });
    invite.subscribe((st) => { if (st === "SUBSCRIBED") { invite.send({ type: "broadcast", event: "call", payload: { t: "invite", callId, conv: T.id, from: me(), name: window.APP.state.me.profile?.full_name || window.APP.state.me.profile?.company_name || window.APP.state.me.profile?.business_name || "Someone", video } }); setTimeout(() => sb.removeChannel(invite), 2000); } });
    CALL.timeout = setTimeout(() => endCall("Missed", true), 45000);
  }
  function onCallSignal(p) {
    if (!p) return;
    if (p.t === "invite") {
      const c = S.byId.get(p.conv);
      if (!c || c.peer_id !== p.from) return;                 // only people I actually chat with can ring me
      if (CALL) { const ch = sb.channel("call-" + p.callId); ch.subscribe((st) => { if (st === "SUBSCRIBED") { ch.send({ type: "broadcast", event: "sig", payload: { t: "busy" } }); setTimeout(() => sb.removeChannel(ch), 1500); } }); return; }
      CALL = { id: p.callId, conv: p.conv, peerId: p.from, peerName: c.peer_name, peerPhoto: c.peer_photo, video: !!p.video, role: "callee", incoming: true };
      ring(true);
      const o = callUI(`<div class="cu-card">${av(c.peer_name, c.peer_photo, "xl")}<h3>${esc(c.peer_name)}</h3><p>Incoming ${p.video ? "video" : "voice"} call…</p><div class="cu-act"><button class="cu-btn bad" id="cuNo">${si("end", 24)}<span>Decline</span></button><button class="cu-btn ok" id="cuYes">${si("phone", 24)}<span>Accept</span></button></div></div>`);
      o.querySelector("#cuNo").onclick = () => { signalTo(p.callId, { t: "decline" }); closeCall(); };
      o.querySelector("#cuYes").onclick = async () => {
        ring(false);
        try { CALL.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: p.video ? { facingMode: "user" } : false }); } catch { toast("Allow microphone access to answer."); signalTo(p.callId, { t: "decline" }); return closeCall(); }
        mountCall("Connecting…"); prepareCall(); CALL.sig.send({ type: "broadcast", event: "sig", payload: { t: "accept" } });
      };
      CALL.autoMiss = setTimeout(() => closeCall(), 46000);
    }
  }
  function signalTo(callId, payload) { const ch = sb.channel("call-" + callId, { config: { broadcast: { self: false } } }); ch.subscribe((st) => { if (st === "SUBSCRIBED") { ch.send({ type: "broadcast", event: "sig", payload }); setTimeout(() => sb.removeChannel(ch), 1200); } }); }
  function mountCall(status) {
    const c = CALL, o = callUI(`<div class="cu-stage ${c.video ? "video" : ""}"><video id="cuRemote" autoplay playsinline></video><video id="cuLocal" autoplay playsinline muted></video><div class="cu-top">${av(c.peerName, c.peerPhoto, "lg")}<b>${esc(c.peerName)}</b><small id="cuStat">${esc(status)}</small></div><div class="cu-bar"><button class="cu-btn" id="cuMute" aria-label="Mute">${si("mute", 22)}</button>${c.video ? `<button class="cu-btn" id="cuCam" aria-label="Camera">${si("video", 22)}</button>` : ""}<button class="cu-btn bad" id="cuEnd" aria-label="End call">${si("end", 24)}</button></div></div>`);
    if (c.video && c.stream) o.querySelector("#cuLocal").srcObject = c.stream;
    o.querySelector("#cuEnd").onclick = () => endCall("Ended", true);
    o.querySelector("#cuMute").onclick = (e) => { const t = c.stream?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; e.currentTarget.classList.toggle("off", !t.enabled); } };
    o.querySelector("#cuCam")?.addEventListener("click", (e) => { const t = c.stream?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; e.currentTarget.classList.toggle("off", !t.enabled); } });
  }
  function prepareCall() {
    const c = CALL; c.pc = new RTCPeerConnection({ iceServers: ICE });
    c.stream.getTracks().forEach((t) => c.pc.addTrack(t, c.stream));
    c.pc.ontrack = (e) => { const r = document.getElementById("cuRemote"); if (r) { r.srcObject = e.streams[0]; r.play?.().catch(() => {}); } };
    c.pc.onicecandidate = (e) => { if (e.candidate) c.sig.send({ type: "broadcast", event: "sig", payload: { t: "ice", c: e.candidate } }); };
    c.pc.onconnectionstatechange = () => { const st = c.pc.connectionState; if (st === "connected") { clearTimeout(c.timeout); c.t0 = c.t0 || Date.now(); const s = document.getElementById("cuStat"); c.tick = setInterval(() => { if (s) s.textContent = fdur((Date.now() - c.t0) / 1000); }, 500); } if (["failed", "closed"].includes(st)) endCall("Ended", false); };
    c.sig = sb.channel("call-" + c.id, { config: { broadcast: { self: false } } });
    c.pendingIce = [];
    c.sig.on("broadcast", { event: "sig" }, async ({ payload: p }) => {
      try {
        if (p.t === "accept" && c.role === "caller") { clearTimeout(c.timeout); const s = document.getElementById("cuStat"); if (s) s.textContent = "Connecting…"; const off = await c.pc.createOffer(); await c.pc.setLocalDescription(off); c.sig.send({ type: "broadcast", event: "sig", payload: { t: "offer", d: off } }); }
        else if (p.t === "offer" && c.role === "callee") { await c.pc.setRemoteDescription(p.d); for (const x of c.pendingIce) await c.pc.addIceCandidate(x); c.pendingIce = []; const ans = await c.pc.createAnswer(); await c.pc.setLocalDescription(ans); c.sig.send({ type: "broadcast", event: "sig", payload: { t: "answer", d: ans } }); }
        else if (p.t === "answer" && c.role === "caller") { await c.pc.setRemoteDescription(p.d); for (const x of c.pendingIce) await c.pc.addIceCandidate(x); c.pendingIce = []; }
        else if (p.t === "ice") { if (c.pc.remoteDescription) await c.pc.addIceCandidate(p.c); else c.pendingIce.push(p.c); }
        else if (p.t === "decline") endCall("Declined", false); else if (p.t === "busy") endCall("Busy", false); else if (p.t === "end") endCall("Ended", false);
      } catch (e) { console.error(e); }
    }).subscribe();
  }
  function closeCall() { if (!CALL) return; clearTimeout(CALL.timeout); clearTimeout(CALL.autoMiss); clearInterval(CALL.tick); try { CALL.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } try { CALL.pc?.close(); } catch { /* ignore */ } try { if (CALL.sig) sb.removeChannel(CALL.sig); } catch { /* ignore */ } CALL = null; endUI(); }
  async function endCall(reason, tell) {
    const c = CALL; if (!c) return;
    if (tell && c.sig) c.sig.send({ type: "broadcast", event: "sig", payload: { t: "end" } });
    const dur = c.t0 ? Math.round((Date.now() - c.t0) / 1000) : 0, caller = c.role === "caller", kind = c.video ? "video" : "voice";
    closeCall();
    if (caller) { // the caller logs the call in the chat so both people see it
      const text = dur ? `📞 ${kind[0].toUpperCase() + kind.slice(1)} call · ${fdur(dur)}` : reason === "Declined" ? `📞 ${kind[0].toUpperCase() + kind.slice(1)} call declined` : `📞 Missed ${kind} call`;
      rpc("send_chat", { p_conv: c.conv, p_body: text, p_type: "system", p_client: uid4(), p_version: 0, p_attach: [] }).catch(() => {});
    }
  }

  /* ======================================================================
     Wiring
     ====================================================================== */
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-chat]"); if (!el) return;
    if (el.dataset.chat === "backup") {
      window.FEAT.openSheet("Back up secure chat", `<p class="cap2">Choose a backup password. It encrypts your chat key before it is saved, so BAID X can never read it. <b>If you forget this password it cannot be recovered.</b></p><form id="bkf">${window.FEAT.fld("Backup password", `<input class="in" type="password" name="p" minlength="8" required autocomplete="new-password" />`, "At least 8 characters.")}<button class="btn-light" type="submit" style="width:100%">Save backup</button><div class="cap2 warnt" id="bke"></div></form>`);
      document.getElementById("bkf").onsubmit = async (e) => { e.preventDefault(); const btn = e.target.querySelector("button"); btn.disabled = true; try { await backupKeys(e.target.p.value); try { localStorage.setItem("baidx_bk_" + me(), "1"); } catch { /* private mode */ } window.FEAT.closeSheet(); window.BX.toast("Backup saved"); renderList(); } catch (er) { btn.disabled = false; document.getElementById("bke").textContent = "Couldn't save the backup. Try again."; } };
      return;
    }
    if (el.dataset.chat === "perm") { try { S.notifPerm = await Notification.requestPermission(); } catch { S.notifPerm = "denied"; } renderList(); }
  });
  window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/chat/")) closeThread(); });
  window.addEventListener("baidx:member", async () => { try { await loadConvs(); startRealtime(); syncNav(); ensureKeys().catch(() => {}); } catch { /* ignore */ } });
  window.CHAT = { list, thread, backupKeys, ensureKeys, status: () => ({ rt: S.rtState, keys: !!K.ring }) };
  window.MARKET = Object.assign(window.MARKET || {}, { chatsList: list });
  window.DASH.register("chat", thread);
})();
