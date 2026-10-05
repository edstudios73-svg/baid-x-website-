/* Role dashboards: Home, Jobs, Work, Wallet, Career Growth, Projects + PM workspace, Catalog, Inquiries, Hires. */
(() => {
  "use strict";
  const { esc, pretty, icon, money, ago, JOB_CAT_BY_ID, categoriesFor } = window.BX;
  const body = () => document.getElementById("dashBody");

  /* ---------- data helpers (never throw, never fake numbers) ---------- */
  const run = async (p) => { try { const r = await p; if (r.error) throw r.error; return r; } catch (e) { console.warn("query failed:", e?.message || e); return { data: null, count: null, failed: true }; } };
  const count = async (c, table, f = (x) => x) => (await run(f(c.sb.from(table).select("id", { count: "exact", head: true })))).count;
  const rows = async (c, table, cols, f = (x) => x, limit = 30) => (await run(f(c.sb.from(table).select(cols)).limit(limit))).data || [];
  const nz = (v) => (v == null ? "—" : v);

  /* ---------- ui blocks ---------- */
  // The greeting reads the clock first: late night, morning, afternoon, evening, night.
  const period = (h) => (h < 5 ? ["Working late", "moon"] : h < 12 ? ["Good morning", "sun"] : h < 17 ? ["Good afternoon", "sun"] : h < 21 ? ["Good evening", "sunset"] : ["Good night", "moon"]);
  const greet = () => period(new Date().getHours())[0];
  const first = (s) => String(s || "").trim().split(/\s+/)[0] || "there";
  const clockParts = () => { const d = new Date(); return [d.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" }), d.toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "short" })]; };
  const hero = (who, sub, chips = [], verified = false) => {
    const [g, ic] = period(new Date().getHours()), [t, dt] = clockParts();
    const all = (verified ? [`<span class="h-chip v" style="color:${(window.BX.BADGES[window.APP.state.me?.profile?.badge_tier] || window.BX.BADGES.verified)[0]}">${icon("seal", 14)} ${window.BX.BADGES[window.APP.state.me?.profile?.badge_tier]?.[1] || "Verified"}</span>`] : []).concat(chips);
    return `${window.APP.appbar()}<div class="hero2" data-hero><div class="h-top"><span class="h-greet">${icon(ic, 18)}<span data-greet>${g}</span></span><span class="h-time"><b data-clock>${t}</b><span data-date>${dt}</span></span></div><h1>${who}</h1><p>${sub}</p>${all.length ? `<div class="h-chips">${all.join("")}</div>` : ""}</div>`;
  };
  setInterval(() => { const h = document.querySelector("[data-hero]"); if (!h) return; const [g] = period(new Date().getHours()), [t, dt] = clockParts(); h.querySelector("[data-greet]").textContent = g; h.querySelector("[data-clock]").textContent = t; h.querySelector("[data-date]").textContent = dt; }, 20000);
  const pill = (t, kind = "") => `<span class="pill ${kind}">${esc(t)}</span>`;
  const stats = (a) => `<div class="dstats">${a.map(([v, l, ic]) => `<div class="dstat">${ic ? `<span class="si">${icon(ic, 16)}</span>` : ""}<b>${esc(v)}</b><small>${esc(l)}</small></div>`).join("")}</div>`;
  const sec = (t) => `<div class="sec">${esc(t)}</div>`;
  const tile = ([ic, t, s, to]) => `<button class="tile" ${to ? (to.startsWith("trade:") ? `data-trade="${esc(to.slice(6))}"` : `data-go="${to}"`) : "data-soon"}><span class="ic">${icon(ic, 18)}</span><span><b>${esc(t)}</b><small>${esc(s)}</small></span></button>`;
  const tiles = (a) => `<div class="tiles">${a.map(tile).join("")}</div>`;
  const row = (ic, t, s, right = "", attrs = "") => `<button class="row" ${attrs}><span class="ic">${icon(ic, 17)}</span><span class="tx"><b>${esc(t)}</b><small>${esc(s)}</small></span>${right}</button>`;
  const card = (title, right, inner) => `<div class="dcard"><h4><span>${esc(title)}</span>${right ? `<span class="amb">${esc(right)}</span>` : ""}</h4>${inner}</div>`;
  const bar = (pct) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(pct) || 0))}%"></i></div>`;
  const empty = (ic, title, text, cta = "") => `<div class="d-empty">${icon(ic, 44)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${cta}</div>`;
  const segs = (items, active) => `<div class="segs">${items.map(([k, l, to]) => `<button class="${k === active ? "on" : ""}" data-go="${to}">${esc(l)}</button>`).join("")}</div>`;
  const head = (title, right = "") => `<div class="d-head"><h1>${esc(title)}</h1>${right}</div>`;
  const banner = (c) => (c.cl && c.cl.done < c.cl.total && c.profile.verification_status !== "verified"
    ? `<div class="banner"><span class="b-ic">${icon("star", 18)}</span><div class="b-txt"><p>Your profile isn't public yet. Complete the required items to be approved.</p><b>${c.cl.done}/${c.cl.total} complete</b></div><button class="b-btn" data-go="checklist">Continue setup</button></div>` : "");
  const soonBtn = (t) => `<button class="btn-light sm" data-soon>${esc(t)}</button>`;
  const statusKind = (s) => ({ open: "ok", active: "ok", accepted: "ok", completed: "ok", done: "ok", shortlisted: "warn", submitted: "warn", pending: "warn", planning: "warn", draft: "warn" }[String(s || "").toLowerCase()] || "");
  const trade = (id) => JOB_CAT_BY_ID[id]?.name;
  const canApply = (p) => p.verification_status === "verified" || ["pending_review", "verified"].includes(p.profile_status);

  /* ---------- Home (per role) ---------- */
  const HOME = {
    async worker(c) {
      const p = c.profile;
      const [open, apps, accepted, wallet] = await Promise.all([
        count(c, "jobs", (x) => x.eq("status", "open")),
        count(c, "job_applications", (x) => x.eq("worker_id", c.uid)),
        count(c, "job_applications", (x) => x.eq("worker_id", c.uid).eq("status", "accepted")),
        rows(c, "wallet_accounts", "available_ghs,pending_ghs", (x) => x.eq("owner_id", c.uid), 1),
      ]);
      return hero(esc(first(p.full_name)), `${esc(trade(p.primary_job_category_id) || "Professional")} · ${esc([p.city_town, p.region].filter((v) => v && v !== "Pending").join(", ") || "Add your location")}`, [p.available_for_work ? `<span class="h-chip">● Available for work</span>` : "", `<span class="h-chip">${esc(pretty(p.rank_tier) || "New")} · ${p.xp_total || 0} XP</span>`], p.verification_status === "verified")
        + banner(c) + stats([[nz(open), "Open jobs", "work"], [nz(apps), "Applications", "mail"], [nz(accepted), "Accepted", "task"]])
        + card(pretty(p.rank_tier) || "New worker", `${p.xp_total || 0} XP`, `${bar(Math.min(100, ((p.xp_total || 0) / 2000) * 100))}<div class="cap2">Earn XP by finishing your profile, getting accepted and completing jobs.</div>`)
        + sec("Quick access") + tiles([["wallet", "Wallet", money(wallet[0]?.available_ghs), "wallet"], ["grow", "Career growth", `${p.xp_total || 0} XP`, "growth"], ["work", "Applications", `${nz(apps)} total`, "work"], ["star", "Trust score", Number(p.trust_score || 0).toFixed(1), "growth"]]);
    },
    async company(c) {
      const p = c.profile;
      const projects = await rows(c, "projects", "id,name,status,progress_pct,city_town", (x) => x.eq("company_id", c.uid).order("created_at", { ascending: false }), 5);
      const jobs = await rows(c, "jobs", "id,status", (x) => x.eq("company_id", c.uid), 200);
      const ids = jobs.map((j) => j.id);
      const applicants = ids.length ? await count(c, "job_applications", (x) => x.in("job_id", ids)) : 0;
      const active = projects.filter((x) => ["active", "planning"].includes(String(x.status).toLowerCase())).length;
      const p0 = projects[0];
      return hero(`<em>${esc(p.company_name || "Your company")}</em>`, "Here's how your projects and hiring are doing.", [], p.verification_status === "verified")
        + banner(c) + stats([[active, "Active projects", "proj"], [jobs.filter((j) => j.status === "open").length, "Open jobs", "work"], [applicants, "Applicants", "team"]])
        + (p0 ? card(p0.name, `${p0.progress_pct || 0}%`, `${bar(p0.progress_pct)}<div class="cap2">${pill(pretty(p0.status), statusKind(p0.status))} ${esc(p0.city_town || "")}</div>`)
               : card("Start your first project", "", `<div class="cap2" style="margin:0 0 10px">Define the workers, project manager, equipment and materials you need, then invite people in.</div><button class="btn-light sm" data-go="new-project">Create a project</button>`))
        + sec("Run the business") + tiles([["pay", "Payments", "Records and invoices", "payments"], ["equip", "Equipment", "Find and request", "equipment"], ["mat", "Materials", "Compare supply", "materials"], ["key", "Join code", "Link a project manager", "team-link"]]);
    },
    async "project-manager"(c) {
      const p = c.profile;
      const projects = await rows(c, "projects", "id,name,status,progress_pct,city_town", (x) => x.eq("pm_id", c.uid).order("created_at", { ascending: false }), 10);
      const ids = projects.map((x) => x.id);
      const openTasks = ids.length ? await count(c, "project_tasks", (x) => x.in("project_id", ids).neq("status", "done")) : 0;
      const avg = projects.length ? Math.round(projects.reduce((a, x) => a + (Number(x.progress_pct) || 0), 0) / projects.length) : 0;
      const p0 = projects[0];
      return hero(`${esc(first(p.full_name))} <em>on site</em>`, `${projects.length} assigned project${projects.length === 1 ? "" : "s"} · ${nz(openTasks)} open task${openTasks === 1 ? "" : "s"}`, [], p.verification_status === "verified")
        + banner(c) + stats([[projects.length, "Projects", "proj"], [nz(openTasks), "Open tasks", "task"], [`${avg}%`, "Avg progress", "prog"]])
        + (p0 ? card(p0.name, pretty(p0.status), `${bar(p0.progress_pct)}<div class="cap2">${esc(p0.city_town || "")} ${p0.progress_pct || 0}% complete</div>`)
               : card("No project yet", "", `<div class="cap2" style="margin:0">Ask your company for a join code. Once they approve the link, their projects appear here.</div>`))
        + sec("Your projects") + tiles([["task", "Tasks", `${nz(openTasks)} open`, "ws/tasks"], ["team", "Team", "Build your crew", "ws/team"], ["rep", "Reports", "Daily and weekly", "ws/reports"], ["pay", "Finance", "Requests and records", "ws/finance"]]);
    },
    async business(c) {
      const [products, equip, inq, latest] = await Promise.all([
        count(c, "business_products", (x) => x.eq("business_id", c.uid)), count(c, "business_equipment", (x) => x.eq("business_id", c.uid)),
        count(c, "product_inquiries", (x) => x.eq("business_id", c.uid)),
        rows(c, "product_inquiries", "id,inquirer_name,message,status,created_at", (x) => x.eq("business_id", c.uid).order("created_at", { ascending: false }), 1),
      ]);
      const l = latest[0];
      return hero(`<em>${esc(c.profile.business_name || "Your shop")}</em>`, "Your catalog, equipment and customer inquiries.", [c.profile.accepting_orders ? `<span class="h-chip">● Accepting orders</span>` : ""], c.profile.verification_status === "verified")
        + banner(c) + stats([[nz(products), "Products", "box"], [nz(equip), "Equipment", "equip"], [nz(inq), "Inquiries", "mail"]])
        + (l ? card(`Inquiry from ${l.inquirer_name || "a customer"}`, ago(l.created_at), `<div class="cap2" style="margin:0">${esc(l.message || "")}</div>`)
              : card("No inquiries yet", "", `<div class="cap2" style="margin:0">When a customer or company asks about your listings, it shows up here.</div>`))
        + sec("Quick access") + tiles([["plus", "Add product", "Catalog", "catalog"], ["mail", "Inquiries", `${nz(inq)} total`, "inquiries"], ["equip", "Equipment", `${nz(equip)} listed`, "catalog/equipment"], ["wallet", "Wallet", "Balance and payouts", "wallet"]]);
    },
    async "individual-employer"(c) {
      const jobs = await rows(c, "jobs", "id,status", (x) => x.eq("employer_id", c.uid), 200);
      const ids = jobs.map((j) => j.id);
      const hired = ids.length ? await count(c, "job_applications", (x) => x.in("job_id", ids).eq("status", "accepted")) : 0;
      const trades = ["Electrician", "Plumber", "Painter", "General Handyman"];
      return hero(esc(first(c.profile.full_name)), "Need something fixed or built?", [], c.profile.verification_status === "verified")
        + banner(c) + stats([[jobs.length, "Jobs posted", "work"], [jobs.filter((j) => j.status === "open").length, "Open", "mail"], [hired, "Hired", "hire"]])
        + sec("Find a trade") + tiles(trades.map((t) => ["work", t, "Browse pros", `trade:${t}`]));
    },
  };

  /* ---------- Worker: Jobs marketplace ---------- */
  async function jobsView(c) {
    const [jobs, mine] = await Promise.all([
      rows(c, "jobs", "id,title,description,job_category_id,city_town,region,daily_rate_ghs,workers_needed,created_at", (x) => x.eq("status", "open").order("created_at", { ascending: false }), 50),
      rows(c, "job_applications", "job_id,status", (x) => x.eq("worker_id", c.uid), 200),
    ]);
    c.state.jobsCache = { jobs, applied: Object.fromEntries(mine.map((a) => [a.job_id, a.status])) };
    return head("Job Marketplace") + `<label class="search slim"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.500-3.500"/></svg><input id="jobQ" type="search" placeholder="Search jobs, trades or towns" autocomplete="off" /></label><div id="jobList">${jobList(c, "")}</div>`;
  }
  function jobList(c, q) {
    const { jobs, applied } = c.state.jobsCache, s = q.trim().toLowerCase();
    const list = jobs.filter((j) => !s || `${j.title} ${trade(j.job_category_id) || ""} ${j.city_town || ""} ${j.region || ""}`.toLowerCase().includes(s));
    if (!list.length) return empty("work", jobs.length ? "No matching jobs" : "No open jobs right now", jobs.length ? "Try a different search." : "New jobs from companies and homeowners will appear here. Check back soon.");
    return list.map((j) => `<div class="job"><div class="job-top"><div class="jt">${trade(j.job_category_id) ? `<span class="tr">${esc(trade(j.job_category_id))}</span>` : ""}<b>${esc(j.title)}</b></div><span class="rate">${j.daily_rate_ghs ? `${money(j.daily_rate_ghs)}<small>per day</small>` : `<small>Rate on request</small>`}</span></div>
      ${j.description ? `<p>${esc(j.description)}</p>` : ""}
      <div class="job-info"><span class="pl">${icon("site", 14)}<i>${esc([j.city_town, j.region].filter(Boolean).join(", ") || "Ghana")}</i></span><span>${icon("team", 14)} ${j.workers_needed || 1} needed</span><span>${icon("cal", 14)} ${esc(ago(j.created_at))}</span></div>
      ${applied[j.id] ? `<div class="job-act">${pill(pretty(applied[j.id]), statusKind(applied[j.id]))}</div>` : `<div class="job-act"><button class="btn-light sm" data-apply="${esc(j.id)}">Apply now</button></div>`}</div>`).join("");
  }

  /* ---------- Worker: Work management ---------- */
  async function workView(c, arg) {
    const seg = ["applications", "active", "completed"].includes(arg) ? arg : "applications";
    const apps = await rows(c, "job_applications", "id,job_id,status,proposed_rate_ghs,created_at", (x) => x.eq("worker_id", c.uid).order("created_at", { ascending: false }), 100);
    const jobIds = [...new Set(apps.map((a) => a.job_id))];
    const jobs = jobIds.length ? await rows(c, "jobs", "id,title,city_town,daily_rate_ghs", (x) => x.in("id", jobIds), 100) : [];
    const J = Object.fromEntries(jobs.map((j) => [j.id, j]));
    const f = { applications: (a) => !["accepted", "completed"].includes(a.status), active: (a) => a.status === "accepted", completed: (a) => a.status === "completed" }[seg];
    const list = apps.filter(f);
    const eng = seg !== "applications" && window.ESCROW ? await window.ESCROW.workSection(c, seg).catch(() => "") : "";
    const msgs = { applications: ["No applications yet", "Browse the Job Marketplace and apply to jobs that match your trade.", `<button class="btn-light sm" data-go="jobs">Browse jobs</button>`], active: ["No active work", "Jobs you have been accepted for will show here.", ""], completed: ["Nothing completed yet", "Finished jobs, reviews and earned XP will show here.", ""] }[seg];
    return head("Work") + segs([["applications", "Applications", "work/applications"], ["active", "Active", "work/active"], ["projects", "Projects", "projects"], ["completed", "Completed", "work/completed"], ["wallet", "Wallet", "wallet"]], seg)
      + eng + (seg === "active" && eng ? "" : list.length ? list.map((a) => row("work", J[a.job_id]?.title || "Job", `${J[a.job_id]?.city_town || "Ghana"} · applied ${ago(a.created_at)}${a.proposed_rate_ghs ? ` · you asked ${money(a.proposed_rate_ghs)}` : ""}`, pill(pretty(a.status), statusKind(a.status)))).join("") : empty("work", ...msgs));
  }

  /* ---------- Wallet ---------- */
  async function walletView(c) {
    const [acct, tx] = await Promise.all([
      rows(c, "wallet_accounts", "available_ghs,pending_ghs,lifetime_earned_ghs,lifetime_spent_ghs", (x) => x.eq("owner_id", c.uid), 1),
      rows(c, "wallet_transactions", "id,type,amount_ghs,net_ghs,status,description,created_at", (x) => x.eq("owner_id", c.uid).order("created_at", { ascending: false }), 30),
    ]);
    const a = acct[0] || {};
    return head("Wallet") + `<div class="wallet"><small>Available balance</small><b>${money(a.available_ghs)}</b><div class="w-sub"><span>Pending <b>${money(a.pending_ghs)}</b></span><span>Earned <b>${money(a.lifetime_earned_ghs)}</b></span></div><div class="w-act">${soonBtn("Withdraw")}${soonBtn("Add money")}</div></div>
      <p class="note">Payments are handled manually through Mobile Money for now. Your balance updates once BAID X confirms a payment.</p>${sec("Activity")}`
      + (tx.length ? tx.map((t) => row(Number(t.amount_ghs) < 0 || t.type === "withdrawal" ? "pay" : "wallet", pretty(t.type) || "Transaction", `${t.description || ""} ${ago(t.created_at)}`.trim(), `<span class="amt">${money(t.net_ghs ?? t.amount_ghs)}</span>`)).join("") : empty("wallet", "No transactions yet", "Earnings, deposits and withdrawals will be listed here."));
  }

  /* ---------- Career growth ---------- */
  async function growthView(c) {
    const p = c.profile, xp = p.xp_total || 0;
    const ev = await rows(c, "worker_xp_events", "id,kind,points,created_at", (x) => x.eq("worker_id", c.uid).order("created_at", { ascending: false }), 20);
    return head("Career Growth") + `<div class="wallet"><small>${esc(pretty(p.rank_tier) || "New worker")}</small><b>${xp.toLocaleString()} XP</b>${bar(Math.min(100, (xp / 2000) * 100))}<div class="w-sub"><span>Trust score <b>${Number(p.trust_score || 0).toFixed(1)}</b></span><span>Keep going, levels rise with real work</span></div></div>
      ${sec("How to earn XP")}${[["Verify your identity", "+100 XP"], ["Get accepted for a job", "+80 XP"], ["Complete a job", "+120 XP"], ["Complete your profile", "+50 XP"]].map(([t, v]) => row("star", t, "", `<span class="amt">${v}</span>`)).join("")}
      ${sec("Certifications")}${empty("rep", "No certifications yet", "Upload trade certificates and licences to build trust.", `<button class="btn-light sm" data-go="certs">Add certification</button>`)}
      ${sec("Recent XP")}${ev.length ? ev.map((e) => row("grow", pretty(e.kind), ago(e.created_at), `<span class="amt">+${e.points} XP</span>`)).join("") : empty("grow", "No XP yet", "Complete your profile and apply for jobs to start earning.")}`;
  }

  /* ---------- Company resource pages ---------- */
  const RES = {
    payments: ["pay", "Payments", "Pay your workers and keep a record.", "Worker payments, payroll status and invoices for every project. Money moves by manual Mobile Money for now, and each payment is recorded here as a paper trail.", "Record a payment"],
    equipment: ["equip", "Equipment", "Find and request equipment.", "List the machines each project needs and collect quotes from verified suppliers.", "Request equipment"],
    materials: ["mat", "Materials", "Find and compare materials.", "List the materials a project needs, then compare quotes from suppliers side by side.", "Request materials"],
  };
  const resView = (k) => { const [ic, t, s, text, cta] = RES[k]; return head(t) + `<p class="sub2">${esc(s)}</p>` + empty(ic, `No ${t.toLowerCase()} yet`, text, soonBtn(cta)); };

  /* ---------- Business ---------- */
  async function catalogView(c, arg) {
    const seg = arg === "equipment" ? "equipment" : "products";
    const items = seg === "products"
      ? await rows(c, "business_products", "id,name,category,price,status,available", (x) => x.eq("business_id", c.uid).order("created_at", { ascending: false }), 50)
      : await rows(c, "business_equipment", "id,name,category,daily_rate,status,available", (x) => x.eq("business_id", c.uid).order("created_at", { ascending: false }), 50);
    return head("Catalog", soonBtn(seg === "products" ? "Add product" : "Add equipment")) + segs([["products", "Products", "catalog"], ["equipment", "Equipment", "catalog/equipment"]], seg)
      + (items.length ? items.map((i) => row(seg === "products" ? "box" : "equip", i.name, `${i.category || "Uncategorised"}${(i.price ?? i.daily_rate) != null ? ` · ${money(i.price ?? i.daily_rate)}${seg === "equipment" ? "/day" : ""}` : ""}`, pill(i.available === false ? "Hidden" : "Listed", i.available === false ? "" : "ok"))).join("")
        : empty(seg === "products" ? "box" : "equip", `No ${seg} listed`, "Add what you supply so companies and clients can find and request it.", soonBtn(seg === "products" ? "Add product" : "Add equipment")));
  }
  async function inquiriesView(c) {
    const list = await rows(c, "product_inquiries", "id,inquirer_name,message,status,created_at", (x) => x.eq("business_id", c.uid).order("created_at", { ascending: false }), 50);
    return head("Inquiries") + (list.length ? list.map((i) => row("mail", i.inquirer_name || "Customer", `${i.message || ""}`.slice(0, 80), `<span class="meta2">${esc(ago(i.created_at))}</span>`)).join("") : empty("mail", "No inquiries yet", "When someone asks about a product or equipment listing, it will land here."));
  }

  /* ---------- Client ---------- */
  async function hiresView(c) {
    const jobs = await rows(c, "jobs", "id,title,status,city_town,daily_rate_ghs,created_at", (x) => x.eq("employer_id", c.uid).order("created_at", { ascending: false }), 50);
    return head("Hires", soonBtn("Post a job")) + (jobs.length ? jobs.map((j) => row("hire", j.title, `${j.city_town || "Ghana"}${j.daily_rate_ghs ? ` · ${money(j.daily_rate_ghs)}/day` : ""} · ${ago(j.created_at)}`, pill(pretty(j.status), statusKind(j.status)))).join("")
      : empty("hire", "No hires yet", "Find a trade in Discover, message them and keep a record of everyone you hire here.", `<button class="btn-light sm" data-go="discover">Find a trade</button>`));
  }

  /* ---------- Inbox: invitations, approvals, notifications (shown on every Home) ---------- */
  async function inbox(c) {
    let html = "";
    if (c.role === "worker" || c.role === "project-manager") {
      const r = await run(c.sb.rpc("my_invitations"));
      const n = (r.data || []).length;
      if (n) html += `<button class="inv-card" data-go="invites"><span class="ic">${icon("mail", 20)}</span><span class="tx"><b>${n} project invitation${n > 1 ? "s" : ""}</b><small>Review and reply</small></span><span class="pill">${n}</span></button>`;
    }
    if (c.role === "company") {
      const r = await run(c.sb.rpc("company_approvals"));
      const a = r.data || {};
      const n = ["workers", "requests", "payments", "reports", "completions"].reduce((t, k) => t + (a[k] || []).length, 0);
      if (n) html += `<button class="inv-card warn" data-go="approvals"><span class="ic">${icon("task", 20)}</span><span class="tx"><b>${n} item${n > 1 ? "s" : ""} need your approval</b><small>Workers, requests, payments, reports and completions</small></span><span class="pill warn">${n}</span></button>`;
    }
    const notes = await rows(c, "notifications", "id,title,body,href,meta,created_at,read_at", (x) => x.is("read_at", null).order("created_at", { ascending: false }), 5);
    if (notes.length) html += sec("Updates") + notes.map((n) => `<button class="row note" data-note="${esc(n.id)}" data-href="${esc(n.href || "")}" data-pid="${esc(n.meta?.project_id || "")}"><span class="dot-u"></span><span class="tx"><b>${esc(n.title)}</b><small>${esc(n.body || "")}</small></span><span class="meta2">${esc(ago(n.created_at))}</span></button>`).join("");
    return html;
  }

  /* ---------- Render + events ---------- */
  const VIEWS = { jobs: jobsView, work: workView, wallet: walletView, growth: growthView, catalog: catalogView, inquiries: inquiriesView, hires: hiresView, payments: () => resView("payments"), equipment: () => resView("equipment"), materials: () => resView("materials") };
  let token = 0;
  async function render(name, arg, c) {
    const my = ++token, el = body();
    el.innerHTML = '<div class="skel" style="height:90px;margin-top:16px"></div><div class="skel" style="height:140px;margin-top:12px"></div><div class="skel" style="height:140px;margin-top:12px"></div>';
    let html;
    try { html = name === "home" ? (await HOME[c.role](c)) + (await inbox(c)) : await VIEWS[name](c, arg); }
    catch (e) { console.error(e); html = '<div class="state"><b>Something went wrong</b>Please refresh and try again.</div>'; }
    if (my === token) el.innerHTML = html;
  }

  document.addEventListener("click", async (e) => {
    const t = e.target, app = window.APP; if (!app?.state.me?.role) return;
    const c = app.dashCtx();
    const tr = t.closest("[data-trade]");
    if (tr) { const item = categoriesFor("worker").items.find((i) => i.name.toLowerCase().startsWith(tr.dataset.trade.toLowerCase())); return c.openDiscover("professionals", item); }
    const nt = t.closest("[data-note]");
    if (nt) {
      c.sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", nt.dataset.note).then(() => {});
      const href = nt.dataset.href || "";
      if (nt.dataset.pid) c.state.projectId = nt.dataset.pid;
      if (href.startsWith("#/")) return c.go(href.slice(2));
      return;
    }
    const op = t.closest("[data-open-project]");
    if (op) { c.state.projectId = op.dataset.openProject; return c.go("ws/overview"); }
    const ap = t.closest("[data-apply]");
    if (ap) {
      if (!canApply(c.profile)) { c.toast("Complete your profile before you apply."); return c.go("checklist"); }
      ap.disabled = true; ap.textContent = "Applying…";
      const { error } = await c.sb.from("job_applications").insert({ job_id: ap.dataset.apply, worker_id: c.uid });
      if (error && error.code !== "23505") { ap.disabled = false; ap.textContent = "Apply"; return c.toast(error.message || "Couldn't apply. Try again."); }
      c.state.jobsCache.applied[ap.dataset.apply] = "submitted";
      document.getElementById("jobList").innerHTML = jobList(c, document.getElementById("jobQ")?.value || ""); c.toast("Application sent.");
    }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "jobQ") { const c = window.APP.dashCtx(); document.getElementById("jobList").innerHTML = jobList(c, e.target.value); } });
  document.addEventListener("change", (e) => { if (e.target.id === "projPick") { const c = window.APP.dashCtx(); c.state.projectId = e.target.value; window.APP.route(); } });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "addTask") return; e.preventDefault();
    const c = window.APP.dashCtx(), title = document.getElementById("taskTitle").value.trim(); if (!title) return;
    const { error } = await c.sb.from("project_tasks").insert({ project_id: c.state.projectId, title });
    if (error) return c.toast(error.message || "Couldn't add the task.");
    window.APP.route();
  });

  window.DASH = {
    render, register: (name, fn) => { VIEWS[name] = fn; },
    ui: { run, rows, count, nz, greet, first, hero, pill, stats, sec, tile, tiles, row, card, bar, empty, segs, head, banner, soonBtn, statusKind, trade, canApply },
  };
})();
