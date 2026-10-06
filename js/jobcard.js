/* BAID X Digital Job Card: one record per hired job (scope, materials, photo evidence, payments, sign-off).
   Opens at #/engagement/<id> for the worker, the client and, on project jobs, the project's PM.
   Every change is a job_card_* database function; sign-off by everyone releases the escrow there, never here. */
(() => {
  "use strict";
  const { esc, icon } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const money = (n) => `GH₵${(Number(n) || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); };
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const val = (n) => document.querySelector(`#sheetRoot [name="${n}"]`)?.value ?? "";
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
  const ST = { active: ["In progress", "warn"], submitted: ["Awaiting sign-off", "warn"], released: ["Complete", "ok"], disputed: ["In dispute", "bad"], refunded: ["Refunded", ""], cancelled: ["Cancelled", ""] };
  const pill = (s) => `<span class="pill ${ST[s]?.[1] || ""}">${esc(ST[s]?.[0] || s)}</span>`;
  const STAGES = [["before", "Before"], ["during", "During"], ["after", "After"]];
  const PARTY = { worker: "Worker", client: "Client", pm: "PM" };
  const friendly = (e) => String(e?.message || "Something went wrong. Please try again.").replace(/^./, (m) => m.toUpperCase());
  const pct = (d, t) => (t > 0 ? Math.round((d / t) * 100) : 0);
  const card = { id: null, data: null };

  async function photoUrls(c, photos) {
    if (!photos.length) return {};
    const { data } = await c.sb.storage.from("job-cards").createSignedUrls(photos.map((p) => p.path), 3600);
    return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }

  async function view(c, id) {
    const { head, empty, bar } = U();
    let d;
    try { d = await rpc(c, "job_card", { p_eng: id }); } catch { d = null; }
    const back = c.role === "worker" ? "work" : c.role === "individual-employer" ? "hires" : "home";
    if (!d) return head("Job card") + empty("work", "Not found", "This job card doesn't exist or isn't yours.", `<button class="btn-light sm" data-go="${back}">Back</button>`);
    card.id = id; card.data = d;
    const me = d.my_party, live = ["active", "submitted"].includes(d.status), edit = live && !d.locked;
    const canProgress = edit && (me === "worker" || me === "pm");
    const urls = await photoUrls(c, d.photos || []);

    const hero = `<div class="es-card jc-hero"><div class="jc-no"><span>JOB #BX-${esc(d.card_no)}</span>${pill(d.status)}</div>
      <h2 class="jc-title">${esc(d.title)}</h2>
      <div class="wl-kv"><span>Client</span><b>${esc(d.client_name || "Client")}</b></div>
      <div class="wl-kv"><span>Worker</span><b>${esc(d.worker_name || "Worker")}</b></div>
      ${d.needs_pm ? `<div class="wl-kv"><span>Project manager</span><b>${esc(d.pm_name || "PM")}</b></div>` : ""}
      ${d.project ? `<div class="wl-kv"><span>Project</span><b>${esc(d.project)}</b></div>` : ""}
      <div class="wl-kv"><span>Location</span><b>${esc(d.location || "Ghana")}</b></div>
      <div class="jc-pct"><span>Complete</span><b>${d.progress}%</b></div>${bar(d.progress)}</div>`;

    const items = (d.items || []).map((it) => {
      const done = it.done >= it.total, p = pct(it.done, it.total);
      const sub = it.total > 1 ? `${num(it.done)} of ${num(it.total)} done` : done ? "Done" : "Not done yet";
      const rm = edit && (it.mine || me === "client" || me === "pm") ? `<button class="jc-x" data-jc="item-rm" data-id="${esc(it.id)}" aria-label="Remove ${esc(it.title)}">${icon("plus", 14)}</button>` : "";
      const tag = canProgress ? "button" : "div";
      return `<div class="jc-row"><${tag} class="jc-main" ${canProgress ? `data-jc="item-prog" data-id="${esc(it.id)}"` : ""}><span class="ic ${done ? "ok" : ""}">${icon(done ? "task" : "cal", 16)}</span><span class="tx"><b>${esc(it.title)}</b><small>${esc(sub)}</small></span><span class="jc-v">${p}%</span></${tag}>${rm}</div>`;
    }).join("");
    const scope = `<div class="es-card jc-sec"><h4>Scope</h4>${items || `<p class="jc-none">No scope items yet. ${edit ? "Add what the job covers, for example 12 sockets or DB installation." : ""}</p>`}
      ${edit ? `<button class="jc-add" data-jc="item-add">${icon("plus", 16)} Add scope item</button>` : ""}${canProgress && items ? `<p class="jc-hint">Tap an item to record how much is done.</p>` : ""}</div>`;

    const mats = (d.materials || []).map((m) => {
      const unit = m.unit ? ` ${esc(m.unit)}` : "", p = pct(m.used, m.required);
      const rm = edit && (m.mine || me === "client" || me === "pm") ? `<button class="jc-x" data-jc="mat-rm" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">${icon("plus", 14)}</button>` : "";
      const tag = canProgress ? "button" : "div";
      return `<div class="jc-row"><${tag} class="jc-mat" ${canProgress ? `data-jc="mat-used" data-id="${esc(m.id)}"` : ""}><span class="jc-mt"><b>${esc(m.name)}</b><small><b>${num(m.used)}${unit}</b> used of ${num(m.required)}${unit}</small></span>${bar(Math.min(100, p))}</${tag}>${rm}</div>`;
    }).join("");
    const materials = `<div class="es-card jc-sec"><h4>Materials</h4>${mats || `<p class="jc-none">No materials listed yet.</p>`}
      ${edit ? `<button class="jc-add" data-jc="mat-add">${icon("plus", 16)} Add material</button>` : ""}${canProgress && mats ? `<p class="jc-hint">Tap a material to log how much was used.</p>` : ""}</div>`;

    const stage = ([k, l]) => {
      const list = (d.photos || []).filter((p) => p.stage === k);
      const pics = list.map((p) => `<a class="jc-pic" href="${esc(urls[p.path] || "#")}" target="_blank" rel="noopener" style="background-image:url('${esc(urls[p.path] || "")}')"><em>${esc(when(p.taken_at))}</em></a>`).join("");
      return `<div class="jc-stage"><div class="jc-st-h"><b>${l}</b><small>${list.length} photo${list.length === 1 ? "" : "s"}</small>${live ? `<label class="jc-up">${icon("plus", 14)} Add<input type="file" accept="image/*" capture="environment" data-jc-up="${k}" hidden></label>` : ""}</div>${pics ? `<div class="jc-pics">${pics}</div>` : `<div class="jc-nopic">No ${l.toLowerCase()} photos</div>`}</div>`;
    };
    const evidence = `<div class="es-card jc-sec"><h4>Evidence</h4>${STAGES.map(stage).join("")}<p class="jc-hint">BAID X stamps each photo with the time it is added. Photos can't be edited later.</p></div>`;

    const done = d.status === "released";
    const payments = `<div class="es-card jc-sec"><h4>Payments</h4>
      <div class="wl-kv"><span>Contract</span><b>${money(d.amount)}</b></div>
      <div class="wl-kv"><span>Paid to worker</span><b>${money(d.paid)}</b></div>
      <div class="wl-kv"><span>Held in escrow</span><b>${money(d.held)}</b></div>
      ${done && me === "worker" && d.net != null ? `<div class="wl-kv"><span>BAID X fee</span><b>− ${money(d.commission)}</b></div><div class="wl-kv"><span>You received</span><b><span class="g">${money(d.net)}</span></b></div>` : ""}
      <div class="jc-pay"><i style="flex:${Number(d.paid) || 0}"></i><i style="flex:${Number(d.held) || 0}"></i></div>
      <p class="jc-hint">${done ? "Paid in full." : d.status === "disputed" ? "Frozen while BAID X reviews the dispute." : live ? `Released when ${d.needs_pm ? "the worker, the client and the PM" : "the worker and the client"} have all signed off, or 3 days after the worker signs off if nobody responds.` : "This job did not complete."}</p></div>`;

    const signed = Object.fromEntries((d.signoffs || []).map((s) => [s.party, s]));
    const parties = ["worker", "client", ...(d.needs_pm ? ["pm"] : [])];
    const tile = (p) => { const s = signed[p]; const name = p === "worker" ? d.worker_name : p === "client" ? d.client_name : d.pm_name; return `<div class="jc-sign ${s ? "on" : ""}"><span class="ic ${s ? "ok" : ""}">${icon(s ? "task" : "cal", 16)}</span><b>${PARTY[p]}</b><small>${esc(name || PARTY[p])}</small><small>${s ? esc(when(s.signed_at)) : "Waiting"}</small></div>`; };
    let signBtn = "";
    if (live && me && !signed[me]) {
      const others = parties.filter((p) => p !== me && !signed[p]);
      const label = me === "worker" ? "Sign off: work complete" : others.length ? "Sign off" : "Sign off and release payment";
      signBtn = `<button class="es-btn" data-jc="sign">${icon("task", 18)} ${label}</button>`;
    }
    const completion = `<div class="es-card jc-sec"><h4>Completion</h4><div class="jc-signs" style="grid-template-columns:repeat(${parties.length},1fr)">${parties.map(tile).join("")}</div>${signBtn ? `<div class="es-acts">${signBtn}</div>` : ""}</div>`;

    const notes = (d.submit_note ? `<div class="es-quote"><small>Note from worker</small><p>${esc(d.submit_note)}</p></div>` : "")
      + (d.status === "disputed" ? `<div class="es-warn">${icon("lock", 18)}<div><b>This is in dispute.</b> The money stays safe in escrow while BAID X reviews it. ${esc(d.dispute_reason || "")}</div></div>` : "")
      + (d.resolution_note ? `<div class="es-quote"><small>BAID X decision</small><p>${esc(d.resolution_note)}</p></div>` : "")
      + (d.status === "refunded" ? `<div class="es-quote"><small>Refunded</small><p>${me === "worker" ? "This job was cancelled and the client was refunded." : "The money was returned to your wallet."}</p></div>` : "");

    let more = "";
    if (live && (me === "worker" || me === "client")) {
      const cancel = d.status === "active" && !(d.signoffs || []).length ? `<button class="es-btn ghost" data-es="cancel" data-id="${esc(d.id)}">${me === "worker" ? "Decline job" : "Cancel and refund"}</button>` : "";
      more = `<div class="${cancel ? "es-2" : "es-acts"}"><button class="es-btn ghost" data-es="dispute" data-id="${esc(d.id)}">Report a problem</button>${cancel}</div>`;
    }

    return head("Job card", `<button class="btn-dark sm" data-go="${back}">Back</button>`) + hero + scope + materials + evidence + payments + completion + notes + more
      + `<p class="es-fine">Ref ${esc(d.public_id)}</p>`;
  }

  /* ---- sheets ---- */
  const item = (id) => (card.data?.items || []).find((x) => x.id === id);
  const mat = (id) => (card.data?.materials || []).find((x) => x.id === id);
  const errBox = `<p class="wl-err" id="jcE"></p>`;
  function signSheet() {
    const d = card.data, me = d.my_party;
    const signed = new Set((d.signoffs || []).map((s) => s.party)), need = ["worker", "client", ...(d.needs_pm ? ["pm"] : [])].filter((p) => p !== me && !signed.has(p));
    const text = me === "worker" ? "Signing off tells the client the work is complete. The card locks so the scope and materials can't change, and the client has 3 days to sign off before payment releases automatically."
      : need.length ? `Your sign-off is recorded. Payment is released once the ${need.map((p) => PARTY[p].toLowerCase()).join(" and the ")} also sign${need.length > 1 ? "" : "s"} off.`
      : "Everyone else has signed off, so this releases the payment to the worker. You can't undo it, so only sign off if you're happy with the work.";
    F().openSheet("Sign off", `<p class="es-s">${esc(text)}</p>${me === "worker" ? F().fld("Note to the client (optional)", F().area("note", { rows: 3, max: 1000, ph: "What was completed, anything they should check." })) : ""}${errBox}<button class="es-btn" data-jc="sign-ok">${icon("task", 18)} Sign off</button><button class="es-btn ghost" data-close style="margin-top:8px">Not now</button>`);
  }
  const itemAddSheet = () => F().openSheet("Add scope item", `<p class="es-s">What the job covers. Use a quantity when it can be counted, for example 12 sockets.</p>${F().fld("Item", F().inp("title", { max: 120, ph: "e.g. Socket installation" }))}${F().fld("Quantity", F().inp("qty", { type: "number", min: 1, step: 1, val: 1 }))}${errBox}<button class="es-btn" data-jc="item-add-ok">Add item</button>`);
  const itemProgSheet = (it) => F().openSheet(it.title, `<p class="es-s">How many of ${num(it.total)} are done?</p>${F().fld("Done", F().inp("done", { type: "number", min: 0, step: 1, val: it.done }))}${errBox}<button class="es-btn" data-jc="item-prog-ok" data-id="${esc(it.id)}">Save progress</button>`);
  const matAddSheet = () => F().openSheet("Add material", `<p class="es-s">List what the job needs. The worker logs how much is used as the work goes on.</p>${F().fld("Material", F().inp("name", { max: 80, ph: "e.g. 2.5 mm cable" }))}<div class="two-col">${F().fld("Required", F().inp("req", { type: "number", min: 0.01, step: "0.01" }))}${F().fld("Unit (optional)", F().inp("unit", { max: 12, ph: "m, bags, pcs" }))}</div>${errBox}<button class="es-btn" data-jc="mat-add-ok">Add material</button>`);
  const matUsedSheet = (m) => F().openSheet(m.name, `<p class="es-s">How much has been used so far? Required: ${num(m.required)}${m.unit ? " " + esc(m.unit) : ""}.</p>${F().fld(`Used${m.unit ? ` (${m.unit})` : ""}`, F().inp("used", { type: "number", min: 0, step: "0.01", val: m.used }))}${errBox}<button class="es-btn" data-jc="mat-used-ok" data-id="${esc(m.id)}">Save</button>`);

  async function shrink(file) {
    try {
      const bmp = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      return await new Promise((r) => cv.toBlob((b) => r(b || file), "image/jpeg", 0.82));
    } catch { return file; }
  }
  async function addPhoto(c, stage, file) {
    if (!file || !card.id) return;
    if (!/^image\//.test(file.type)) return c.toast("Choose a photo.");
    c.toast("Uploading photo…");
    try {
      const blob = await shrink(file);
      if (blob.size > 10 * 1024 * 1024) throw new Error("That photo is over 10 MB.");
      const path = `${card.id}/${c.uid}/${Date.now()}.jpg`;
      const up = await c.sb.storage.from("job-cards").upload(path, blob, { contentType: "image/jpeg", upsert: false }); if (up.error) throw up.error;
      await rpc(c, "job_card_photo_add", { p_eng: card.id, p_stage: stage, p_path: path });
      c.toast("Photo added."); window.APP.route();
    } catch (e) { c.toast(friendly(e)); }
  }

  const run = async (c, btn, fn, ok) => {
    const err = document.getElementById("jcE"); if (err) err.textContent = "";
    btn.disabled = true; btn.classList.add("busy");
    try { const r = await fn(); F().closeSheet(); c.toast(typeof ok === "function" ? ok(r) : ok); window.APP.route(); }
    catch (e) { if (err) err.textContent = friendly(e); else c.toast(friendly(e)); btn.disabled = false; btn.classList.remove("busy"); }
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-jc]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), a = el.dataset.jc, id = el.dataset.id;
    e.preventDefault(); e.stopPropagation();
    if (a === "sign") return signSheet();
    if (a === "sign-ok") return run(c, el, () => rpc(c, "job_card_sign", { p_eng: card.id, p_note: val("note") || null }), (r) => (r?.released ? "Signed off. The payment was released." : "Signed off."));
    if (a === "item-add") return itemAddSheet();
    if (a === "item-add-ok") return run(c, el, () => rpc(c, "job_card_item_add", { p_eng: card.id, p_title: val("title"), p_qty: parseInt(val("qty"), 10) || 1 }), "Item added.");
    if (a === "item-prog") return item(id) && itemProgSheet(item(id));
    if (a === "item-prog-ok") return run(c, el, () => rpc(c, "job_card_item_progress", { p_id: id, p_done: parseInt(val("done"), 10) }), "Progress saved.");
    if (a === "item-rm") return run(c, el, () => rpc(c, "job_card_item_remove", { p_id: id }), "Item removed.");
    if (a === "mat-add") return matAddSheet();
    if (a === "mat-add-ok") return run(c, el, () => rpc(c, "job_card_material_add", { p_eng: card.id, p_name: val("name"), p_unit: val("unit"), p_required: parseFloat(val("req")) }), "Material added.");
    if (a === "mat-used") return mat(id) && matUsedSheet(mat(id));
    if (a === "mat-used-ok") return run(c, el, () => rpc(c, "job_card_material_used", { p_id: id, p_used: parseFloat(val("used")) }), "Saved.");
    if (a === "mat-rm") return run(c, el, () => rpc(c, "job_card_material_remove", { p_id: id }), "Material removed.");
  }, true);
  document.addEventListener("change", (e) => {
    const inp = e.target.closest("[data-jc-up]"); if (!inp || !window.APP?.state.me?.role) return;
    addPhoto(window.APP.dashCtx(), inp.dataset.jcUp, inp.files?.[0]); inp.value = "";
  });

  /* rows for a project's workspace: every job card on the project, for the company and its PM */
  async function projectRows(c, pid) {
    const list = ((await rpc(c, "my_job_cards").catch(() => [])) || []).filter((x) => x.project_id === pid);
    return list.map((x) => `<button class="row es-row" data-go="engagement/${esc(x.id)}"><span class="ic">${icon("rep", 17)}</span><span class="tx"><b>${esc(x.title)}</b><small>#BX-${esc(x.card_no)} · ${esc(x.counterpart || "")} · ${x.progress}% complete</small></span>${pill(x.status)}</button>`).join("");
  }

  window.JOBCARD = { projectRows };
  window.DASH.register("engagement", view);
})();
