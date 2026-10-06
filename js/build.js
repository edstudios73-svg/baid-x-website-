/* BAID X My build: a homeowner's view of their build, made from their job cards.
   Budget, name, place and finish date come from build_save; money, progress, photos and the sign-offs
   waiting for the client come from my_build. Nothing here moves money. */
(() => {
  "use strict";
  const { esc, icon } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const money = (n) => `GH₵${(Number(n) || 0).toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const val = (n) => document.querySelector(`#sheetRoot [name="${n}"]`)?.value ?? "";
  const when = (iso) => new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const date = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const today = (iso) => new Date(iso).toDateString() === new Date().toDateString();
  const ST = { active: ["In progress", "warn"], submitted: ["Awaiting sign-off", "warn"], released: ["Complete", "ok"], disputed: ["In dispute", "bad"], refunded: ["Refunded", ""], cancelled: ["Cancelled", ""] };
  const pill = (s) => `<span class="pill ${ST[s]?.[1] || ""}">${esc(ST[s]?.[0] || s)}</span>`;
  const state = { build: null };

  async function photoUrls(c, photos) {
    if (!photos.length) return {};
    const { data } = await c.sb.storage.from("job-cards").createSignedUrls(photos.map((p) => p.path), 3600);
    return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }

  async function view(c) {
    const { head, bar, sec, empty } = U();
    const d = (await rpc(c, "my_build")) || {};
    const b = d.build; state.build = b;
    const committed = Number(d.paid) + Number(d.held), budget = Number(b?.budget_ghs) || 0;
    const urls = await photoUrls(c, d.photos || []);

    const top = b
      ? `<div class="es-card bd-hero"><div class="bd-name"><div><h2>${esc(b.name)}</h2>${b.location ? `<small>${esc(b.location)}</small>` : ""}</div><button class="btn-dark sm" data-bd="edit">Edit</button></div>
        ${budget ? `<div class="jc-pct"><span>Spent</span><b>${money(d.paid)} of ${money(budget)}</b></div>${bar(Math.min(100, (Number(d.paid) / budget) * 100))}` : `<div class="jc-pct"><span>Spent</span><b>${money(d.paid)}</b></div>`}
        <div class="jc-pct"><span>Progress</span><b>${d.progress}%</b></div>${bar(d.progress)}
        ${budget ? `<div class="wl-kv"><span>Committed so far</span><b>${money(committed)}</b></div><div class="wl-kv"><span>Left in your budget</span><b>${money(Math.max(0, budget - committed))}</b></div>` : `<p class="jc-hint">Add a budget to see what is left as you hire.</p>`}</div>`
      : `<div class="es-card bd-hero"><h2 class="bd-set">Set up your build</h2><p class="jc-hint" style="margin:0 0 12px">Name your build and set a budget and finish date. Everything else fills in from your job cards: what you've paid, what's held in escrow, progress and photos from site.</p><button class="es-btn" data-bd="edit">${icon("plus", 18)} Set up my build</button></div>`;

    const statsHtml = `<div class="bd-stats"><div><b>${money(d.held)}</b><small>Held in escrow</small></div><div><b>${(d.waiting || []).length}</b><small>Waiting for you</small></div><div><b>${b?.due_on ? esc(date(b.due_on)) : "Not set"}</b><small>Finish date</small></div></div>`;

    const photos = d.photos || [];
    const anyToday = photos.some((p) => today(p.taken_at));
    const shown = anyToday ? photos.filter((p) => today(p.taken_at)) : photos;
    const pics = shown.slice(0, 6).map((p) => `<button class="jc-pic" data-go="engagement/${esc(p.engagement_id)}" style="background-image:url('${esc(urls[p.path] || "")}')" aria-label="${esc(p.title)} photo"><em>${esc(when(p.taken_at))}</em></button>`).join("");
    const site = `<div class="es-card jc-sec"><h4>${anyToday ? "Today on site" : "Latest from site"}</h4>${pics ? `<div class="jc-pics">${pics}</div><p class="jc-hint">From your job cards. Tap a photo to open its card.</p>` : `<p class="jc-none">No site photos yet. Photos your workers add to their job cards appear here.</p>`}</div>`;

    const waiting = (d.waiting || []).map((w) => `<button class="row es-row" data-go="engagement/${esc(w.id)}"><span class="ic">${icon("task", 17)}</span><span class="tx"><b>Sign off: ${esc(w.title)}</b><small>${esc(w.worker || "")} signed off · ${money(w.amount)} held</small></span><span class="pill warn">Review</span></button>`).join("");
    const jobs = (d.jobs || []).map((j) => `<button class="row es-row" data-go="engagement/${esc(j.id)}"><span class="ic">${icon("rep", 17)}</span><span class="tx"><b>${esc(j.title)}</b><small>#BX-${esc(j.card_no)} · ${esc(j.worker || "")} · ${j.progress}% complete</small></span>${pill(j.status)}</button>`).join("");

    return head("My build", `<button class="btn-dark sm" data-go="hires">Hires</button>`) + top + statsHtml + site
      + (waiting ? sec("Waiting for you") + waiting : "")
      + sec("Jobs in this build") + (jobs || empty("hire", "No jobs yet", "Post a job and hire a professional. Each hire gets a job card that feeds this page.", `<button class="btn-light sm" data-go="post-job">Post a job</button>`));
  }

  function editSheet() {
    const b = state.build || {};
    F().openSheet(b.name ? "Edit my build" : "Set up my build", `<p class="es-s">Only you see this. The money and progress come from your job cards.</p>
      ${F().fld("Build name", F().inp("name", { max: 80, val: b.name || "", ph: "e.g. 4-bedroom house" }))}
      ${F().fld("Location", F().inp("location", { max: 120, val: b.location || "", ph: "e.g. Abuakwa, Kumasi" }))}
      <div class="two-col">${F().fld("Budget (GH₵)", F().inp("budget", { type: "number", min: 1, step: 1, val: b.budget_ghs || "" }))}${F().fld("Finish date", F().inp("due", { type: "date", val: b.due_on || "" }))}</div>
      <p class="wl-err" id="bdE"></p><button class="es-btn" data-bd="save">Save</button>`);
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-bd]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(); e.preventDefault(); e.stopPropagation();
    if (el.dataset.bd === "edit") return editSheet();
    if (el.dataset.bd === "save") {
      const err = document.getElementById("bdE"); err.textContent = ""; el.disabled = true; el.classList.add("busy");
      try {
        await rpc(c, "build_save", { p_name: val("name"), p_location: val("location") || null, p_budget: val("budget") ? parseFloat(val("budget")) : null, p_due: val("due") || null });
        F().closeSheet(); c.toast("Build saved."); window.APP.route();
      } catch (x) { err.textContent = String(x?.message || "Could not save.").replace(/^./, (m) => m.toUpperCase()); el.disabled = false; el.classList.remove("busy"); }
    }
  }, true);

  /* compact card for the client's home */
  async function homeCard(c) {
    const d = (await rpc(c, "my_build").catch(() => null)) || {};
    const b = d.build, waiting = (d.waiting || []).length;
    if (!b && !(d.jobs || []).length) return `<button class="inv-card" data-go="build"><span class="ic">${icon("site", 20)}</span><span class="tx"><b>Set up my build</b><small>Track your budget, progress and site photos in one place</small></span></button>`;
    return `<button class="inv-card${waiting ? " warn" : ""}" data-go="build"><span class="ic">${icon("site", 20)}</span><span class="tx"><b>${esc(b?.name || "My build")}</b><small>${d.progress}% complete · ${money(d.paid)} paid${waiting ? ` · ${waiting} waiting for you` : ""}</small></span>${waiting ? `<span class="pill warn">${waiting}</span>` : ""}</button>`;
  }

  window.BUILD = { homeCard };
  window.DASH.register("build", view);
})();
