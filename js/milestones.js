/* BAID X project milestones. The project owner defines a milestone for a team member, funds it from the company wallet into
   escrow, the team member submits it and approval (or 5 days of silence) releases the money minus commission.
   Money never moves in this file: every action is a database function (milestone_*). */
(() => {
  "use strict";
  const { esc, pretty, icon } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const money = (n) => { const v = Number(n) || 0; return `GH₵${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const val = (n) => document.querySelector(`#sheetRoot [name="${n}"]`)?.value ?? "";
  const day = (d) => new Date(d).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const ST = { planned: ["Not funded", ""], funded: ["Funded · in escrow", "warn"], submitted: ["Awaiting approval", "warn"], released: ["Paid", "ok"], disputed: ["In dispute", "bad"], refunded: ["Refunded", ""] };
  const pill = (s) => `<span class="pill ${ST[s]?.[1] || ""}">${esc(ST[s]?.[0] || pretty(s))}</span>`;
  const friendly = (e) => { const m = String(e?.message || ""), s = m.match(/insufficient_funds:([\d.]+)/); return s ? { short: Number(s[1]) } : m || "Something went wrong. Nothing was charged."; };
  const REASONS = ["The work was not delivered", "The work is not as agreed", "Not responding", "Payment disagreement", "Something else"];
  let ctx = { pid: null, bal: 0 };

  async function tab({ c, ov, role, pid }) {
    const { empty, sec } = U(), owner = role === "company";
    ctx.pid = pid;
    const list = await rpc(c, "project_milestone_list", { p_project: pid }).catch(() => []);
    const sum = (f) => list.filter(f).reduce((t, m) => t + Number(m.amount_ghs), 0);
    const closed = ["completed", "cancelled"].includes(ov.status);
    const tiles = list.length ? `<div class="ms-tiles"><div><small>Planned</small><b>${money(sum((m) => m.status === "planned"))}</b></div><div><small>In escrow</small><b>${money(sum((m) => ["funded", "submitted", "disputed"].includes(m.status)))}</b></div><div><small>Paid out</small><b>${money(sum((m) => m.status === "released"))}</b></div></div>` : "";
    const card = (m) => {
      const mine = m.mine; let acts = "";
      if (owner && m.status === "planned") acts = `<button class="es-btn" data-ms="fund" data-id="${esc(m.id)}">${icon("shield", 18)} Fund ${money(m.amount_ghs)}</button><button class="es-btn ghost" data-ms="cancel" data-id="${esc(m.id)}">Remove</button>`;
      else if (owner && ["funded", "submitted"].includes(m.status)) acts = `<button class="es-btn" data-ms="approve" data-id="${esc(m.id)}">${icon("check", 18)} Approve and release</button><div class="es-2"><button class="es-btn ghost" data-ms="dispute" data-id="${esc(m.id)}">Report a problem</button>${m.status === "funded" ? `<button class="es-btn ghost" data-ms="cancel" data-id="${esc(m.id)}">Cancel and refund</button>` : ""}</div>`;
      else if (mine && m.status === "funded") acts = `<button class="es-btn" data-ms="submit" data-id="${esc(m.id)}">${icon("check", 18)} Submit milestone</button><div class="es-2"><button class="es-btn ghost" data-ms="dispute" data-id="${esc(m.id)}">Report a problem</button><button class="es-btn ghost" data-ms="cancel" data-id="${esc(m.id)}">Decline</button></div>`;
      else if (mine && m.status === "submitted") acts = `<button class="es-btn ghost" data-ms="dispute" data-id="${esc(m.id)}">Report a problem</button>`;
      const note = m.status === "submitted" && m.auto_release_at ? `Releases automatically ${day(m.auto_release_at)} if not reviewed.` : m.status === "released" && m.net_ghs != null ? (mine ? `You received ${money(m.net_ghs)} after the ${money(m.commission_ghs)} BAID X fee.` : `Paid ${money(m.amount_ghs)}.`) : m.status === "disputed" ? `In dispute${m.dispute_reason ? ": " + m.dispute_reason : ""}. The money stays safe in escrow while BAID X reviews.` : m.status === "planned" ? (owner ? "Fund it to start. The money is held safely until you approve." : "The owner has not funded this yet.") : "";
      return `<div class="ms-card"><div class="ms-top"><b>${esc(m.title)}</b>${pill(m.status)}</div><div class="ms-meta"><span>${esc(m.payee_name || "Team member")}</span><span>${money(m.amount_ghs)}</span>${m.due_on ? `<span>Due ${esc(day(m.due_on))}</span>` : ""}</div>
        ${m.description ? `<p class="ms-d">${esc(m.description)}</p>` : ""}${m.submit_note ? `<div class="es-quote"><small>Note from team member</small><p>${esc(m.submit_note)}</p></div>` : ""}${m.resolution_note ? `<div class="es-quote"><small>BAID X decision</small><p>${esc(m.resolution_note)}</p></div>` : ""}
        ${note ? `<p class="ms-n">${esc(note)}</p>` : ""}${acts ? `<div class="es-acts">${acts}</div>` : ""}</div>`;
    };
    return `<div class="ms-wrap">${owner && !closed ? `<button class="es-btn" data-ms="new">${icon("plus", 18)} Add milestone</button>` : ""}${tiles}`
      + (list.length ? list.map(card).join("") : empty("task", "No milestones yet", owner ? "Break the work into milestones. Fund each one into escrow and pay your team as they deliver." : "When the project owner adds milestones for you, they appear here with the payment already held in escrow."))
      + `<div class="es-trust">${icon("shield", 18)}<div>${owner ? "Funding moves the money from your wallet into escrow. It is released to your team member only when you approve, or 5 days after they submit." : "The owner's payment is held by BAID X once a milestone is funded. It is released to you when they approve, or automatically 5 days after you submit."}</div></div></div>`;
  }

  async function newSheet(c) {
    const team = (await rpc(c, "project_team", { p_project: ctx.pid })).members.filter((m) => ["worker", "pm", "business"].includes(m.role_type));
    if (!team.length) return c.toast("Add someone to the project team first.");
    F().openSheet("Add milestone", `${F().fld("Who is it for?", F().sel("payee", team.map((m) => [m.profile_id, `${m.name} · ${m.project_role || pretty(m.role_type)}`]), ""))}
      ${F().fld("Milestone", F().inp("title", { max: 120, ph: "e.g. Foundation poured and cured" }))}
      ${F().fld("What must be delivered", F().area("description", { rows: 3, max: 1000 }))}
      <div class="two-col">${F().fld("Amount (GH₵)", F().inp("amount", { type: "number", min: 1, step: "0.01" }))}${F().fld("Due date", F().inp("due", { type: "date" }))}</div>
      <p class="wl-err" id="msE"></p><button class="es-btn" data-ms="create">Add milestone</button><p class="es-fine">Nothing is charged until you fund the milestone.</p>`);
  }
  async function fundSheet(c, id) {
    const m = (await rpc(c, "project_milestone_list", { p_project: ctx.pid })).find((x) => x.id === id); if (!m) return;
    ctx.bal = Number((await c.sb.from("wallet_accounts").select("available_ghs").eq("owner_id", c.uid).maybeSingle()).data?.available_ghs || 0);
    const short = Math.max(0, Math.round((Number(m.amount_ghs) - ctx.bal) * 100) / 100);
    F().openSheet("Fund milestone", `<p class="es-s">${esc(m.title)} for ${esc(m.payee_name)}. The money moves from your wallet into escrow and is released only when you approve.</p>
      ${[["Held in escrow", `<b>${money(m.amount_ghs)}</b>`], ["Your balance", money(ctx.bal)], ["Balance after", money(Math.max(0, ctx.bal - m.amount_ghs))]].map(([k, v]) => `<div class="wl-kv"><span>${k}</span><b>${v}</b></div>`).join("")}
      ${short ? `<div class="es-short">${icon("wallet", 16)}<span>You need ${money(short)} more in your wallet.</span><button data-ms="topup">Add money</button></div>` : ""}<p class="wl-err" id="msE"></p>
      <button class="es-btn" data-ms="confirm-fund" data-id="${esc(id)}" ${short ? "disabled" : ""}>${icon("shield", 18)} Fund and hold in escrow</button>`);
  }
  const sheet = (title, text, action, id, label) => F().openSheet(title, `<p class="es-s">${text}</p><button class="es-btn" data-ms="${action}" data-id="${esc(id)}">${label}</button><button class="es-btn ghost" data-close style="margin-top:8px">Not now</button>`);
  const run = async (c, btn, fn, ok) => {
    btn.disabled = true; btn.classList.add("busy");
    try { await fn(); F().closeSheet(); if (ok) c.toast(ok); window.APP.route(); } catch (e) { const m = friendly(e), err = document.getElementById("msE"); if (err) err.textContent = m.short ? `You need ${money(m.short)} more in your wallet.` : m; else c.toast(m.short ? "Not enough money in your wallet." : m); btn.disabled = false; btn.classList.remove("busy"); }
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ms]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), a = el.dataset.ms, id = el.dataset.id;
    e.preventDefault(); e.stopPropagation();
    if (a === "new") return newSheet(c).catch((x) => F().fail(c, x));
    if (a === "create") { const amt = parseFloat(val("amount")); if (!val("title").trim() || !(amt >= 1)) { document.getElementById("msE").textContent = "Add a title and an amount."; return; } return run(c, el, () => rpc(c, "milestone_create", { p_project: ctx.pid, p_payee: val("payee"), p_title: val("title"), p_amount: amt, p_description: val("description") || null, p_due: val("due") || null }), "Milestone added.").catch(() => {}); }
    if (a === "fund") return fundSheet(c, id).catch((x) => F().fail(c, x));
    if (a === "confirm-fund") return run(c, el, () => rpc(c, "milestone_fund", { p_id: id }), "Funded. The money is held in escrow.");
    if (a === "topup") { F().closeSheet(); return c.go("wallet"); }
    if (a === "submit") return F().openSheet("Submit milestone", `<p class="es-s">The owner has 5 days to review. If they don't respond, your payment is released automatically.</p>${F().fld("Note (optional)", F().area("note", { rows: 3, max: 1000, ph: "What was completed." }))}<button class="es-btn" data-ms="confirm-submit" data-id="${esc(id)}">${icon("check", 18)} Submit</button>`);
    if (a === "confirm-submit") return run(c, el, () => rpc(c, "milestone_submit", { p_id: id, p_note: val("note") || null }), "Submitted for approval.");
    if (a === "approve") return sheet("Release payment", "This pays your team member. You can't undo it, so only approve if the milestone is done.", "confirm-approve", id, "Yes, release payment");
    if (a === "confirm-approve") return run(c, el, () => rpc(c, "milestone_approve", { p_id: id }), "Payment released.");
    if (a === "cancel") return sheet("Cancel milestone?", "If it was funded, the money returns to the owner's wallet.", "confirm-cancel", id, "Yes, cancel");
    if (a === "confirm-cancel") return run(c, el, () => rpc(c, "milestone_cancel", { p_id: id }), "Cancelled.");
    if (a === "dispute") return F().openSheet("Report a problem", `<p class="es-s">The money stays frozen in escrow while BAID X reviews.</p>${F().fld("What is the problem?", F().sel("reason", REASONS.map((r) => [r, r]), REASONS[0]))}${F().fld("Details", F().area("details", { rows: 4, max: 2000 }))}<button class="es-btn" data-ms="confirm-dispute" data-id="${esc(id)}">Open dispute</button>`);
    if (a === "confirm-dispute") return run(c, el, () => rpc(c, "milestone_dispute", { p_id: id, p_reason: val("reason"), p_details: val("details") || null }), "Dispute opened. BAID X will review.");
  }, true);

  window.MILESTONES = { tab };
})();
