/* BAID X hire -> escrow -> release for jobs.
   Money never moves in this file: every action is a database function (hire_worker, engagement_*), which locks the
   employer's wallet money in escrow, and releases it (minus commission) only on approval, auto-release or an admin decision. */
(() => {
  "use strict";
  const { esc, pretty, icon, ago } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const money = (n) => { const v = Number(n) || 0; return `GH₵${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const val = (n) => document.querySelector(`#sheetRoot [name="${n}"]`)?.value ?? "";
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const ST = {
    active: ["In progress", "warn"], submitted: ["Awaiting approval", "warn"], released: ["Paid", "ok"], disputed: ["In dispute", "bad"], refunded: ["Refunded", ""], cancelled: ["Cancelled", ""],
  };
  const pill = (s) => `<span class="pill ${ST[s]?.[1] || ""}">${esc(ST[s]?.[0] || pretty(s))}</span>`;
  const REASONS = ["The work was not done", "The work is not as agreed", "The other person is not responding", "Payment or pricing disagreement", "Something else"];
  const friendly = (e) => {
    const m = String(e?.message || "");
    const s = m.match(/insufficient_funds:([\d.]+)/); if (s) return { short: Number(s[1]) };
    if (/not open/.test(m)) return "This job is no longer open.";
    if (/already hired/.test(m)) return "You have already hired this person.";
    if (/can no longer be hired/.test(m)) return "This application can no longer be hired.";
    if (/only the job owner/.test(m)) return "Only the person who posted the job can hire.";
    return m || "Something went wrong. Nothing was charged.";
  };

  /* ---- employer: applicants for a job ---- */
  async function applicantsView(c, jobId) {
    const { head, empty, sec } = U();
    if (!jobId) return head("Applicants") + empty("hire", "Choose a job", "Open a job from your list to see who applied.", `<button class="btn-light sm" data-go="hires">Back to jobs</button>`);
    const [{ data: job }, apps] = await Promise.all([c.sb.from("jobs").select("id,title,status,daily_rate_ghs,workers_needed,city_town").eq("id", jobId).maybeSingle(), rpc(c, "job_applicants", { p_job: jobId }).catch(() => [])]);
    // profile and reviews for each applicant (reviews are private, so they come through applicant_details)
    const det = new Map((await rpc(c, "applicant_details", { p_job: jobId }).catch(() => []) || []).map((d) => [d.worker_id, d]));
    if (!job) return head("Applicants") + empty("hire", "Job not found", "It may have been removed.", `<button class="btn-light sm" data-go="hires">Back to jobs</button>`);
    const stars = (r) => `<span class="ap-stars" aria-label="${r} out of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= Math.round(r) ? "on" : ""}"></i>`).join("")}</span>`;
    const profile = (a) => {
      const d = det.get(a.worker_id); if (!d) return "";
      const place = [d.city_town, d.region].filter(Boolean).join(", ");
      const revs = (d.reviews || []).map((r) => `<li><div class="ap-r-top">${stars(Number(r.rating) || 0)}<b>${esc(r.by)}</b><small>${esc(ago(r.at))}</small></div>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</li>`).join("");
      const pics = (d.portfolio || []).slice(0, 4).map((u) => `<span class="ap-pic" style="background-image:url('${esc(u)}')"></span>`).join("");
      return `<details class="ap-more"><summary>${d.review_count ? `${stars(Number(d.rating) || 0)}<b>${Number(d.rating).toFixed(1)}</b><small>${d.review_count} review${d.review_count > 1 ? "s" : ""}</small>` : `<small>No reviews yet</small>`}<span class="ap-open">Profile and reviews</span></summary>
        ${d.bio ? `<p class="ap-bio">${esc(d.bio)}</p>` : ""}
        <div class="ap-facts">${place ? `<span>${esc(place)}</span>` : ""}${d.daily_rate ? `<span>${money(d.daily_rate)}/day</span>` : ""}${d.rank ? `<span>${esc(pretty(d.rank))} · ${Number(d.xp || 0)} XP</span>` : ""}${d.available ? `<span class="ok">Available for work</span>` : ""}</div>
        ${pics ? `<div class="ap-pics">${pics}</div>` : ""}
        ${revs ? `<ul class="ap-revs">${revs}</ul>` : `<p class="ap-none">No reviews yet. Reviews appear here after this professional finishes jobs on BAID X.</p>`}</details>`;
    };
    const card = (a) => {
      const hired = a.status === "accepted";
      return `<div class="es-ap"><div class="es-ap-top"><span class="av" ${a.photo ? `style="background-image:url('${esc(a.photo)}')"` : ""}>${a.photo ? "" : esc(initials(a.name))}</span>
        <span class="tx"><b>${esc(a.name)} ${a.verified ? `<span class="pill ok">Verified</span>` : ""}</b><small>${esc([a.trade, a.years && a.years !== "null" ? pretty(a.years) : ""].filter(Boolean).join(" · ") || "Professional")} · applied ${esc(ago(a.applied_at))}</small></span></div>
        ${profile(a)}
        <div class="es-ap-meta"><div><small>Asking</small><b>${a.proposed_rate ? money(a.proposed_rate) + "/day" : job.daily_rate_ghs ? money(job.daily_rate_ghs) + "/day" : "Not set"}</b></div><div><small>Trust score</small><b>${Number(a.trust || 0).toFixed(1)}</b></div></div>
        <div class="es-ap-act">${hired ? `<button class="btn-dark sm" data-es="open" data-id="${esc(a.engagement_id || "")}">View job card</button>` : job.status === "open" && ["submitted", "shortlisted"].includes(a.status) ? `<button class="btn-dark sm" data-es="message" data-id="${esc(a.worker_id)}" data-name="${esc(a.name)}">Message</button><button class="btn-light sm" data-es="hire" data-app="${esc(a.application_id)}" data-name="${esc(a.name)}" data-rate="${esc(a.proposed_rate || job.daily_rate_ghs || "")}" data-job="${esc(job.title)}">Hire</button>` : `<span class="pill">${esc(pretty(a.status))}</span>`}</div></div>`;
    };
    return head(job.title, `<button class="btn-dark sm" data-go="hires">Jobs</button>`) + `<p class="es-sub">${esc(pretty(job.status))} · ${esc(job.city_town || "Ghana")} · needs ${job.workers_needed || 1} worker${job.workers_needed > 1 ? "s" : ""}</p>`
      + (apps.length ? apps.map(card).join("") : empty("hire", "No applicants yet", "When professionals apply, they are listed here so you can message and hire them."))
      + `<div class="es-trust">${icon("shield", 18)}<div><b>Pay safely.</b> When you hire, the money is held in escrow. It is released to the worker only when you approve the work.</div></div>`;
  }

  /* ---- hire sheet ---- */
  const hireState = { app: null, rate: 0, job: "", name: "" };
  async function hireSheet(c, el) {
    hireState.app = el.dataset.app; hireState.rate = Number(el.dataset.rate) || 0; hireState.job = el.dataset.job; hireState.name = el.dataset.name;
    const bal = Number((await c.sb.from("wallet_accounts").select("available_ghs").eq("owner_id", c.uid).maybeSingle()).data?.available_ghs || 0);
    hireState.bal = bal;
    F().openSheet("Hire " + hireState.name, `<p class="es-s">Set the daily rate and how many days. The total is held in escrow until you approve the work.</p>
      <div class="two-col">${F().fld("Daily rate (GH₵)", F().inp("rate", { type: "number", min: 1, step: "0.01", val: hireState.rate || "" }))}${F().fld("Number of days", F().inp("days", { type: "number", min: 1, step: 1, val: 1 }))}</div>
      <div id="esQ" class="es-q"></div><p class="wl-err" id="esE"></p>
      <button class="es-btn" data-es="confirm-hire" disabled>${icon("shield", 18)} Hire and hold in escrow</button>
      <p class="es-fine">Your wallet balance: ${money(bal)}. Nothing is paid to the worker until you approve.</p>`);
    hireQuote();
  }
  function hireQuote() {
    const box = document.getElementById("esQ"), btn = document.querySelector('#sheetRoot [data-es="confirm-hire"]'); if (!box) return;
    const rate = parseFloat(val("rate")), days = parseInt(val("days"), 10), ok = rate > 0 && days >= 1 && days <= 365;
    if (!ok) { box.innerHTML = ""; if (btn) btn.disabled = true; return; }
    const total = Math.round(rate * days * 100) / 100, short = Math.max(0, Math.round((total - hireState.bal) * 100) / 100);
    box.innerHTML = [["Job", esc(hireState.job)], ["Rate × days", `${money(rate)} × ${days}`], ["Held in escrow", `<b>${money(total)}</b>`], ["Your balance after", money(Math.max(0, hireState.bal - total))]].map(([k, v]) => `<div class="wl-kv"><span>${k}</span><b>${v}</b></div>`).join("")
      + (short ? `<div class="es-short">${icon("wallet", 16)}<span>You need ${money(short)} more in your wallet.</span><button data-es="topup" data-n="${Math.ceil(short)}">Add money</button></div>` : "");
    if (btn) btn.disabled = !!short;
  }
  async function confirmHire(c, btn) {
    const err = document.getElementById("esE"); err.textContent = "";
    btn.disabled = true; btn.classList.add("busy");
    try {
      const r = await rpc(c, "hire_worker", { p_application: hireState.app, p_days: parseInt(val("days"), 10), p_rate: parseFloat(val("rate")) });
      F().closeSheet(); c.toast(`Hired. ${money(r.amount)} is held in escrow.`); c.go(`engagement/${r.engagement_id}`);
    } catch (e) {
      const m = friendly(e);
      if (m.short) { err.textContent = `You need ${money(m.short)} more in your wallet.`; hireState.bal = Math.max(0, hireState.bal); } else err.textContent = m;
      btn.disabled = false; btn.classList.remove("busy");
    }
  }

  // The engagement detail is the Digital Job Card (js/jobcard.js).

  /* ---- lists used inside hires / work views ---- */
  async function engagementRows(c, role, filter) {
    const list = (await rpc(c, "my_engagements").catch(() => [])).filter((e) => e.role === role && filter(e));
    return list.map((e) => `<button class="row es-row" data-go="engagement/${esc(e.id)}"><span class="ic">${icon("work", 17)}</span><span class="tx"><b>${esc(e.title)}</b><small>${esc(e.counterpart || "")} · ${money(e.amount_ghs)} · ${e.days} day${e.days > 1 ? "s" : ""}</small></span>${pill(e.status)}</button>`).join("");
  }
  const hiresSection = async (c) => { const h = await engagementRows(c, "payer", () => true); return h ? U().sec("Hired professionals") + h : ""; };
  const workSection = async (c, seg) => engagementRows(c, "worker", (e) => (seg === "completed" ? ["released", "refunded"].includes(e.status) : ["active", "submitted", "disputed"].includes(e.status)));

  /* ---- action sheets ---- */
  function submitSheet(id) {
    F().openSheet("Mark work as done", `<p class="es-s">The client has 3 days to review. If they don't respond, your payment is released automatically.</p>
      ${F().fld("Note to the client (optional)", F().area("note", { rows: 3, max: 1000, ph: "What was completed, anything they should check." }))}
      <button class="es-btn" data-es="confirm-submit" data-id="${esc(id)}">${icon("check", 18)} Submit work</button>`);
  }
  function disputeSheet(id) {
    F().openSheet("Report a problem", `<p class="es-s">The money stays frozen in escrow while BAID X reviews. Be specific, the more detail the faster we can decide.</p>
      ${F().fld("What is the problem?", F().sel("reason", REASONS.map((r) => [r, r]), REASONS[0]))}
      ${F().fld("Details", F().area("details", { rows: 4, max: 2000, ph: "What happened? What was agreed?" }))}<p class="wl-err" id="esE"></p>
      <button class="es-btn" data-es="confirm-dispute" data-id="${esc(id)}">Open dispute</button>`);
  }
  const confirmSheet = (title, text, action, id, label) => F().openSheet(title, `<p class="es-s">${text}</p><button class="es-btn" data-es="${action}" data-id="${esc(id)}">${label}</button><button class="es-btn ghost" data-close style="margin-top:8px">Not now</button>`);

  const run = async (c, btn, fn, ok) => {
    btn.disabled = true; btn.classList.add("busy");
    try { await fn(); F().closeSheet(); if (ok) c.toast(ok); window.APP.route(); } catch (e) { const m = friendly(e); c.toast(m.short ? "Not enough money in your wallet." : m); btn.disabled = false; btn.classList.remove("busy"); }
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-es]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), a = el.dataset.es, id = el.dataset.id;
    e.preventDefault(); e.stopPropagation();
    if (a === "hire") return hireSheet(c, el).catch((x) => F().fail(c, x));
    if (a === "confirm-hire") return confirmHire(c, el);
    if (a === "topup") { F().closeSheet(); c.go("wallet"); return; }
    if (a === "open") return id && c.go(`engagement/${id}`);
    if (a === "message") return window.FX.message(c, el);
    if (a === "submit") return submitSheet(id);
    if (a === "confirm-submit") return run(c, el, () => rpc(c, "engagement_submit", { p_id: id, p_note: val("note") || null }), "Submitted. The client has 3 days to review.");
    if (a === "approve") return confirmSheet("Release payment", "This sends the money to the worker. You can't undo it, so only approve if you're happy with the work.", "confirm-approve", id, "Yes, release payment");
    if (a === "confirm-approve") return run(c, el, () => rpc(c, "engagement_approve", { p_id: id }), "Payment released.");
    if (a === "cancel") return confirmSheet("Cancel this job?", "The money held in escrow goes back to the employer's wallet and the job reopens.", "confirm-cancel", id, "Yes, cancel and refund");
    if (a === "confirm-cancel") return run(c, el, () => rpc(c, "engagement_cancel", { p_id: id }), "Cancelled. The escrow was refunded.");
    if (a === "dispute") return disputeSheet(id);
    if (a === "confirm-dispute") return run(c, el, () => rpc(c, "engagement_dispute", { p_id: id, p_reason: val("reason"), p_details: val("details") || null }), "Dispute opened. BAID X will review.");
  }, true);
  document.addEventListener("input", (e) => { if (e.target.matches('#sheetRoot [name="rate"], #sheetRoot [name="days"]')) hireQuote(); });

  window.ESCROW = { hiresSection, workSection };
  window.DASH.register("applicants", applicantsView);
})();
