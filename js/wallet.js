/* BAID X wallet. Balances live in BAID X; this screen only shows state and starts actions.
   Money in: Paystack (deposit-capable accounts only). Money out: an authorised Mobile Money withdrawal (receiving accounts only).
   What each account type can do comes from the database (wallet_caps), never from this file. */
(() => {
  "use strict";
  const { esc, pretty, icon, ago } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const money = (n) => { const v = Number(n) || 0; return `GH₵${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
  const ROLE = { worker: ["Professional", "user"], company: ["Company", "org"], "project-manager": ["Project manager", "proj"], business: ["Supplier", "store"], "individual-employer": ["Client", "user"] };
  const NOTE = {
    worker: "Clients pay when they hire you and your money lands here once the work is approved. You can withdraw it to Mobile Money any time.",
    business: "When a customer's order is delivered and confirmed, the payment lands here. You can withdraw it to Mobile Money any time.",
    "project-manager": "Your project fees land here when the client approves the work. You can withdraw them to Mobile Money any time.",
    "individual-employer": "Add money with Paystack (Mobile Money or card), then pay for work and products from your balance. Money held for a job is only released when you approve it.",
    company: "Companies both pay and get paid: add money to fund hires and projects, and withdraw what you earn from work you deliver.",
  };
  const TONE = { completed: "ok", approved: "ok", pending: "warn", pending_verification: "warn", under_review: "warn", processing: "warn", rejected: "bad", failed: "bad", cancelled: "bad" };
  const WD_LABEL = { pending: "Processing", processing: "Processing", completed: "Paid", rejected: "Returned", failed: "Returned", cancelled: "Cancelled" };
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const val = (name) => document.querySelector(`#sheetRoot [name="${name}"]`)?.value ?? "";
  let caps = null;

  async function view(c) {
    const { head, sec, empty } = U();
    caps = await rpc(c, "wallet_caps").catch(() => null);
    if (!caps) return head("Wallet") + empty("wallet", "No wallet", "Your account type doesn't have a wallet.");
    const [a, tx, wd, pays] = await Promise.all([
      c.sb.from("wallet_accounts").select("available_ghs,pending_ghs,lifetime_earned_ghs,lifetime_spent_ghs").eq("owner_id", c.uid).maybeSingle().then((r) => r.data || {}),
      c.sb.from("wallet_transactions").select("id,type,amount_ghs,net_ghs,status,description,created_at").eq("owner_id", c.uid).order("created_at", { ascending: false }).limit(30).then((r) => r.data || []),
      caps.can_withdraw ? c.sb.from("withdrawal_requests").select("id,public_id,amount_ghs,status,admin_note,destination_network,destination_account,created_at,processed_at").eq("owner_id", c.uid).order("created_at", { ascending: false }).limit(10).then((r) => r.data || []) : [],
      caps.can_deposit ? rpc(c, "my_payments").catch(() => []) : [],
    ]);
    const [label, ic] = ROLE[caps.role] || ["Account", "user"];
    const wait = (pays || []).filter((p) => p.purpose === "wallet_deposit" && ["pending", "processing"].includes(p.status) && Date.now() - new Date(p.created_at) < 36e5);
    const acts = [caps.can_deposit ? `<button class="wl-btn" data-wl="deposit">${icon("plus", 18)} Add money</button>` : "", caps.can_withdraw ? `<button class="wl-btn ${caps.can_deposit ? "ghost" : ""}" data-wl="withdraw">${icon("pay", 18)} ${caps.can_deposit ? "Withdraw" : "Withdraw to Mobile Money"}</button>` : ""].filter(Boolean);
    return head("Wallet") + `<div class="wl-card"><div class="wl-top"><small>${caps.can_withdraw && !caps.can_deposit ? "Available to withdraw" : "Available balance"}</small><span class="wl-chip">${icon(ic, 14)} ${esc(label)}</span></div>
      <div class="wl-amt"><s>GH₵</s>${esc(Number(a.available_ghs || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</div>
      <div class="wl-sub"><div>${caps.can_withdraw ? "Processing" : "In use"}<b>${money(a.pending_ghs)}</b></div>${caps.can_withdraw ? `<div>Earned<b>${money(a.lifetime_earned_ghs)}</b></div>` : ""}${caps.can_deposit ? `<div>Spent<b>${money(a.lifetime_spent_ghs)}</b></div>` : ""}</div></div>
      <div class="wl-acts ${acts.length === 1 ? "one" : ""}">${acts.join("")}</div>
      ${wait.length ? `<div class="wl-note wait">${icon("clock", 18)}<div>Your payment is being confirmed by Paystack. Your balance updates as soon as it is. Pull to refresh in a moment.</div></div>` : ""}
      <div class="wl-note">${icon("shield", 18)}<div>${esc(NOTE[caps.role] || "")}</div></div>
      ${wd.length ? sec("Withdrawals") + wd.map((w) => `<button class="wl-row" data-wl="wd" data-id="${esc(w.id)}"><span class="ic">${icon("pay", 17)}</span><span class="tx"><b>${money(w.amount_ghs)} · ${esc(w.destination_network || "Mobile Money")}</b><small>${esc(w.public_id)} · ${esc(ago(w.created_at))}</small></span><span class="pill ${TONE[w.status] || ""}">${esc(WD_LABEL[w.status] || pretty(w.status))}</span></button>`).join("") : ""}
      ${sec("Activity")}` + (tx.length ? tx.map((t) => { const plus = ["deposit", "earning", "escrow_release", "escrow_refund"].includes(t.type); return `<div class="wl-row"><span class="ic">${icon(plus ? "wallet" : "pay", 17)}</span><span class="tx"><b>${esc(pretty(t.type) || "Transaction")}</b><small>${esc((t.description || "") + " · " + ago(t.created_at))}</small></span><span class="amt ${plus ? "p" : ""}">${plus ? "+" : "−"} ${money(t.net_ghs ?? t.amount_ghs)}</span></div>`; }).join("") : empty("wallet", "No transactions yet", caps.can_deposit ? "Add money to get started." : "Earnings and withdrawals will be listed here."));
  }

  /* ---- add money (Paystack) ---- */
  let qT = 0;
  function depositSheet() {
    F().openSheet("Add money", `<p class="wl-s">Pay securely with Paystack by Mobile Money or card. Your balance updates the moment the payment is confirmed.</p>
      <div class="wl-in"><s>GH₵</s><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="100" aria-label="Amount in cedis" /></div>
      <div class="wl-chips">${[50, 100, 200, 500, 1000].map((n) => `<button type="button" data-wl="chip" data-n="${n}">${n.toLocaleString()}</button>`).join("")}</div>
      <div id="wlQ" class="wl-q"></div>
      <button class="wl-btn" style="width:100%;margin-top:12px" data-wl="pay" disabled>${icon("shield", 18)} Continue to Paystack</button>
      <p class="wl-fine">Powered by Paystack · BAID X never sees your card or PIN</p>`);
    quote();
  }
  function quote() {
    clearTimeout(qT); const btn = document.querySelector('#sheetRoot [data-wl="pay"]'), box = document.getElementById("wlQ"); if (btn) btn.disabled = true;
    const n = parseFloat(String(val("amount")).replace(/,/g, ""));
    document.querySelectorAll('#sheetRoot [data-wl="chip"]').forEach((b) => b.classList.toggle("on", Number(b.dataset.n) === n));
    if (!(n > 0)) { if (box) box.innerHTML = ""; return; }
    qT = setTimeout(async () => {
      try {
        const q = await rpc(window.APP.dashCtx(), "wallet_deposit_quote", { p_amount: n });
        if (!document.getElementById("wlQ")) return;
        box.innerHTML = [["Amount", money(q.amount)], ["Paystack fee", money(q.fee)], ["You pay", money(q.total)], ["Added to your wallet", `<span class="g">${money(q.amount)}</span>`]].map(([k, v]) => `<div class="wl-kv"><span>${k}</span><b>${v}</b></div>`).join("");
        if (btn) btn.disabled = false;
      } catch (e) { if (box) box.innerHTML = `<p class="wl-err">${esc(e.message || "Enter a valid amount.")}</p>`; }
    }, 250);
  }
  async function payNow(c, btn) {
    const n = parseFloat(String(val("amount")).replace(/,/g, "")); if (!(n > 0)) return;
    btn.disabled = true; btn.classList.add("busy");
    try {
      const ck = await rpc(c, "wallet_start_deposit", { p_amount: n });
      await window.BX_PAY.goPaystack(c, ck.reference);
    } catch (e) { c.toast(e.message || "Couldn't start the payment. Nothing was charged."); }
    btn.disabled = false; btn.classList.remove("busy");
  }

  /* ---- withdraw (password-authorised) ---- */
  async function withdrawSheet(c) {
    const { data: a } = await c.sb.from("wallet_accounts").select("available_ghs").eq("owner_id", c.uid).maybeSingle();
    const max = Number(a?.available_ghs || 0);
    F().openSheet("Withdraw", `<p class="wl-s">The money is sent to your Mobile Money after you authorize it. We process withdrawals within 24 hours. It is held safely until then.</p>
      ${F().fld("Amount (GH₵)", `<input class="in" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" />`, `Available: ${money(max)}`)}
      ${F().fld("Network", F().sel("network", [["MTN MoMo", "MTN MoMo"], ["Telecel Cash", "Telecel Cash"], ["AirtelTigo Money", "AirtelTigo Money"]], ""))}
      ${F().fld("Mobile Money number", `<input class="in" name="account" type="tel" inputmode="tel" autocomplete="off" placeholder="024 123 4567" />`)}
      ${F().fld("Name on the account", `<input class="in" name="name" maxlength="80" autocomplete="off" />`)}
      ${F().fld("Your password", `<input class="in" name="password" type="password" autocomplete="current-password" />`, "Confirms it's really you.")}
      <p class="wl-err" id="wlE"></p>
      <button class="wl-btn" style="width:100%" data-wl="authorize">${icon("shield", 18)} Authorize withdrawal</button>
      <p class="wl-fine">If the payout can't be made, the money returns to your wallet automatically.</p>`);
  }
  async function authorize(c, btn) {
    const err = document.getElementById("wlE"); err.textContent = "";
    const body = { amount: parseFloat(String(val("amount")).replace(/,/g, "")), network: val("network"), account: val("account"), name: val("name").trim(), password: val("password") };
    if (!(body.amount > 0)) { err.textContent = "Enter an amount."; return; }
    if (!body.password) { err.textContent = "Enter your password to authorize."; return; }
    btn.disabled = true; btn.classList.add("busy");
    try {
      const { data: { session } } = await c.sb.auth.getSession();
      const r = await fetch("/api/wallet-withdraw", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { err.textContent = j.error || "We couldn't request that withdrawal."; btn.disabled = false; btn.classList.remove("busy"); return; }
      F().closeSheet(); c.toast(`Withdrawal requested · ${j.reference}`); window.APP.route();
    } catch { err.textContent = "Couldn't reach the server. Nothing was requested."; btn.disabled = false; btn.classList.remove("busy"); }
  }
  async function trackSheet(c, id) {
    const { data: w } = await c.sb.from("withdrawal_requests").select("public_id,amount_ghs,status,admin_note,destination_network,destination_account,created_at,processed_at").eq("id", id).maybeSingle(); if (!w) return;
    const done = w.status === "completed", bad = ["rejected", "failed", "cancelled"].includes(w.status);
    const step = (t, st) => `<div class="wl-step ${st}"><i>${st === "done" ? icon("check", 14) : ""}</i>${t}</div>`;
    F().openSheet("Withdrawal", `<div class="wl-trk"><div><small>Amount</small><b>${money(w.amount_ghs)}</b></div><span class="pill ${TONE[w.status] || ""}">${esc(WD_LABEL[w.status] || pretty(w.status))}</span></div>
      <div class="wl-steps">${step("Requested", "done")}${step("Authorized", "done")}${step("Processing", done || bad ? "done" : "now")}${step(bad ? "Returned" : "Paid", done || bad ? "done" : "")}</div>
      <div class="wl-kv"><span>To</span><b>${esc(w.destination_network || "Mobile Money")} · ${esc(String(w.destination_account || "").replace(/.(?=.{3})/g, "•"))}</b></div><div class="wl-kv"><span>Reference</span><b>${esc(w.public_id)}</b></div><div class="wl-kv"><span>Requested</span><b>${esc(new Date(w.created_at).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</b></div>
      ${bad ? `<p class="wl-s" style="margin-top:12px">This withdrawal could not be paid${w.admin_note ? `: ${esc(w.admin_note)}` : ""}. The money is back in your wallet.</p>` : done ? "" : `<p class="wl-s" style="margin-top:12px">Expected within 24 hours. The money stays safely in BAID X until it is paid to your number.</p>`}`);
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-wl]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), a = el.dataset.wl;
    if (a === "deposit") return depositSheet();
    if (a === "chip") { const i = document.querySelector('#sheetRoot [name="amount"]'); if (i) { i.value = el.dataset.n; quote(); } return; }
    if (a === "pay") return payNow(c, el);
    if (a === "withdraw") return withdrawSheet(c);
    if (a === "authorize") return authorize(c, el);
    if (a === "wd") return trackSheet(c, el.dataset.id);
  });
  document.addEventListener("input", (e) => { if (e.target.matches('#sheetRoot [name="amount"]') && document.getElementById("wlQ")) quote(); });
  window.DASH.register("wallet", view);
})();
