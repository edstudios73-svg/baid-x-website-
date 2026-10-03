/* BAID X billing screens. The browser only shows state and starts a checkout; it never decides
   whether a payment succeeded. Prices come from the database, and paid access is switched on
   by the server after Paystack's signed webhook is verified. */
(() => {
  "use strict";
  const { esc, pretty, icon, ago } = window.BX;
  const U = () => window.DASH.ui;
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const cedi = (minor, cur = "GHS") => `${cur === "GHS" ? "GH₵" : cur + " "}${(minor / 100).toLocaleString("en-GH", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const date = (d) => new Date(d).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const TIERS = ["pro", "premium", "enterprise"];
  const TIER_NAME = { access: "Access", pro: "Pro", premium: "Premium", enterprise: "Enterprise" };
  const CAP = { org_members: "people in your organization", active_projects: "active projects", job_postings_per_month: "job posts a month", org_admins: "organization admins", collaborators_per_project: "collaborators per project" };
  const STATUS = { active: ["Active", "ok"], trialing: ["Trial", "ok"], grace_period: ["Payment due", "warn"], past_due: ["Payment due", "warn"], cancel_at_period_end: ["Ends soon", "warn"], cancelled: ["Cancelled", "bad"], expired: ["Expired", "bad"], suspended: ["Paused", "bad"] };
  const PAY_STATUS = { successful: ["Paid", "ok"], pending: ["Pending", "warn"], processing: ["Checking", "warn"], failed: ["Failed", "bad"], refunded: ["Refunded", ""], partially_refunded: ["Part refunded", ""], cancelled: ["Cancelled", "bad"], disputed: ["Disputed", "warn"], reversed: ["Reversed", "bad"] };
  const pill = (map, k) => { const [l, c] = map[k] || [pretty(k), ""]; return `<span class="pill ${c}">${esc(l)}</span>`; };
  const state = { interval: "monthly", ctx: null };

  function openSheet(title, html) {
    const root = document.getElementById("sheetRoot");
    root.innerHTML = `<div class="sx-bg" data-close></div><div class="sx" role="dialog" aria-label="${esc(title)}"><div class="sx-h"><b>${esc(title)}</b><button class="sx-x" data-close aria-label="Close">${icon("plus", 18)}</button></div><div class="sx-b">${html}</div></div>`;
    document.body.classList.add("sx-open");
  }
  const closeSheet = () => { const r = document.getElementById("sheetRoot"); if (r) r.innerHTML = ""; document.body.classList.remove("sx-open"); };

  async function billingView(c) {
    const { head } = U();
    const [plans, slots, sum, pays] = await Promise.all([
      c.sb.from("membership_plans").select("*").eq("role", c.role).eq("is_active", true).then((r) => r.data || []),
      c.sb.from("founding_slots").select("*").eq("role", c.role).maybeSingle().then((r) => r.data),
      rpc(c, "billing_summary").catch(() => ({ subscribed: false })),
      rpc(c, "my_payments").catch(() => []),
    ]);
    state.ctx = { plans, role: c.role };
    const open = !!slots && !!slots.program_start && new Date(slots.program_start) <= new Date() && new Date(slots.program_end || new Date(slots.program_start).getTime() + 90 * 864e5) > new Date() && slots.claimed_slots < slots.total_slots;
    state.founding = open;
    const std = (t, i) => plans.find((p) => p.tier === t && p.billing_interval === i && !p.is_founding);
    const fnd = (t, i) => plans.find((p) => p.tier === t && p.billing_interval === i && p.is_founding);
    const cur = sum.subscribed && ["active", "trialing", "grace_period", "past_due", "cancel_at_period_end"].includes(sum.status) ? sum.tier : "access";
    const tiers = TIERS.filter((t) => std(t, "monthly"));

    const tab = state.tab || "plans";
    const tabsHtml = `<div class="segs three bt">${[["plans", "Plans"], ["services", "Services & fees"], ["history", "History"]].map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-bact="tab" data-t="${k}">${l}</button>`).join("")}</div>`;
    if (tab === "services") return head("Plans & billing") + tabsHtml + (await servicesView(c));
    if (tab === "history") return head("Plans & billing") + tabsHtml + HISTORY(pays);
    let html = head("Plans & billing") + tabsHtml + currentCard(sum);
    html += `<div class="segs two bi">${["monthly", "annual"].map((i) => `<button class="${state.interval === i ? "on" : ""}" data-bact="interval" data-i="${i}">${i === "monthly" ? "Monthly" : "Annual · save 20%"}</button>`).join("")}</div>`;
    if (open) html += `<div class="cap2 fnd">${icon("star", 14)} Founding member prices are open. ${slots.total_slots - slots.claimed_slots} places left. Your price stays the same for 12 months from your start date.</div>`;
    html += `<div class="dcard plan ${cur === "access" ? "cur" : ""}"><h4><span>Access</span><span class="amb">Free</span></h4><p class="cap2">Everything you need to get started, free for good: profile, search, messaging, applications, reviews and reputation, and XID lookup.</p>${cur === "access" ? `<span class="pill ok">Your plan</span>` : ""}</div>`;
    html += tiers.map((t) => {
      const p = std(t, state.interval), f = open ? fnd(t, state.interval) : null, show = f || p;
      const caps = Object.entries(p.capacity_limits || {}).map(([k, v]) => `<li>${esc(v)} ${esc(CAP[k] || pretty(k))}</li>`).join("");
      const per = state.interval === "monthly" ? "month" : "year";
      const isCur = cur === t;
      return `<div class="dcard plan ${isCur ? "cur" : ""}"><h4><span>${TIER_NAME[t]}</span>${isCur ? `<span class="pill ok">Your plan</span>` : ""}</h4>
        <div class="pr"><b>${cedi(show.price_minor)}</b><small>per ${per}</small>${f ? `<s>${cedi(p.price_minor)}</s>` : ""}</div>
        ${caps ? `<ul class="caps">${caps}</ul>` : ""}
        <div class="prow"><button class="more" data-bact="benefits" data-tier="${t}">See what you get</button>${isCur ? "" : `<button class="btn-light sm" data-bact="choose" data-id="${esc(show.id)}">${cur === "access" ? "Choose " + TIER_NAME[t] : "Switch to " + TIER_NAME[t]}</button>`}</div></div>`;
    }).join("");
    return html;
  }

  const HISTORY = (pays) => `<div class="sec">Payment history</div>` + (pays.length ? pays.map((p) => `<div class="row"><span class="ic">${icon("pay", 17)}</span><span class="tx"><b>${esc(pretty(p.purpose === "wallet_deposit" ? "wallet top-up" : p.purpose))}</b><small>${esc(date(p.created_at))} · ${esc(p.reference)}</small></span><span class="rt"><b>${cedi(p.amount_minor || p.expected_amount_minor || 0, p.currency)}</b>${pill(PAY_STATUS, p.status)}</span></div>`).join("") : `<div class="cap2">No payments yet.</div>`);
  const KIND = { verification: ["Verification", "shield", "Get a verified badge", "Show people you're real. Your badge colour shows how you were verified."], boost: ["Boosts", "bolt", "Be seen first", "A boost lifts your profile or listing in search for the time you choose."], xid: ["Digital ID", "id", "Your digital ID", "A shareable ID card, valid for a year."], promotion: ["Promotions", "mega", "Get your listings noticed", "Featured placement for your catalog listings."] };
  const TIER_OF = { identity: "identity", standard: "identity", professional: "professional", advanced: "advanced", enhanced: "advanced" };
  const BADGE_WORD = { identity: "Green", professional: "Purple", advanced: "Gold" };
  const VER_WHAT = { identity: "Your ID document is checked", standard: "Your business is checked", professional: "ID plus trade and certificates checked", advanced: "Everything, plus references and a background check", enhanced: "Your business, plus a deeper check" };
  const DUR = (h) => (!h ? "" : h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`);
  async function servicesView(c) {
    const { data } = await c.sb.from("service_catalog").select("id,kind,code,label,price_minor,currency,duration_hours,metadata,role").eq("is_active", true).order("price_minor", { ascending: true });
    const mine = (data || []).filter((x) => !x.role || x.role === c.role), kinds = ["verification", "boost", "xid", "promotion"].filter((k) => mine.some((x) => x.kind === k));
    if (!kinds.length) return `<div class="cap2">No services are available for your account type yet.</div>`;
    const k = kinds.includes(state.cat) ? state.cat : kinds[0], [title, icn, heading, blurb] = KIND[k], B = window.BX.BADGES, me = c.profile || {};
    const cur = me.verification_status === "verified" ? (B[me.badge_tier] ? me.badge_tier : "verified") : null;
    const pills = `<div class="cats">${kinds.map((x) => `<button class="cat ${x === k ? "on" : ""}" data-bact="cat" data-k="${x}">${icon(KIND[x][1], 17)} ${esc(KIND[x][0])}</button>`).join("")}</div>`;
    let html = pills;
    if (k === "verification" && cur) html += `<div class="dcard"><h4><span>Your badge</span><span class="pill ok">Active</span></h4><div class="bd-cur">${window.BX.badge(cur, 40)}<div><b>${esc(B[cur][1])}</b><small>${esc(B[cur][2])}. Shown on your profile, cards and search results.</small></div></div></div>`;
    html += `<div class="herob"><span class="hi">${k === "verification" ? window.BX.badge(cur || "identity", 30) : icon(icn, 28)}</span><div><b>${esc(heading)}</b><small>${esc(blurb)}</small></div></div>`;
    if (k === "verification") html += `<div class="lg-grid lg-one">${["verified", "identity", "professional", "advanced"].map((t) => `<div>${window.BX.badge(t, 26)}<b>${esc(t === "verified" ? "Verified" : B[t][1].replace(" verified", ""))}</b><small>${esc(B[t][2])}</small></div>`).join("")}</div>`;
    html += mine.filter((x) => x.kind === k).map((x) => {
      const t = x.metadata?.target, later = k === "promotion" || t === "project" || t === "business_listing";
      const tier = k === "verification" ? TIER_OF[x.code] : null, bd = tier ? B[tier] : null, col = bd ? bd[0] : "#e8d9a8";
      const what = k === "verification" ? VER_WHAT[x.code] || "One-time review" : k === "boost" ? `Lasts ${DUR(x.duration_hours)}` : k === "xid" ? "Valid for one year" : `${DUR(x.duration_hours)}${x.metadata?.listings ? ` · up to ${x.metadata.listings} listings` : ""}`;
      const name = k === "verification" ? pretty(x.code === "standard" ? "business" : x.code) : x.label;
      return `<div class="svc2"><span class="sic" style="background:${col}1f;border-color:${col}55;color:${col}">${tier ? window.BX.badge(tier, 24) : icon(icn, 22)}</span><div class="tx"><b>${esc(name)}</b><small>${esc(what)}</small>${bd ? `<span class="tagc" style="color:${col};border-color:${col}55;background:${col}14">${esc(BADGE_WORD[tier])} badge</span>` : ""}</div><div class="pr"><b>${cedi(x.price_minor, x.currency)}</b>${later ? `<small class="cap2">From the ${k === "promotion" ? "catalog" : t === "project" ? "project" : "listing"} page</small>` : `<button class="btn-light sm" data-bact="svc" data-kind="${esc(k)}" data-code="${esc(x.code)}" data-target="${esc(t || "")}" data-label="${esc(x.label)}" data-price="${x.price_minor}">${k === "boost" ? "Boost" : k === "xid" ? "Get" : "Buy"}</button>`}</div></div>`;
    }).join("");
    return html + `<div class="foot">${icon("lock", 14)} Secure payment with Paystack · Mobile Money or card</div>`;
  }
  async function buyService(c, el) {
    const kind = el.dataset.kind, code = el.dataset.code, target = el.dataset.target;
    let detail = {};
    if (kind === "boost" && target === "job") {
      const col = c.role === "company" ? "company_id" : "employer_id";
      const { data } = await c.sb.from("jobs").select("id,title").eq(col, c.uid).eq("status", "open").order("created_at", { ascending: false }).limit(20);
      if (!data || !data.length) return c.toast("Post a job first, then boost it.");
      return openSheet(el.dataset.label, `<p class="cap2">Choose the job to boost.</p>${data.map((j) => `<button class="btn-dark" style="width:100%;margin-bottom:8px;text-align:left" data-bact="svc-go" data-kind="${esc(kind)}" data-code="${esc(code)}" data-tid="${esc(j.id)}">${esc(j.title)}</button>`).join("")}`);
    }
    return startService(c, kind, code, detail);
  }
  async function startService(c, kind, code, detail) {
    let ck;
    try { ck = await rpc(c, "billing_start_service", { p_kind: kind, p_code: code, p_target: detail || {}, p_org: null }); } catch (e) { return c.toast(e.message || "Couldn't start checkout"); }
    return goPaystack(c, ck.reference);
  }
  /* ---- full-screen status screens: opening Paystack, then confirming the payment ---- */
  const LOCK = (n = 14) => icon("lock", n);
  function overlay(html) { let d = document.getElementById("payOv"); if (!d) { d = document.createElement("div"); d.id = "payOv"; d.className = "pay-ov"; document.body.appendChild(d); } d.innerHTML = `<div class="pay-in">${html}</div>`; return d; }
  const closeOverlay = () => document.getElementById("payOv")?.remove();
  const stepRow = (n, t, sub, st) => `<div class="ps ${st}"><i>${st === "done" ? icon("check", 14) : n}</i><div><b>${esc(t)}</b><small>${esc(sub)}</small></div></div>`;
  async function goPaystack(c, reference) {
    overlay(`<div class="pay-spin"></div><b>Opening Paystack</b><small>Taking you to the secure payment page…</small><div class="pay-pill">${LOCK()} Paystack · Mobile Money &amp; card</div>`);
    try {
      const { data: { session } } = await c.sb.auth.getSession();
      const r = await fetch("/api/paystack-initialize", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ reference }) });
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
          overlay(`<div class="pay-ring ok">${icon("check", 38)}</div><b>Payment confirmed</b><small>Your purchase is active.</small><div class="pay-steps">${stepRow(1, "Payment received", "Paystack confirmed it", "done")}${stepRow(2, "Verified with Paystack", "Amount and reference match", "done")}${stepRow(3, "Activated", "It's on your account now", "done")}</div><button class="btn-light" style="width:100%;margin-top:16px" data-bact="pay-done">Done</button><p class="cap2" style="text-align:center;margin-top:10px">Receipt saved in History · Ref ${esc(ref)}</p>`);
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


  function currentCard(s) {
    if (!s.subscribed) return `<div class="dcard"><h4><span>Your plan</span><span class="pill ok">Access</span></h4><p class="cap2">You are on the free Access plan. Upgrade any time. Nothing is charged unless you confirm a checkout.</p></div>`;
    const live = ["active", "trialing", "grace_period", "past_due", "cancel_at_period_end"].includes(s.status);
    return `<div class="dcard"><h4><span>${esc(TIER_NAME[s.tier] || s.tier)} · ${esc(s.interval)}</span>${pill(STATUS, s.status)}</h4>
      <div class="kv"><span>${s.cancel_at_period_end ? "Access ends" : "Next payment"}</span><b>${s.period_end ? esc(date(s.period_end)) : "—"}${s.cancel_at_period_end ? "" : ` · ${cedi(s.price_minor, s.currency)}`}</b></div>
      ${s.founding ? `<div class="kv"><span>Founding price held until</span><b>${esc(date(s.founding_lock_end))}</b></div>` : ""}
      <div class="kv"><span>Refund deadline</span><b>${esc(date(s.refund_deadline))}${s.refundable ? "" : " (passed)"}</b></div>
      ${s.status === "grace_period" ? `<div class="cap2 warnt">Your last payment didn't go through. Access continues until ${esc(date(s.grace_until))}. Nothing is deleted.</div>` : ""}
      ${s.scheduled_tier ? `<div class="cap2">Moving to ${esc(TIER_NAME[s.scheduled_tier])} on ${esc(date(s.period_end))}.</div>` : ""}
      ${live && !s.cancel_at_period_end ? `<button class="btn-dark sm" data-bact="cancel">Cancel renewal</button>` : ""}</div>`;
  }


  const BEST = { pro: "People who use BAID X regularly and want more room to work.", premium: "Busy members who run several jobs or projects at once.", enterprise: "Teams and larger organizations that need higher limits and shared access." };
  function benefitsSheet(tier) {
    const plans = state.ctx.plans, p = plans.find((x) => x.tier === tier && x.billing_interval === state.interval && !x.is_founding) || plans.find((x) => x.tier === tier);
    if (!p) return;
    const meta = p.metadata || {}, list = Array.isArray(meta.benefits) ? meta.benefits : [];
    const caps = Object.entries(p.capacity_limits || {}).map(([k, v]) => ({ t: `Up to ${v} ${CAP[k] || pretty(k)}`, d: "" }));
    const items = [{ t: "Everything in Access", d: "Profile, search, messaging, applications, reviews, reputation and XID lookup." }, ...list.map((b) => ({ t: b.t || b.title || "", d: b.d || b.desc || "" })), ...caps].filter((b) => b.t);
    openSheet(`${TIER_NAME[tier]} plan`, `<div class="bn">${icon("crown", 22)}<div><b>${cedi(p.price_minor, p.currency)} / ${state.interval === "monthly" ? "month" : "year"}</b><small>Cancel any time · 7-day refund window</small></div></div>
      <div class="bsec"><small>BEST FOR</small><p>${esc(meta.best_for || BEST[tier] || "")}</p></div>
      <div class="bsec"><small>WHAT YOU GET</small>${items.map((b) => `<div class="bi2"><span class="bic">${icon("star", 16)}</span><div><b>${esc(b.t)}</b>${b.d ? `<small>${esc(b.d)}</small>` : ""}</div></div>`).join("")}</div>
      <button class="btn-light" style="width:100%;margin-top:14px" data-bact="choose" data-id="${esc(p.id)}">Choose ${TIER_NAME[tier]} · ${cedi(p.price_minor, p.currency)}</button>`);
  }

  function checkoutSheet(plan, foundingOpen) {
    const annual = plan.billing_interval === "annual", now = new Date();
    const renew = new Date(now.getTime() + (annual ? 365 : 30) * 864e5), refund = new Date(now.getTime() + 7 * 864e5);
    const std = state.ctx.plans.find((p) => p.tier === plan.tier && p.billing_interval === plan.billing_interval && !p.is_founding);
    const row = (a, b) => `<div class="kv"><span>${esc(a)}</span><b>${b}</b></div>`;
    openSheet(`${TIER_NAME[plan.tier]} plan`, `
      ${row("Account type", esc(pretty(plan.role)))}${row("Plan", esc(TIER_NAME[plan.tier]))}${row("Billing", annual ? "Once a year" : "Every month")}
      ${row("Pay today", `<b>${cedi(plan.price_minor, plan.currency)}</b>`)}
      ${row("Renews at", `${cedi(plan.price_minor, plan.currency)} on about ${esc(date(renew))}`)}
      ${plan.is_founding ? row("Founding price held", "12 months from today, then " + cedi(std.price_minor, plan.currency)) : ""}
      ${row("Free trial", "None on this checkout")}
      ${row("Refund deadline", esc(date(refund)) + " (7 days from activation)")}
      ${row("Payment fees", "Any Paystack processing fee is shown by Paystack before you pay")}
      <div class="req"><small>Cancelling</small><p>You can stop renewal at any time. You keep paid access until the end of the period you paid for. Your profile, messages, jobs and projects are never deleted.</p></div>
      <div class="req"><small>If a payment fails</small><p>You get 7 days of grace with access kept. After that the account returns to Access. Nothing is deleted.</p></div>
      <button class="btn-light" style="width:100%" data-bact="pay" data-id="${esc(plan.id)}">Pay ${cedi(plan.price_minor, plan.currency)} with Paystack</button>
      <p class="cap2">Access starts only after Paystack confirms your payment to BAID X. Returning to the site does not by itself activate anything.</p>`);
  }

  async function pay(c, id) {
    let ck;
    try { ck = await rpc(c, "billing_start_checkout", { p_plan: id, p_org: null }); } catch (e) { return c.toast(e.message || "Couldn't start checkout"); }
    try {
      const { data: { session } } = await c.sb.auth.getSession();
      const r = await fetch("/api/paystack-initialize", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ reference: ck.reference }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.authorization_url) return c.toast(r.status === 404 || r.status === 503 ? "Payments are not switched on yet. Nothing was charged." : j.error || "Couldn't reach Paystack. Nothing was charged.");
      location.href = j.authorization_url;
    } catch { c.toast("Couldn't reach Paystack. Nothing was charged."); }
  }

  document.addEventListener("click", async (e) => {
    if (!window.APP?.state.me?.role) return;
    if (e.target.closest("[data-close]")) return closeSheet();
    const el = e.target.closest("[data-bact]"); if (!el) return;
    const c = window.APP.dashCtx(), a = el.dataset.bact;
    if (a === "pay-done") { closeOverlay(); return window.APP.route(); }
    if (a === "cat") { state.cat = el.dataset.k; return window.APP.route(); }
    if (a === "tab") { state.tab = el.dataset.t; return window.APP.route(); }
    if (a === "svc") { el.disabled = true; await buyService(c, el); el.disabled = false; return; }
    if (a === "svc-go") { el.disabled = true; closeSheet(); await startService(c, el.dataset.kind, el.dataset.code, { target_id: el.dataset.tid }); return; }
    if (a === "interval") { state.interval = el.dataset.i; return window.APP.route(); }
    if (a === "benefits") return benefitsSheet(el.dataset.tier);
    if (a === "choose") { const plan = state.ctx.plans.find((p) => p.id === el.dataset.id); return checkoutSheet(plan, state.founding); }
    if (a === "pay") { el.disabled = true; await pay(c, el.dataset.id); el.disabled = false; return; }
    if (a === "cancel") return openSheet("Cancel renewal", `<p class="cap2">Your plan will not renew. You keep paid access until the end of the period you already paid for. Nothing is deleted.</p><div class="btn-row"><button class="btn-light sm" data-bact="cancel-yes">Stop renewal</button><button class="btn-dark sm" data-close>Keep my plan</button></div>`);
    if (a === "cancel-yes") { try { await rpc(c, "cancel_subscription", { p_org: null }); c.toast("Renewal stopped. Access continues to the end of the period."); closeSheet(); window.APP.route(); } catch (err) { c.toast(err.message || "Couldn't cancel"); } }
  });
  window.addEventListener("hashchange", closeSheet);
  window.DASH.register("billing", billingView);
})();
