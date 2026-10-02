/* BAID X marketplace features: chats, wallet requests, posting jobs, supplier catalog, and the company
   payments / equipment / materials pages. Writes go through row-level security or server functions. */
(() => {
  "use strict";
  const { esc, pretty, icon, ago, money, JOB_CATS, REGIONS } = window.BX;
  const U = () => window.DASH.ui;
  const F = () => window.FEAT;
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const av = (name, photo, cls = "") => `<span class="av ${cls}" ${photo ? `style="background-image:url('${esc(photo)}')"` : ""}>${photo ? "" : esc(initials(name))}</span>`;
  const busy = (b, on, l) => F().busyBtn(b, on, l);

  /* ======================================================================
     Chats
     ====================================================================== */
  async function chatsList(box, c) {
    box.innerHTML = '<div class="skel" style="height:72px;margin-top:14px"></div>'.repeat(3);
    try {
      const list = (await F().rpc(c, "my_conversations")) || [];
      box.innerHTML = list.length
        ? `<div class="list">${list.map((x) => `<button class="row chat" data-go="chat/${esc(x.id)}">${av(x.peer_name, x.peer_photo)}<span class="tx"><b>${esc(x.peer_name)}</b><small>${esc(x.preview || "No messages yet")}</small></span><span class="meta2">${x.last_message_at ? esc(ago(x.last_message_at)) : ""}</span>${x.unread ? `<span class="badge">${x.unread}</span>` : ""}</button>`).join("")}</div>`
        : `<div class="empty">${icon("chat", 56)}<h2>No conversations yet</h2><p>Open someone's profile in Discover and tap Message to start a chat.</p><button class="btn-light" data-tab="${window.APP.state.me.role === "worker" ? "jobs" : "discover"}">${window.APP.state.me.role === "worker" ? "Browse jobs" : "Find people"}</button></div>`;
    } catch (e) { console.error(e); box.innerHTML = '<div class="state"><b>Couldn\'t load chats</b>Check your connection and try again.</div>'; }
  }

  let poll = null;
  const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
  const bubbles = (msgs) => msgs.length ? msgs.map((m) => `<div class="bub ${m.mine ? "me" : ""}"><p>${esc(m.body)}</p><small>${esc(new Date(m.at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" }))}</small></div>`).join("") : `<div class="cap2" style="text-align:center;margin:30px 0">Say hello 👋</div>`;
  async function chatView(c, id) {
    stopPoll();
    const t = await F().rpc(c, "conversation_thread", { p_conv: id });
    F().rpc(c, "mark_conversation_read", { p_conv: id }).catch(() => {});
    poll = setInterval(async () => {
      if (!location.hash.startsWith(`#/chat/${id}`)) return stopPoll();
      try { const n = await F().rpc(c, "conversation_thread", { p_conv: id }); const l = document.getElementById("msgList"); if (l && n.messages.length !== l.dataset.n) { const atEnd = l.scrollHeight - l.scrollTop - l.clientHeight < 80; l.innerHTML = bubbles(n.messages); l.dataset.n = n.messages.length; if (atEnd) l.scrollTop = l.scrollHeight; F().rpc(c, "mark_conversation_read", { p_conv: id }).catch(() => {}); } } catch { /* offline */ }
    }, 4000);
    setTimeout(() => { const l = document.getElementById("msgList"); if (l) l.scrollTop = l.scrollHeight; }, 60);
    return `<div class="chat-head"><button class="icon-btn" data-go="chats" aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg></button>${av(t.peer?.name, t.peer?.photo)}<span class="tx"><b>${esc(t.peer?.name || "Conversation")}</b><small>${esc(pretty(t.peer?.role || ""))}</small></span></div>
      <div class="msg-list" id="msgList" data-n="${t.messages.length}">${bubbles(t.messages)}</div>
      <form class="msg-form" data-mk-form="send" data-conv="${esc(id)}" autocomplete="off"><input class="in" name="body" placeholder="Write a message" maxlength="4000" required /><button class="btn-light sm" type="submit">Send</button></form>`;
  }

  /* ======================================================================
     Wallet
     ====================================================================== */
  const tone = { completed: "ok", approved: "ok", pending: "warn", pending_verification: "warn", under_review: "warn", processing: "warn", rejected: "bad", failed: "bad", cancelled: "bad" };
  async function walletView(c) {
    const { head, sec, empty, row } = U(), sb = c.sb;
    if (!["worker", "company", "project-manager", "business"].includes(c.role)) return head("Wallet") + empty("wallet", "No wallet", "Wallets are for professionals, companies, project managers and suppliers.");
    const [a, tx, dep, wd] = await Promise.all([
      sb.from("wallet_accounts").select("available_ghs,pending_ghs,lifetime_earned_ghs,lifetime_spent_ghs").eq("owner_id", c.uid).maybeSingle().then((r) => r.data || {}),
      sb.from("wallet_transactions").select("id,type,amount_ghs,net_ghs,status,description,created_at").eq("owner_id", c.uid).order("created_at", { ascending: false }).limit(30).then((r) => r.data || []),
      sb.from("payment_deposits").select("id,payment_ref,amount_ghs,status,admin_note,created_at").eq("owner_id", c.uid).order("created_at", { ascending: false }).limit(10).then((r) => r.data || []),
      sb.from("withdrawal_requests").select("id,public_id,amount_ghs,status,admin_note,created_at").eq("owner_id", c.uid).order("created_at", { ascending: false }).limit(10).then((r) => r.data || []),
    ]);
    const reqs = [...dep.map((d) => ({ k: "Deposit", ref: d.payment_ref, amt: d.amount_ghs, st: d.status, at: d.created_at, note: d.admin_note })), ...wd.map((w) => ({ k: "Withdrawal", ref: w.public_id, amt: w.amount_ghs, st: w.status, at: w.created_at, note: w.admin_note }))].sort((x, y) => new Date(y.at) - new Date(x.at));
    return head("Wallet") + `<div class="wallet"><small>Available balance</small><b>${money(a.available_ghs)}</b><div class="w-sub"><span>Pending <b>${money(a.pending_ghs)}</b></span><span>Earned <b>${money(a.lifetime_earned_ghs)}</b></span></div><div class="w-act"><button class="btn-light sm" data-mk="withdraw">Withdraw</button><button class="btn-light sm" data-mk="deposit">Add money</button></div></div>
      <p class="note">Payments are handled by Mobile Money for now. Your balance updates once BAID X confirms a payment.</p>
      ${reqs.length ? sec("Requests") + reqs.map((r) => `<div class="row"><span class="ic">${icon("pay", 17)}</span><span class="tx"><b>${esc(r.k)} · ${money(r.amt)}</b><small>${esc(r.ref)} · ${esc(ago(r.at))}${r.note ? " · " + esc(r.note) : ""}</small></span><span class="pill ${tone[r.st] || ""}">${esc(pretty(r.st))}</span></div>`).join("") : ""}
      ${sec("Activity")}` + (tx.length ? tx.map((t) => row(Number(t.amount_ghs) < 0 || t.type === "withdrawal" ? "pay" : "wallet", pretty(t.type) || "Transaction", `${t.description || ""} ${ago(t.created_at)}`.trim(), `<span class="amt">${money(t.net_ghs ?? t.amount_ghs)}</span>`, "")).join("") : empty("wallet", "No transactions yet", "Earnings, deposits and withdrawals will be listed here."));
  }

  /* ======================================================================
     Jobs (employers and companies)
     ====================================================================== */
  async function hiresView(c) {
    const { head, empty, row, pill, statusKind } = U(), col = c.role === "company" ? "company_id" : "employer_id";
    const { data } = await c.sb.from("jobs").select("id,title,status,city_town,daily_rate_ghs,workers_needed,created_at").eq(col, c.uid).order("created_at", { ascending: false }).limit(50);
    const jobs = data || [];
    return head(c.role === "company" ? "Job posts" : "Hires", `<button class="btn-light sm" data-go="post-job">Post a job</button>`) + (jobs.length ? jobs.map((j) => `<div class="row"><span class="ic">${icon("hire", 17)}</span><span class="tx"><b>${esc(j.title)}</b><small>${esc(j.city_town || "Ghana")}${j.daily_rate_ghs ? ` · ${money(j.daily_rate_ghs)}/day` : ""} · ${esc(ago(j.created_at))}</small></span><span class="pill ${j.status === "open" ? "ok" : ""}">${esc(pretty(j.status))}</span>${j.status === "open" ? `<button class="btn-dark sm" data-mk="close-job" data-id="${esc(j.id)}">Close</button>` : `<button class="btn-dark sm" data-mk="open-job" data-id="${esc(j.id)}">Reopen</button>`}</div>`).join("")
      : empty("hire", "No jobs yet", "Post a job and professionals can apply. You can also find a trade in Discover and message them.", `<button class="btn-light sm" data-go="post-job">Post a job</button>`));
  }
  async function postJobView(c) {
    const { head } = U(), F2 = F();
    return head("Post a job") + `<form class="pform" data-mk-form="post-job" autocomplete="off"><div class="fs"><h3>The job</h3>
      ${F2.fld("Job title", F2.inp("title", { req: true, max: 100, ph: "e.g. Electrician for a 3-bedroom house" }))}
      ${F2.fld("Details", F2.area("description", { ph: "What needs doing? Materials, access, anything workers should know.", rows: 4 }))}
      ${F2.fld("Trade needed", F2.sel("job_category_id", [["", "Choose a trade"], ...JOB_CATS.map((j) => [j.id, j.name])], ""))}</div>
      <div class="fs"><h3>Where and when</h3><div class="two-col">${F2.fld("Region", F2.sel("region", [["", "Choose"], ...REGIONS.map((r) => [r, r])], ""))}${F2.fld("Town", F2.inp("city_town", { max: 60 }))}</div>
      <div class="two-col">${F2.fld("Start date", F2.inp("starts_on", { type: "date" }))}${F2.fld("End date", F2.inp("ends_on", { type: "date" }))}</div></div>
      <div class="fs"><h3>Pay and people</h3><div class="two-col">${F2.fld("Daily rate (GH₵)", F2.inp("daily_rate_ghs", { type: "number", min: 0, step: "0.01" }))}${F2.fld("Workers needed", F2.inp("workers_needed", { type: "number", min: 1, val: 1 }))}</div></div>
      <button class="btn-light" type="submit" style="width:100%">Publish job</button></form>`;
  }

  /* ======================================================================
     Business catalog
     ====================================================================== */
  async function catalogView(c, arg) {
    const { head, segs, empty } = U(), seg = arg === "equipment" ? "equipment" : "products", tbl = seg === "products" ? "business_products" : "business_equipment";
    const { data } = await c.sb.from(tbl).select("*").eq("business_id", c.uid).order("created_at", { ascending: false }).limit(60);
    const items = data || [];
    return head("Catalog", `<button class="btn-light sm" data-mk="add-item" data-seg="${seg}">${seg === "products" ? "Add product" : "Add equipment"}</button>`) + segs([["products", "Products", "catalog"], ["equipment", "Equipment", "catalog/equipment"]], seg)
      + (items.length ? items.map((i) => `<div class="row">${i.image_urls?.[0] ? `<span class="av sq" style="background-image:url('${esc(i.image_urls[0])}')"></span>` : `<span class="ic">${icon(seg === "products" ? "box" : "equip", 17)}</span>`}<span class="tx"><b>${esc(i.name)}</b><small>${esc(i.category || "Uncategorised")}${(i.price ?? i.daily_rate) != null ? ` · ${money(i.price ?? i.daily_rate)}${seg === "equipment" ? "/day" : ""}` : ""}</small></span><span class="pill ${i.available === false ? "" : "ok"}">${i.available === false ? "Hidden" : "Listed"}</span><button class="btn-dark sm" data-mk="toggle-item" data-seg="${seg}" data-id="${esc(i.id)}" data-on="${i.available === false ? "1" : "0"}">${i.available === false ? "Show" : "Hide"}</button><button class="btn-dark sm" data-mk="del-item" data-seg="${seg}" data-id="${esc(i.id)}">Delete</button></div>`).join("")
        : empty(seg === "products" ? "box" : "equip", `No ${seg} listed`, "Add what you supply so companies and clients can find and request it.", `<button class="btn-light sm" data-mk="add-item" data-seg="${seg}">${seg === "products" ? "Add product" : "Add equipment"}</button>`));
  }

  /* ======================================================================
     Company resources: payments, equipment, materials
     ====================================================================== */
  async function paymentsView(c) {
    const { head, empty } = U(), list = (await F().rpc(c, "company_payments").catch(() => [])) || [];
    const total = list.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
    return head("Payments") + `<div class="stats"><div class="stat"><b>${money(total)}</b><small>Paid out</small></div><div class="stat"><b>${list.filter((p) => ["pending", "approved"].includes(p.status)).length}</b><small>Waiting</small></div></div><p class="note">Money moves by Mobile Money for now. Each payment is recorded against its project as a paper trail.</p>`
      + (list.length ? list.map((p) => `<button class="row" data-open-project="${esc(p.project_id)}"><span class="ic">${icon("pay", 17)}</span><span class="tx"><b>${esc(p.payee)} · ${money(p.amount)}</b><small>${esc(p.project)} · ${esc(p.purpose || pretty(p.type))} · ${esc(ago(p.created_at))}</small></span><span class="pill ${p.status === "paid" ? "ok" : p.status === "rejected" ? "bad" : "warn"}">${esc(pretty(p.status))}</span></button>`).join("")
        : empty("pay", "No payments yet", "Payments recorded or requested inside your projects appear here.", `<button class="btn-light sm" data-go="projects">Open projects</button>`));
  }
  const supplierView = (kind) => async (c) => {
    const { head, empty } = U(), list = (await F().rpc(c, "supplier_catalog", { p_kind: kind }).catch(() => [])) || [], isEq = kind === "equipment";
    return head(isEq ? "Equipment" : "Materials") + `<p class="sub2">${isEq ? "Machines and tools you can rent or buy from suppliers." : "Materials from suppliers across Ghana."}</p>`
      + (list.length ? list.map((i) => `<div class="dcard"><h4><span>${esc(i.name)}</span><span class="amb">${isEq ? (i.daily_rate ? money(i.daily_rate) + "/day" : i.sale_price ? money(i.sale_price) : "") : (i.price != null ? money(i.price) : "")}</span></h4><p class="cap2">${esc(i.business)} · ${esc(i.region || "Ghana")}${i.category ? " · " + esc(i.category) : ""}</p>${i.description ? `<p class="cap2">${esc(i.description)}</p>` : ""}<button class="btn-light sm" data-fx="message" data-id="${esc(i.business_id)}" data-name="${esc(i.business)}">Message supplier</button></div>`).join("")
        : empty(isEq ? "equip" : "mat", `No ${isEq ? "equipment" : "materials"} listed yet`, "Suppliers list their products here. Check back soon, or find suppliers in Discover.", `<button class="btn-light sm" data-tab="discover">Find suppliers</button>`));
  };

  /* ---------- actions ---------- */
  const MK = {
    deposit: async (c) => {
      const { data: prov } = await c.sb.from("payment_providers").select("display_name,account_number,account_name,instructions").eq("is_active", true).limit(1);
      const p = prov?.[0];
      F().openSheet("Add money", `${p ? `<div class="req"><small>Send by ${esc(p.display_name)}</small><p><b>${esc(p.account_number)}</b> · ${esc(p.account_name)}</p><p class="cap2">${esc(p.instructions)}</p></div>` : `<p class="cap2">Mobile Money details will be shown here.</p>`}
        <form data-mk-form="deposit">${F().fld("Amount sent (GH₵)", F().inp("amount", { type: "number", min: 1, step: "0.01", req: true }))}${F().fld("Your Mobile Money name or reference", F().inp("note", { max: 120 }))}
        <div class="doc"><span class="tx"><b>Payment screenshot</b><small>Optional, helps us confirm faster</small></span><label class="btn-dark sm filebtn">Upload<input type="file" name="proof" accept="image/*" hidden /></label></div>
        <button class="btn-light" type="submit" style="width:100%">I have sent it</button></form>`);
    },
    withdraw: (c) => F().openSheet("Withdraw", `<form data-mk-form="withdraw">${F().fld("Amount (GH₵)", F().inp("amount", { type: "number", min: 1, step: "0.01", req: true }))}${F().fld("Network", F().sel("network", [["MTN MoMo", "MTN MoMo"], ["Telecel Cash", "Telecel Cash"], ["AirtelTigo Money", "AirtelTigo Money"]], ""))}${F().fld("Mobile Money number", F().inp("account", { type: "tel", req: true, val: "" }))}${F().fld("Name on the account", F().inp("name", { req: true, max: 80 }))}<p class="cap2">The amount is held while we pay it out, and returned to your balance if it can't be paid.</p><button class="btn-light" type="submit" style="width:100%">Request withdrawal</button></form>`),
    "close-job": async (c, el) => { const { error } = await c.sb.from("jobs").update({ status: "closed" }).eq("id", el.dataset.id); if (error) throw error; window.APP.route(); },
    "open-job": async (c, el) => { const { error } = await c.sb.from("jobs").update({ status: "open" }).eq("id", el.dataset.id); if (error) throw error; window.APP.route(); },
    "add-item": (c, el) => {
      const eq = el.dataset.seg === "equipment", f = F();
      f.openSheet(eq ? "Add equipment" : "Add product", `<form data-mk-form="add-item" data-seg="${eq ? "equipment" : "products"}">${f.fld("Name", f.inp("name", { req: true, max: 100 }))}${f.fld("Category", f.inp("category", { max: 60, ph: eq ? "e.g. Concrete mixers" : "e.g. Cement" }))}
        ${eq ? `<div class="two-col">${f.fld("Daily rate (GH₵)", f.inp("daily_rate", { type: "number", min: 0, step: "0.01" }))}${f.fld("Sale price (GH₵)", f.inp("sale_price", { type: "number", min: 0, step: "0.01" }))}</div>${f.fld("Condition", f.sel("condition", [["good", "Good"], ["new", "New"], ["fair", "Fair"]], "good"))}`
        : `<div class="two-col">${f.fld("Price (GH₵)", f.inp("price", { type: "number", min: 0, step: "0.01" }))}${f.fld("In stock", f.inp("quantity", { type: "number", min: 0 }))}</div>${f.fld("Description", f.area("description", { max: 400 }))}`}
        <div class="doc"><span class="tx"><b>Photo</b><small>Optional</small></span><label class="btn-dark sm filebtn">Upload<input type="file" name="image" accept="image/*" hidden /></label></div>
        <button class="btn-light" type="submit" style="width:100%">Save</button></form>`);
    },
    "toggle-item": async (c, el) => { const t = el.dataset.seg === "equipment" ? "business_equipment" : "business_products"; const { error } = await c.sb.from(t).update({ available: el.dataset.on === "1" }).eq("id", el.dataset.id); if (error) throw error; window.APP.route(); },
    "del-item": async (c, el) => { if (!confirm("Delete this listing?")) return; const t = el.dataset.seg === "equipment" ? "business_equipment" : "business_products"; const { error } = await c.sb.from(t).delete().eq("id", el.dataset.id); if (error) throw error; window.APP.route(); },
  };
  window.FX = Object.assign(window.FX || {}, {
    message: async (c, el) => { const cid = await F().rpc(c, "start_conversation", { p_other: el.dataset.id, p_subject: null }); F().closeSheet(); c.go(`chat/${cid}`); },
  });

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-mk]"); if (!el || !window.APP?.state.me?.role) return;
    const fn = MK[el.dataset.mk]; if (!fn) return;
    e.preventDefault(); e.stopPropagation();
    try { await fn(window.APP.dashCtx(), el); } catch (err) { F().fail(window.APP.dashCtx(), err); }
  }, true);

  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-mk-form]"); if (!form || !window.APP?.state.me?.role) return;
    e.preventDefault();
    const c = window.APP.dashCtx(), k = form.dataset.mkForm, d = Object.fromEntries(new FormData(form)), btn = form.querySelector('[type="submit"]'), f = F();
    busy(btn, true, k === "send" ? "…" : "Please wait…");
    try {
      if (k === "send") { const body = d.body.trim(); if (!body) { busy(btn, false); return; } form.querySelector("input").value = ""; await f.rpc(c, "send_message", { p_conv: form.dataset.conv, p_body: body }); const t = await f.rpc(c, "conversation_thread", { p_conv: form.dataset.conv }); const l = document.getElementById("msgList"); l.innerHTML = bubbles(t.messages); l.dataset.n = t.messages.length; l.scrollTop = l.scrollHeight; }
      else if (k === "deposit") { const file = form.querySelector('[name="proof"]').files[0]; const proof = file ? await f.upload(c, "payment-proofs", file, "proof") : null; const ref = await f.rpc(c, "request_deposit", { p_amount: +d.amount, p_note: d.note || null, p_proof_path: proof }); f.closeSheet(); c.toast(`Request sent. Reference ${ref}`); window.APP.route(); }
      else if (k === "withdraw") { const ref = await f.rpc(c, "request_withdrawal", { p_amount: +d.amount, p_network: d.network, p_account: d.account, p_name: d.name }); f.closeSheet(); c.toast(`Withdrawal requested. Reference ${ref}`); window.APP.route(); }
      else if (k === "post-job") {
        const row = { title: d.title.trim(), description: d.description || null, job_category_id: d.job_category_id || null, region: d.region || null, city_town: d.city_town || null, starts_on: d.starts_on || null, ends_on: d.ends_on || null, daily_rate_ghs: d.daily_rate_ghs ? +d.daily_rate_ghs : null, workers_needed: +d.workers_needed || 1, status: "open", [c.role === "company" ? "company_id" : "employer_id"]: c.uid };
        const { error } = await c.sb.from("jobs").insert(row); if (error) throw error; c.toast("Job published"); c.go("hires");
      } else if (k === "add-item") {
        const eq = form.dataset.seg === "equipment", file = form.querySelector('[name="image"]').files[0];
        const img = file ? f.publicUrl(c, "listing-images", await f.upload(c, "listing-images", file, "item")) : null;
        const row = eq ? { business_id: c.uid, name: d.name, category: d.category || null, daily_rate: d.daily_rate ? +d.daily_rate : null, sale_price: d.sale_price ? +d.sale_price : null, condition: d.condition, available: true, status: "active", image_urls: img ? [img] : [] }
          : { business_id: c.uid, name: d.name, category: d.category || null, price: d.price ? +d.price : null, quantity: d.quantity ? +d.quantity : null, description: d.description || null, listing_type: "sale", available: true, status: "active", image_urls: img ? [img] : [] };
        const { error } = await c.sb.from(eq ? "business_equipment" : "business_products").insert(row); if (error) throw error; f.closeSheet(); c.toast("Saved"); window.APP.route();
      }
    } catch (err) { f.fail(c, err); }
    if (k !== "send") busy(btn, false);
  });

  window.MARKET = { chatsList };
  window.DASH.register("chat", chatView);
  window.DASH.register("wallet", walletView);
  window.DASH.register("hires", hiresView);
  window.DASH.register("post-job", postJobView);
  window.DASH.register("catalog", catalogView);
  window.DASH.register("payments", paymentsView);
  window.DASH.register("equipment", supplierView("equipment"));
  window.DASH.register("materials", supplierView("products"));
})();
