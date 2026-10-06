/* BAID X House logbook: who did what in the client's home (completed job cards), maintenance reminders
   and the trusted team (everyone they paid through escrow). Reads my_house; reminders change through
   house_reminder_save / _done / _remove. */
(() => {
  "use strict";
  const { esc, icon } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const val = (n) => document.querySelector(`#sheetRoot [name="${n}"]`)?.value ?? "";
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (d) => { const t = new Date(String(d).slice(0, 10) + "T00:00:00"); return `${t.getDate()} ${M[t.getMonth()]} ${t.getFullYear()}`; };
  const month = (d) => { const t = new Date(d); return `${M[t.getMonth()]} ${t.getFullYear()}`; };
  const REPEAT = [["", "Does not repeat"], ["1", "Every month"], ["3", "Every 3 months"], ["6", "Every 6 months"], ["12", "Every year"]];
  const every = (m) => (!m ? "" : m === 1 ? "every month" : m === 12 ? "every year" : m % 12 === 0 ? `every ${m / 12} years` : `every ${m} months`);
  const IDEAS = ["Service the AC", "Check the borehole pump", "Termite treatment", "Clean the water tank", "Inspect the roof", "Service the generator"];
  const due = (days) => (days < 0 ? ["Overdue", "bad"] : days === 0 ? ["Today", "warn"] : days <= 14 ? [`${days} day${days === 1 ? "" : "s"}`, "warn"] : ["Later", ""]);
  const state = { d: null };

  async function view(c) {
    const { head, sec, empty } = U();
    const d = (await rpc(c, "my_house")) || {}; state.d = d;
    const hist = (d.history || []).map((h) => `<button class="row es-row" data-go="engagement/${esc(h.id)}"><span class="ic">${icon("task", 17)}</span><span class="tx"><b>${esc(h.title)}</b><small>${esc([h.worker, h.trade].filter(Boolean).join(" · "))} · ${esc(month(h.done_on))}</small></span></button>`).join("");
    const who = `<div class="es-card jc-sec"><h4>Who did what</h4>${hist ? `<div class="hl-list">${hist}</div>` : `<p class="jc-none">Every job you pay for through BAID X is recorded here when it's complete: what was done, who did it and when.</p>`}</div>`;

    const rem = (d.reminders || []).map((r) => {
      const [label, kind] = due(r.days);
      const sub = [`Due ${day(r.due_on)}`, every(r.repeat_months), r.worker ? `with ${r.worker}` : ""].filter(Boolean).join(" · ");
      return `<button class="row es-row" data-hl="open" data-id="${esc(r.id)}"><span class="ic">${icon("bell", 17)}</span><span class="tx"><b>${esc(r.title)}</b><small>${esc(sub)}</small></span><span class="pill ${kind}">${esc(label)}</span></button>`;
    }).join("");

    const team = (d.team || []).map((t) => `<div class="row hl-team"><span class="av" ${t.photo ? `style="background-image:url('${esc(t.photo)}')"` : ""}>${t.photo ? "" : esc(String(t.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span><span class="tx"><b>${esc(t.name)}</b><small>${esc([t.trade, `${t.jobs} job${t.jobs > 1 ? "s" : ""}`, t.rating ? `you rated ${Number(t.rating).toFixed(1)}` : ""].filter(Boolean).join(" · "))}</small></span><button class="btn-light sm" data-es="message" data-id="${esc(t.worker_id)}" data-name="${esc(t.name)}">Message</button></div>`).join("");

    return head("House logbook", `<button class="btn-dark sm" data-go="home">Home</button>`) + who
      + sec("Coming up") + (rem || `<div class="es-card"><p class="jc-none" style="margin:0">Add reminders for the jobs your home needs again and again, like servicing the AC or treating for termites. We'll tell you when each one is due.</p></div>`)
      + `<button class="jc-add" data-hl="add">${icon("plus", 16)} Add reminder</button>`
      + sec("My trusted team") + (team || empty("hire", "No one yet", "Professionals you pay through BAID X join your trusted team, so you can book them again in one message."));
  }

  function reminderSheet(r) {
    const team = state.d?.team || [];
    F().openSheet(r ? "Edit reminder" : "Add reminder", `${r ? "" : `<div class="hl-ideas">${IDEAS.map((i) => `<button type="button" class="chip-s" data-hl="idea">${esc(i)}</button>`).join("")}</div>`}
      ${F().fld("What needs doing", F().inp("title", { max: 100, val: r?.title || "", ph: "e.g. Service the AC" }))}
      <div class="two-col">${F().fld("Due", F().inp("due", { type: "date", val: r?.due_on || "" }))}${F().fld("Repeat", F().sel("repeat", REPEAT, r?.repeat_months ? String(r.repeat_months) : ""))}</div>
      ${team.length ? F().fld("Who usually does it (optional)", F().sel("worker", [["", "No one yet"], ...team.map((t) => [t.worker_id, `${t.name}${t.trade ? " · " + t.trade : ""}`])], r?.worker_id || "")) : ""}
      ${F().fld("Note (optional)", F().area("note", { rows: 2, max: 500, val: r?.note || "", ph: "e.g. Both units, upstairs and living room" }))}
      <p class="wl-err" id="hlE"></p><button class="es-btn" data-hl="save" data-id="${esc(r?.id || "")}">Save reminder</button>`);
  }

  function openSheet(r) {
    const nextNote = r.repeat_months ? `Marking it done moves it to ${every(r.repeat_months)} from today.` : "Marking it done puts it away.";
    F().openSheet(r.title, `<p class="es-s">Due ${esc(day(r.due_on))}${r.repeat_months ? ` · ${esc(every(r.repeat_months))}` : ""}${r.last_done_on ? ` · last done ${esc(day(r.last_done_on))}` : ""}</p>${r.note ? `<div class="es-quote"><small>Note</small><p>${esc(r.note)}</p></div>` : ""}
      <p class="wl-err" id="hlE"></p><div class="es-acts">
      ${r.worker_id ? `<button class="es-btn" data-es="message" data-id="${esc(r.worker_id)}" data-name="${esc(r.worker)}">Message ${esc(r.worker)}</button>` : ""}
      <button class="es-btn ${r.worker_id ? "ghost" : ""}" data-hl="done" data-id="${esc(r.id)}">${icon("task", 18)} Mark done</button>
      <div class="es-2"><button class="es-btn ghost" data-hl="edit" data-id="${esc(r.id)}">Edit</button><button class="es-btn ghost" data-hl="remove" data-id="${esc(r.id)}">Remove</button></div></div>
      <p class="jc-hint">${esc(nextNote)}</p>`);
  }

  const find = (id) => (state.d?.reminders || []).find((x) => x.id === id);
  const run = async (c, btn, fn, ok) => {
    const err = document.getElementById("hlE"); if (err) err.textContent = "";
    btn.disabled = true; btn.classList.add("busy");
    try { const r = await fn(); F().closeSheet(); c.toast(typeof ok === "function" ? ok(r) : ok); window.APP.route(); }
    catch (x) { const m = String(x?.message || "Something went wrong.").replace(/^./, (s) => s.toUpperCase()); if (err) err.textContent = m; else c.toast(m); btn.disabled = false; btn.classList.remove("busy"); }
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-hl]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), a = el.dataset.hl, id = el.dataset.id;
    e.preventDefault(); e.stopPropagation();
    if (a === "add") return reminderSheet(null);
    if (a === "idea") { const t = document.querySelector('#sheetRoot [name="title"]'); if (t) t.value = el.textContent; return; }
    if (a === "open") return find(id) && openSheet(find(id));
    if (a === "edit") return find(id) && reminderSheet(find(id));
    if (a === "save") return run(c, el, () => rpc(c, "house_reminder_save", { p_id: id || null, p_title: val("title"), p_due: val("due") || null, p_repeat_months: val("repeat") ? parseInt(val("repeat"), 10) : null, p_worker: val("worker") || null, p_note: val("note") || null }), "Reminder saved.");
    if (a === "done") return run(c, el, () => rpc(c, "house_reminder_done", { p_id: id }), (r) => (r?.next ? `Done. Next one is due ${day(r.next)}.` : "Done."));
    if (a === "remove") return run(c, el, () => rpc(c, "house_reminder_remove", { p_id: id }), "Reminder removed.");
  }, true);

  /* compact card for the client's home */
  async function homeCard(c) {
    const d = (await rpc(c, "my_house").catch(() => null)) || {};
    const next = (d.reminders || [])[0], n = (d.history || []).length;
    const dueSoon = next && next.days <= 14;
    const sub = next ? `Next: ${next.title}, ${next.days < 0 ? "overdue" : next.days === 0 ? "due today" : `in ${next.days} day${next.days === 1 ? "" : "s"}`}` : n ? `${n} job${n > 1 ? "s" : ""} recorded · add maintenance reminders` : "Who did what in your home, and what's due next";
    return `<button class="inv-card${dueSoon ? " warn" : ""}" data-go="house"><span class="ic">${icon("home", 20)}</span><span class="tx"><b>House logbook</b><small>${esc(sub)}</small></span></button>`;
  }

  window.HOUSE = { homeCard };
  window.DASH.register("house", view);
})();
