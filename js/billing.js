/* BAID X billing screens. The browser only shows state and starts a checkout; it never decides
   whether a payment succeeded. Prices come from the database, and paid access is switched on
   by the server after Paystack's signed webhook is verified.
   Layout (same as the app's PlansBillingScreen): Plans (your plan, monthly/yearly, plan cards,
   compare table), Services (Boosts, Verification, Fees) and Payments. */
(() => {
  "use strict";
  const { esc, pretty, icon } = window.BX;
  const U = () => window.DASH.ui;
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const cedi = (minor, cur = "GHS") => `${cur === "GHS" ? "GH₵" : cur + " "}${(minor / 100).toLocaleString("en-GH", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const date = (d) => new Date(d).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const svg = (p, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const CHECK = (s = 16) => svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', s);
  const DASHI = (s = 16) => svg('<path d="M6 12h12"/>', s);
  const TIERS = ["pro", "premium", "enterprise"];
  const TIER_NAME = { access: "Access", pro: "Pro", premium: "Premium", enterprise: "Enterprise" };
  const CAP = { org_members: "people in your organization", active_projects: "active projects", job_postings_per_month: "job posts a month", org_admins: "organization admins", collaborators_per_project: "collaborators per project" };
  const STATUS = { active: ["Active", "ok"], trialing: ["Trial", "ok"], grace_period: ["Payment due", "warn"], past_due: ["Payment due", "warn"], cancel_at_period_end: ["Ends soon", "warn"], cancelled: ["Cancelled", "bad"], expired: ["Expired", "bad"], suspended: ["Paused", "bad"] };
  const PAY_STATUS = { successful: ["Paid", "ok"], pending: ["Not paid", ""], processing: ["Checking", "warn"], failed: ["Failed", "bad"], refunded: ["Refunded", ""], partially_refunded: ["Part refunded", ""], cancelled: ["Cancelled", "bad"], disputed: ["Disputed", "warn"], reversed: ["Reversed", "bad"] };
  const pill = (map, k) => { const [l, c] = map[k] || [pretty(k), ""]; return `<span class="bl-pill ${c}">${esc(l)}</span>`; };
  const state = { interval: "monthly", ctx: null, tab: "plans", svc: null, boost: null, job: null };
  const LIVE = ["active", "trialing", "grace_period", "past_due", "cancel_at_period_end"];
  // what the free Access plan includes; the limits are checked by the database (supabase/phase20_pricing_v2.sql)
  const accessText = (role) => role === "worker" ? "Free for good: profile, search, messaging, reviews, escrow payments and 5 job applications a month."
    : role === "company" || role === "individual-employer" ? "Free for good: profile, search, messaging, reviews, escrow payments and 1 open job post at a time."
    : "Free for good: profile, search, messaging, reviews and escrow payments.";
  // Compare table: only what each plan really changes (limits by database trigger, mark and order by promoted()).
  function compareRows(role, tiers) {
    const t = (vals) => ["access", ...tiers].map((k) => vals[k]);
    const rows = [];
    if (role === "worker") rows.push(["Job applications", t({ access: "5 a month", pro: "Unlimited", premium: "Unlimited", enterprise: "Unlimited" })]);
    if (role === "company" || role === "individual-employer") rows.push(["Open job posts", t({ access: "1 at a time", pro: "Unlimited", premium: "Unlimited", enterprise: "Unlimited" })]);
    rows.push(["Mark beside your name", t({ access: false, pro: "Pro", premium: "Premium", enterprise: "Enterprise" })]);
    rows.push(["Place in Discover", t({ access: "Standard", pro: "Before free", premium: "Above Pro", enterprise: "Top of paid" })]);
    rows.push(["Support", t({ access: "Standard", pro: "Priority", premium: "First in line", enterprise: "Named contact" })]);
    if (tiers.includes("enterprise")) rows.push(["Team organization", t({ access: false, pro: false, premium: false, enterprise: true })]);
    return rows;
  }
  // which boost the member buys: a profile (Discover) or a job (job list)
  const BOOST_FOR = { worker: "profile", "project-manager": "profile", business: "profile", company: "job", "individual-employer": "job" };
  const dur = (h) => (h < 48 ? `${h / 24 === 1 ? "1 day" : `${h} hours`}` : `${Math.round(h / 24)} days`);

  function openSheet(title, html) {
    const root = document.getElementById("sheetRoot");
    root.innerHTML = `<div class="sx-bg" data-close></div><div class="sx" role="dialog" aria-label="${esc(title)}"><div class="sx-h"><b>${esc(title)}</b><button class="sx-x" data-close aria-label="Close">${icon("plus", 18)}</button></div><div class="sx-b">${html}</div></div>`;
    document.body.classList.add("sx-open");
  }
  const closeSheet = () => { const r = document.getElementById("sheetRoot"); if (r) r.innerHTML = ""; document.body.classList.remove("sx-open"); };
  const seg = (items, cur, act, cls = "") => `<div class="bl-seg ${cls}" role="tablist">${items.map(([k, l, tag]) => `<button role="tab" aria-selected="${k === cur}" class="${k === cur ? "on" : ""}" data-bact="${act}" data-k="${k}">${esc(l)}${tag ? `<em>${esc(tag)}</em>` : ""}</button>`).join("")}</div>`;

  async function billingView(c) {
    const { head } = U();
    const [plans, slots, sum, pays, svc] = await Promise.all([
      c.sb.from("membership_plans").select("*").eq("role", c.role).eq("is_active", true).then((r) => r.data || []),
      c.sb.from("founding_slots").select("*").eq("role", c.role).maybeSingle().then((r) => r.data),
      rpc(c, "billing_summary").catch(() => ({ subscribed: false })),
      rpc(c, "my_receipts").catch(() => []),
      c.sb.from("service_catalog").select("id,kind,code,label,price_minor,currency,duration_hours,metadata,role").eq("is_active", true).order("price_minor", { ascending: true }).then((r) => r.data || []),
    ]);
    const open = !!slots && !!slots.program_start && new Date(slots.program_start) <= new Date() && new Date(slots.program_end || new Date(slots.program_start).getTime() + 90 * 864e5) > new Date() && slots.claimed_slots < slots.total_slots;
    const mine = svc.filter((x) => (!x.role || x.role === c.role) && (x.kind !== "boost" || (x.metadata?.target === "job") === (BOOST_FOR[c.role] === "job")));
    state.ctx = { plans, role: c.role, sum, svc: mine };
    state.founding = open;
    const tab = ["plans", "services", "history"].includes(state.tab) ? state.tab : "plans";
    const top = head("Plans & billing") + `<p class="bl-lead">Your plan, boosts, verification and receipts. Pay with Mobile Money, bank or card.</p>`
      + seg([["plans", "Plans"], ["services", "Services"], ["history", "Payments"]], tab, "tab", "main");
    if (tab === "services") return `<div class="bl">${top}${await servicesView(c, mine)}</div>`;
    if (tab === "history") return `<div class="bl">${top}${historyView(pays)}</div>`;
    return `<div class="bl">${top}${plansView(c, plans, slots, sum, open)}</div>`;
  }

  /* ---------------- Plans ---------------- */
  function plansView(c, plans, slots, sum, open) {
    const std = (t, i) => plans.find((p) => p.tier === t && p.billing_interval === i && !p.is_founding);
    const fnd = (t, i) => plans.find((p) => p.tier === t && p.billing_interval === i && p.is_founding);
    const cur = sum.subscribed && LIVE.includes(sum.status) ? sum.tier : "access";
    const tiers = TIERS.filter((t) => std(t, "monthly"));
    const annual = state.interval === "annual";
    let html = nowCard(sum, cur, c.role);
    html += seg([["monthly", "Monthly"], ["annual", "Yearly", "2 months free"]], state.interval, "interval", "int");
    if (open) html += `<div class="bl-note">${icon("star", 16)}<span>Founding prices are open: 30% off for your first 12 months. ${slots.total_slots - slots.claimed_slots} places left.</span></div>`;
    html += `<div class="bl-plans">`;
    html += `<article class="bl-plan ${cur === "access" ? "cur" : ""}"><header><div><h3>Access</h3><p>Everyone starts here.</p></div>${cur === "access" ? `<span class="bl-pill ok">Your plan</span>` : ""}</header>
      <div class="bl-price"><b>Free</b><small>for good</small></div><p class="bl-small">${esc(accessText(c.role))}</p></article>`;
    html += tiers.map((t) => {
      const p = std(t, state.interval), f = open ? fnd(t, state.interval) : null, show = f || p, isCur = cur === t;
      const meta = p.metadata || {}, list = Array.isArray(meta.benefits) ? meta.benefits : [];
      const caps = Object.entries(p.capacity_limits || {}).map(([k, v]) => ({ t: `Up to ${Number(v).toLocaleString("en-GH")} ${CAP[k] || pretty(k)}` }));
      const perMonth = annual ? `<div class="bl-per">${cedi(Math.round(show.price_minor / 12))} a month, billed yearly · 2 months free</div>` : "";
      const cta = isCur ? `<button class="bl-btn ghost" disabled>Your current plan</button>` : `<button class="bl-btn ${t === "pro" && cur === "access" ? "" : "dark"}" data-bact="choose" data-id="${esc(show.id)}">${cur === "access" ? "Choose" : "Switch to"} ${TIER_NAME[t]}</button>`;
      return `<article class="bl-plan ${isCur ? "cur" : ""}"><header><div><h3>${TIER_NAME[t]} <span class="m-plan">${TIER_NAME[t]}</span></h3><p>${esc(meta.best_for || "")}</p></div>${isCur ? `<span class="bl-pill ok">Your plan</span>` : ""}</header>
        <div class="bl-price"><b>${cedi(show.price_minor)}</b><small>/ ${annual ? "year" : "month"}</small>${f ? `<s>${cedi(p.price_minor)}</s>` : ""}</div>${perMonth}
        <ul class="bl-list">${[...list, ...caps].filter((b) => b.t).map((b) => `<li><i>${CHECK(14)}</i><div><b>${esc(b.t)}</b>${b.d ? `<small>${esc(b.d)}</small>` : ""}</div></li>`).join("")}</ul>${cta}</article>`;
    }).join("");
    html += `</div>`;
    const rows = compareRows(c.role, tiers), cols = ["access", ...tiers];
    const cell = (v) => v === true ? `<i class="y">${CHECK(15)}</i>` : v === false ? `<i class="n">${DASHI(15)}</i>` : esc(v);
    html += `<h2 class="bl-h">Compare plans</h2><div class="bl-cmp"><table><thead><tr><th></th>${cols.map((k) => `<th class="${k === cur ? "cur" : ""}">${TIER_NAME[k]}</th>`).join("")}</tr></thead><tbody>${rows.map(([l, v]) => `<tr><th>${esc(l)}</th>${v.map((x, i) => `<td class="${cols[i] === cur ? "cur" : ""}">${cell(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    html += `<div class="bl-facts"><div>${svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>')}<span><b>Cancel any time</b>Paid access lasts to the end of the period.</span></div><div>${svg('<path d="M12 3 5 6v6c0 4.500 3 7.500 7 9 4-1.500 7-4.500 7-9V6z"/><path d="m9 12 2 2 4-4"/>')}<span><b>7-day refund window</b>From the day the plan starts.</span></div><div>${icon("lock", 18)}<span><b>Paid through Paystack</b>Mobile Money, bank or card.</span></div></div>
      <p class="bl-fine">A plan never includes a badge. Badges come from a review by our team.</p>`;
    return html;
  }
  function nowCard(s, cur, role) {
    if (cur === "access") return `<section class="bl-now"><div class="bl-now-top"><div><small>YOUR PLAN</small><h2>Access</h2></div><span class="bl-pill">Free</span></div><p>${role === "worker" ? "You can send 5 job applications a month. Pro removes the limit and puts you ahead of free members in Discover." : role === "company" || role === "individual-employer" ? "You can keep 1 job post open at a time. Pro removes the limit and puts you ahead of free members in Discover." : "Pro puts you ahead of free members in Discover, with a Pro mark beside your name."}</p></section>`;
    const live = LIVE.includes(s.status);
    return `<section class="bl-now paid"><div class="bl-now-top"><div><small>YOUR PLAN</small><h2>${esc(TIER_NAME[s.tier] || s.tier)} <span class="m-plan">${esc(TIER_NAME[s.tier] || s.tier)}</span></h2></div>${pill(STATUS, s.status)}</div>
      <dl><div><dt>${s.cancel_at_period_end ? "Access ends" : "Next payment"}</dt><dd>${s.period_end ? esc(date(s.period_end)) : "—"}${s.cancel_at_period_end ? "" : ` · ${cedi(s.price_minor, s.currency)}`}</dd></div>
      <div><dt>Billing</dt><dd>${s.interval === "annual" ? "Yearly" : "Monthly"}</dd></div>
      ${s.founding ? `<div><dt>Founding price until</dt><dd>${esc(date(s.founding_lock_end))}</dd></div>` : ""}
      <div><dt>Refund deadline</dt><dd>${esc(date(s.refund_deadline))}${s.refundable ? "" : " (passed)"}</dd></div></dl>
      ${s.status === "grace_period" ? `<p class="bl-warn">Your last payment didn't go through. Access continues until ${esc(date(s.grace_until))}. Renew below to keep it. Nothing is deleted.</p>` : ""}
      ${s.scheduled_tier ? `<p class="bl-small">Moving to ${esc(TIER_NAME[s.scheduled_tier])} on ${esc(date(s.period_end))}.</p>` : ""}
      ${live && !s.cancel_at_period_end ? `<button class="bl-link" data-bact="cancel">Cancel renewal</button>` : ""}</section>`;
  }

  /* ---------------- Services: boosts, verification, fees ---------------- */
  const VER_TIER = { identity: "identity", standard: "identity", professional: "professional", advanced: "advanced", enhanced: "advanced" };
  const VER_CHECKS = {
    identity: ["Your Ghana Card is checked against your profile", "Green badge on your profile and cards"],
    standard: ["Business registration and TIN checked", "Green badge on your profile and cards"],
    professional: ["Ghana Card, trade certificates and past work checked", "Purple badge on your profile and cards"],
    advanced: ["Everything in Professional", "References and a background check", "White badge, the highest BAID X gives"],
    enhanced: ["Everything in the standard check", "A deeper check of the owners and past work", "White badge, the highest BAID X gives"],
  };
  async function servicesView(c, mine) {
    const kinds = ["boost", "verification"].filter((k) => mine.some((x) => x.kind === k));
    const all = [...kinds, "fees"];
    const k = all.includes(state.svc) ? state.svc : all[0];
    const label = { boost: "Boosts", verification: "Verification", fees: "Fees" };
    let html = seg(all.map((x) => [x, label[x]]), k, "svctab", "sub");
    if (k === "boost") html += await boostView(c, mine.filter((x) => x.kind === "boost"));
    if (k === "verification") html += verifyView(c, mine.filter((x) => x.kind === "verification"));
    if (k === "fees") html += feesView();
    return html;
  }
  async function boostView(c, list) {
    const forJob = BOOST_FOR[c.role] === "job";
    const [{ data: running }, jobs] = await Promise.all([
      c.sb.from("boosts").select("target_type,target_id,expires_at").eq("user_id", c.uid).order("expires_at", { ascending: false }).limit(20).then((r) => r, () => ({ data: [] })),
      forJob ? c.sb.from("jobs").select("id,title").eq(c.role === "company" ? "company_id" : "employer_id", c.uid).eq("status", "open").order("created_at", { ascending: false }).limit(30).then((r) => r.data || []) : Promise.resolve([]),
    ]);
    const now = Date.now(), active = (running || []).filter((b) => Date.parse(b.expires_at) > now);
    const title = (b) => b.target_type === "job" ? (jobs.find((j) => j.id === b.target_id)?.title || "Your job") : "Your profile";
    const sel = list.find((x) => x.code === state.boost) || list.find((x) => x.duration_hours === 168) || list[0];
    if (forJob && !jobs.some((j) => j.id === state.job)) state.job = jobs[0]?.id || null;
    let html = `<section class="bl-hero">${icon("bolt", 26)}<div><h3>Be seen first</h3><p>${forJob ? "Your job goes to the top of the job list, marked Featured, for the time you choose." : "Your profile goes to the top of Discover, marked Featured, for the time you choose."}</p></div></section>`;
    if (active.length) html += `<div class="bl-run">${active.map((b) => `<div><i></i><span><b>${esc(title(b))}</b>Featured until ${esc(new Date(b.expires_at).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</span></div>`).join("")}</div>`;
    if (forJob && !jobs.length) return html + `<section class="bl-card"><h3>Post a job first</h3><p class="bl-small">A boost needs an open job. Post one, then come back to boost it.</p></section>`;
    html += `<section class="bl-card">`;
    if (forJob) html += `<label class="bl-lab" for="blJob">Job to boost</label><select id="blJob" class="bl-select">${jobs.map((j) => `<option value="${esc(j.id)}" ${j.id === state.job ? "selected" : ""}>${esc(j.title)}</option>`).join("")}</select>`;
    html += `<div class="bl-lab">How long</div><div class="bl-dur n${list.length}">${list.map((x) => `<button class="${x === sel ? "on" : ""}" data-bact="dur" data-code="${esc(x.code)}"><b>${esc(dur(x.duration_hours))}</b><small>${cedi(x.price_minor, x.currency)}</small></button>`).join("")}</div>`;
    const days = Math.max(1, sel.duration_hours / 24);
    html += `<div class="bl-sum"><span>${esc(dur(sel.duration_hours))} of Featured placement</span><b>${cedi(sel.price_minor, sel.currency)}</b></div><p class="bl-small">About ${cedi(Math.round(sel.price_minor / days / 100) * 100)} a day. Starts as soon as Paystack confirms the payment.</p>
      <button class="bl-btn" data-bact="boost-go" data-code="${esc(sel.code)}">Boost for ${cedi(sel.price_minor, sel.currency)}</button></section>`;
    return html;
  }
  function verifyView(c, list) {
    const B = window.BX.BADGES, me = c.profile || {};
    const cur = me.verification_status === "verified" ? (B[me.badge_tier] ? me.badge_tier : "verified") : null;
    let html = cur ? `<section class="bl-now"><div class="bl-now-top"><div><small>YOUR BADGE</small><h2>${esc(B[cur][1])}</h2></div>${window.BX.badge(cur, 34)}</div><p>${esc(B[cur][2])}. Shown on your profile, cards and search results.</p></section>` : "";
    html += `<section class="bl-hero">${window.BX.badge(cur || "identity", 28)}<div><h3>${cur ? "Go further" : "Get verified"}</h3><p>Our team checks your documents by hand. The fee pays for the check, not the result, and no plan includes a badge.</p></div></section>`;
    html += list.map((x) => {
      const tier = VER_TIER[x.code] || "identity", col = B[tier][0], has = cur === tier;
      const name = x.code === "standard" ? "Business" : x.code === "enhanced" && c.role === "business" ? "Enhanced business" : pretty(x.code);
      return `<article class="bl-ver"><header><span class="bl-vi" style="color:${col};border-color:${col}55;background:${col}14">${window.BX.badge(tier, 26)}</span><div><h3>${esc(name)}</h3><small>One-time review</small></div><b>${cedi(x.price_minor, x.currency)}</b></header>
        <ul class="bl-list tight">${(VER_CHECKS[x.code] || []).map((t) => `<li><i>${CHECK(14)}</i><div><span>${esc(t)}</span></div></li>`).join("")}</ul>
        ${has ? `<button class="bl-btn ghost" disabled>Your badge</button>` : `<button class="bl-btn dark" data-bact="svc" data-kind="verification" data-code="${esc(x.code)}">Request review · ${cedi(x.price_minor, x.currency)}</button>`}</article>`;
    }).join("");
    html += `<ol class="bl-steps"><li><b>Pay the review fee</b>With Mobile Money, bank or card.</li><li><b>Send your documents</b>Profile → Verification documents.</li><li><b>Get the decision</b>A reviewer decides and you get a notification.</li></ol>`;
    return html;
  }
  function feesView() {
    const row = (a, b, c2) => `<div class="bl-fee"><span><b>${a}</b><small>${c2}</small></span><em>${b}</em></div>`;
    return `<section class="bl-card fees">${row("Service fee", "10%", "Taken from money released to you from escrow. Nothing is charged on a refund.")}${row("Adding money", "1.95%", "Paystack's processing fee, shown before you pay.")}${row("Withdrawals", "Free", "To Mobile Money, from GH₵10.")}${row("Disputes", "Free", "Money is frozen while BAID X reviews it.")}</section>
      <p class="bl-fine">Every fee is shown before you confirm. Full details are on the <a href="pricing/" target="_blank" rel="noopener">pricing page</a> and in the terms, sections 6 to 9.</p>`;
  }

  /* ---------------- Payments ---------------- */
  function historyView(pays) {
    if (!pays.length) return `<section class="bl-card"><h3>No payments yet</h3><p class="bl-small">Receipts for plans, boosts and verification show here.</p></section>`;
    const ic = { subscription: "crown", boost: "bolt", verification: "seal", wallet_deposit: "wallet" };
    return `<div class="bl-hist">${pays.map((p) => `<div class="bl-row"><span class="bl-ri">${icon(ic[p.purpose] || "pay", 18)}</span><span class="bl-rt"><b>${esc(p.what || pretty(p.purpose))}</b><small>${p.about ? `${esc(p.about)} · ` : ""}${esc(date(p.created_at))}</small><small class="mono">${esc(p.reference)}</small></span><span class="bl-ra"><b>${cedi(p.amount_minor || 0, p.currency)}</b>${pill(PAY_STATUS, p.status)}</span></div>`).join("")}</div>
      <p class="bl-fine">"Not paid" means checkout was opened but Paystack never confirmed a payment. Nothing was charged.</p>`;
  }

  /* ---- full-screen status screens: opening Paystack, then confirming the payment ---- */
  const LOCK = (n = 14) => icon("lock", n);
  function overlay(html) { let d = document.getElementById("payOv"); if (!d) { d = document.createElement("div"); d.id = "payOv"; d.className = "pay-ov"; document.body.appendChild(d); } d.innerHTML = `<div class="pay-in">${html}</div>`; return d; }
  const closeOverlay = () => document.getElementById("payOv")?.remove();
  const stepRow = (n, t, sub, st) => `<div class="ps ${st}"><i>${st === "done" ? icon("check", 14) : n}</i><div><b>${esc(t)}</b><small>${esc(sub)}</small></div></div>`;
  // Mobile Money, bank or card: Paystack then opens on that option only. Plans paid by card renew automatically;
  // Mobile Money and bank pay for one period at a time.
  const METHODS = [["momo", "Mobile Money", "MTN MoMo, Telecel Cash or AirtelTigo Money", "phone"], ["bank", "Bank", "Pay from your bank account", "site"], ["card", "Card", "Visa or Mastercard", "pay"]];
  function methodSheet(reference, plan) {
    openSheet("How do you want to pay?", `${METHODS.map(([k, l, d, ic]) => `<button class="paym" data-bact="paywith" data-m="${k}" data-ref="${esc(reference)}"><span class="pmi">${icon(ic, 22)}</span><span class="pmt"><b>${esc(l)}</b><small>${esc(d)}</small></span>${icon("chev", 18)}</button>`).join("")}
      ${plan ? `<p class="cap2">Card renews automatically each ${plan === "annual" ? "year" : "month"}. With Mobile Money or bank you pay for one ${plan === "annual" ? "year" : "month"} and renew from Plans &amp; billing; we remind you before it ends.</p>` : ""}
      <p class="cap2">${LOCK(12)} Paid securely through Paystack. BAID X never sees your PIN or card number.</p>`);
  }
  async function goPaystack(c, reference, method, plan) {
    if (!method) return methodSheet(reference, plan);
    closeSheet();
    overlay(`<div class="pay-spin"></div><b>Opening Paystack</b><small>Taking you to the secure payment page…</small><div class="pay-pill">${LOCK()} Paystack · ${esc((METHODS.find((m) => m[0] === method) || [0, ""])[1])}</div>`);
    try {
      const { data: { session } } = await c.sb.auth.getSession();
      const r = await fetch("/api/paystack-initialize", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ reference, method }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { closeOverlay(); c.toast("Your sign-in expired. Please sign in again to pay.", "err"); setTimeout(async () => { await window.BX.sessionAlive(); location.replace("auth.html?mode=signin"); }, 1500); return; }
      if (!r.ok || !j.authorization_url) { closeOverlay(); return c.toast(r.status === 404 || r.status === 503 ? "Payments are not switched on yet. Nothing was charged." : j.error || "Couldn't reach Paystack. Nothing was charged.", "err"); }
      location.href = j.authorization_url;
    } catch { closeOverlay(); c.toast("Couldn't reach Paystack. Nothing was charged.", "err"); }
  }
  window.BX_PAY = { goPaystack };

  /* ---- coming back from Paystack: confirm the payment with the server, which asks Paystack itself ---- */
  async function confirmReturn() {
    const m = (location.href.match(/reference=(BXP-[A-Z0-9]{16})/) || location.href.match(/trxref=(BXP-[A-Z0-9]{16})/)); if (!m) return;
    const ref = m[1], app = window.APP; if (!app?.state.me?.session) return setTimeout(confirmReturn, 400);
    const dest = /wallet/.test(location.hash) ? "#/wallet" : "#/billing";
    history.replaceState(null, "", location.pathname + dest);
    const c = app.dashCtx();
    const show = (st) => overlay(`<div class="pay-ring">${icon("shield", 34)}</div><b>Confirming your payment</b><small>We're checking with Paystack. This takes a few seconds.</small><div class="pay-steps">${stepRow(1, "Payment received", "Back from Paystack", "done")}${stepRow(2, "Verifying with Paystack", "Checking amount and reference", st === 2 ? "now" : "done")}${stepRow(3, "Activating your purchase", "Unlocking it on your account", st === 3 ? "now" : "")}</div>`);
    show(2);
    for (let i = 0; i < 8; i++) {
      try {
        const { data: { session } } = await c.sb.auth.getSession();
        const r = await fetch("/api/paystack-initialize", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ action: "verify", reference: ref }) });
        const j = await r.json().catch(() => ({}));
        if (j.status === "successful") {
          await app.refresh();
          overlay(`<div class="pay-ring ok">${icon("check", 38)}</div><b>Payment confirmed</b><small>Your purchase is active.</small><div class="pay-steps">${stepRow(1, "Payment received", "Paystack confirmed it", "done")}${stepRow(2, "Verified with Paystack", "Amount and reference match", "done")}${stepRow(3, "Activated", "It's on your account now", "done")}</div><button class="btn-light" style="width:100%;margin-top:16px" data-bact="pay-done">Done</button><p class="cap2" style="text-align:center;margin-top:10px">Receipt saved in Payments · Ref ${esc(ref)}</p>`);
          return;
        }
        if (j.status === "failed") { closeOverlay(); return c.toast("That payment didn't go through. Nothing was charged.", "err"); }
        if (i === 1) show(3);
      } catch { /* retry */ }
      await new Promise((ok) => setTimeout(ok, 2500));
    }
    closeOverlay(); c.toast("Still waiting for Paystack to confirm. Your purchase activates as soon as it does.", "warn");
  }
  window.addEventListener("load", () => setTimeout(confirmReturn, 600));


  function checkoutSheet(plan) {
    const annual = plan.billing_interval === "annual", now = new Date();
    const renew = new Date(now.getTime() + (annual ? 365 : 30) * 864e5), refund = new Date(now.getTime() + 7 * 864e5);
    const std = state.ctx.plans.find((p) => p.tier === plan.tier && p.billing_interval === plan.billing_interval && !p.is_founding);
    const row = (a, b) => `<div class="bl-kv"><span>${esc(a)}</span><b>${b}</b></div>`;
    openSheet(`${TIER_NAME[plan.tier]} plan`, `<div class="bl-due"><small>Pay today</small><b>${cedi(plan.price_minor, plan.currency)}</b><span>${annual ? "for one year" : "for one month"}</span></div>
      ${row("Account", esc(pretty(plan.role === "individual-employer" ? "client" : plan.role === "business" ? "supplier" : plan.role)))}${row("Renews", `${cedi(plan.price_minor, plan.currency)} on about ${esc(date(renew))}`)}
      ${plan.is_founding ? row("Founding price", "12 months, then " + cedi(std.price_minor, plan.currency)) : ""}
      ${row("Refund deadline", esc(date(refund)))}
      <p class="bl-small">Stop renewal any time and keep access to the end of the period. If a payment fails you get 7 days of grace. Nothing is ever deleted.</p>
      <button class="bl-btn" data-bact="pay" data-id="${esc(plan.id)}">Continue to payment</button>
      <p class="bl-fine">Next you choose Mobile Money, bank or card. Access starts once Paystack confirms the payment.</p>`);
  }

  async function pay(c, id) {
    let ck;
    try { ck = await rpc(c, "billing_start_checkout", { p_plan: id, p_org: null }); } catch (e) { return c.toast(e.message || "Couldn't start checkout"); }
    const plan = state.ctx.plans.find((p) => p.id === id);
    return goPaystack(c, ck.reference, null, plan?.billing_interval || "monthly");
  }
  async function startService(c, kind, code, detail) {
    let ck;
    try { ck = await rpc(c, "billing_start_service", { p_kind: kind, p_code: code, p_target: detail || {}, p_org: null }); } catch (e) { return c.toast(e.message || "Couldn't start checkout"); }
    return goPaystack(c, ck.reference);
  }

  document.addEventListener("change", (e) => { if (e.target.id === "blJob") state.job = e.target.value; });
  document.addEventListener("click", async (e) => {
    if (!window.APP?.state.me?.role) return;
    if (e.target.closest("[data-close]")) return closeSheet();
    const el = e.target.closest("[data-bact]"); if (!el) return;
    const c = window.APP.dashCtx(), a = el.dataset.bact;
    if (a === "paywith") return goPaystack(c, el.dataset.ref, el.dataset.m);
    if (a === "pay-done") { closeOverlay(); return window.APP.route(); }
    if (a === "tab") { state.tab = el.dataset.k; return window.APP.route(); }
    if (a === "svctab") { state.svc = el.dataset.k; return window.APP.route(); }
    if (a === "interval") { state.interval = el.dataset.k; return window.APP.route(); }
    if (a === "dur") { state.boost = el.dataset.code; return window.APP.route(); }
    if (a === "svc") { el.disabled = true; await startService(c, el.dataset.kind, el.dataset.code, {}); el.disabled = false; return; }
    if (a === "boost-go") { el.disabled = true; await startService(c, "boost", el.dataset.code, BOOST_FOR[c.role] === "job" ? { target_id: state.job } : {}); el.disabled = false; return; }
    if (a === "choose") { const plan = state.ctx.plans.find((p) => p.id === el.dataset.id); return checkoutSheet(plan); }
    if (a === "pay") { el.disabled = true; await pay(c, el.dataset.id); el.disabled = false; return; }
    if (a === "cancel") return openSheet("Cancel renewal", `<p class="bl-small">Your plan will not renew. You keep paid access until the end of the period you already paid for. Nothing is deleted.</p><button class="bl-btn" data-bact="cancel-yes">Stop renewal</button><button class="bl-btn dark" data-close>Keep my plan</button>`);
    if (a === "cancel-yes") { try { await rpc(c, "cancel_subscription", { p_org: null }); c.toast("Renewal stopped. Access continues to the end of the period."); closeSheet(); window.APP.route(); } catch (err) { c.toast(err.message || "Couldn't cancel"); } }
  });
  window.addEventListener("hashchange", closeSheet);
  window.DASH.register("billing", billingView);
})();
