/* BAID X orders: buy products or rent/buy equipment from suppliers, paid from the buyer's wallet through escrow.
   Money never moves here: every action is a database function (place_order, order_*), which holds the payment in escrow and
   releases it (minus commission) to the supplier only when the buyer confirms, after 3 days, or by an admin decision. */
(() => {
  "use strict";
  const { esc, pretty, icon, ago } = window.BX;
  const U = () => window.DASH.ui, F = () => window.FEAT;
  const money = (n) => { const v = Number(n) || 0; return `GH₵${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const val = (n) => document.querySelector(`#sheetRoot [name="${n}"]`)?.value ?? "";
  const when = (iso) => new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const ST = { placed: ["Awaiting supplier", "warn"], accepted: ["Preparing", "warn"], delivered: ["Delivered", "warn"], completed: ["Completed", "ok"], declined: ["Declined", ""], cancelled: ["Cancelled", ""], disputed: ["In dispute", "bad"], refunded: ["Refunded", ""] };
  const pill = (s) => `<span class="pill ${ST[s]?.[1] || ""}">${esc(ST[s]?.[0] || pretty(s))}</span>`;
  const KIND = { product: "Product", equipment_sale: "Equipment purchase", equipment_rental: "Equipment rental" };
  const REASONS = ["The item was not delivered", "The item is not as described", "The item is damaged or faulty", "The buyer is not responding", "Something else"];
  const friendly = (e) => {
    const m = String(e?.message || ""), s = m.match(/insufficient_funds:([\d.]+)/);
    return s ? { short: Number(s[1]) } : m || "Something went wrong. Nothing was charged.";
  };

  /* ---- buttons placed on supplier catalog cards ---- */
  function buttons(i, isEq) {
    const d = (kind, price, label) => `<button class="btn-light sm" data-od="order" data-kind="${kind}" data-id="${esc(i.id)}" data-name="${esc(i.name)}" data-biz="${esc(i.business)}" data-price="${esc(price)}" data-stock="${esc(i.quantity ?? "")}">${label}</button>`;
    if (!isEq) return i.price > 0 && i.quantity !== 0 ? d("product", i.price, "Buy") : "";
    return (i.daily_rate > 0 ? d("equipment_rental", i.daily_rate, "Rent") : "") + (i.sale_price > 0 ? d("equipment_sale", i.sale_price, "Buy") : "");
  }

  /* ---- order sheet ---- */
  const od = { kind: "", id: "", name: "", biz: "", price: 0, stock: null, bal: 0 };
  async function orderSheet(c, el) {
    Object.assign(od, { kind: el.dataset.kind, id: el.dataset.id, name: el.dataset.name, biz: el.dataset.biz, price: Number(el.dataset.price), stock: el.dataset.stock === "" ? null : Number(el.dataset.stock) });
    const rent = od.kind === "equipment_rental", p = c.profile || {};
    od.bal = Number((await c.sb.from("wallet_accounts").select("available_ghs").eq("owner_id", c.uid).maybeSingle()).data?.available_ghs || 0);
    F().openSheet(rent ? "Rent equipment" : "Place order", `<p class="es-s"><b>${esc(od.name)}</b> from ${esc(od.biz)} · ${money(od.price)}${rent ? "/day" : od.kind === "product" ? " each" : ""}. Your payment is held in escrow and only released to the supplier when you confirm you received it.</p>
      <div class="two-col">${rent ? F().fld("Days", F().inp("days", { type: "number", min: 1, step: 1, val: 1 })) : ""}${od.kind === "equipment_sale" ? "" : F().fld(rent ? "Units" : "Quantity", F().inp("qty", { type: "number", min: 1, step: 1, val: 1 }))}</div>
      ${F().fld("Delivery address", F().inp("address", { max: 300, val: [p.physical_address, p.city_town, p.region].filter(Boolean).join(", "), ph: "Where should it be delivered?" }))}
      ${F().fld("Note to supplier (optional)", F().area("note", { rows: 2, max: 500, ph: "Delivery time, access, anything they should know." }))}
      <div id="odQ" class="es-q"></div><p class="wl-err" id="odE"></p>
      <button class="es-btn" data-od="confirm" disabled>${icon("shield", 18)} Pay and place order</button>
      <p class="es-fine">Your wallet balance: ${money(od.bal)}. The supplier has 3 days to accept, or you are refunded automatically.</p>`);
    orderQuote();
  }
  const qtyOf = () => (od.kind === "equipment_sale" ? 1 : parseInt(val("qty"), 10));
  function orderQuote() {
    const box = document.getElementById("odQ"), btn = document.querySelector('#sheetRoot [data-od="confirm"]'); if (!box) return;
    const rent = od.kind === "equipment_rental", q = qtyOf(), days = rent ? parseInt(val("days"), 10) : 1;
    const ok = q >= 1 && days >= 1 && (od.stock == null || q <= od.stock);
    if (!ok) { box.innerHTML = od.stock != null && q > od.stock ? `<p class="wl-err">Only ${od.stock} in stock.</p>` : ""; if (btn) btn.disabled = true; return; }
    const total = Math.round(od.price * q * days * 100) / 100, short = Math.max(0, Math.round((total - od.bal) * 100) / 100);
    box.innerHTML = [["Price", `${money(od.price)}${rent ? "/day" : ""}`], [rent ? "Units × days" : "Quantity", rent ? `${q} × ${days}` : String(q)], ["Held in escrow", `<b>${money(total)}</b>`], ["Your balance after", money(Math.max(0, od.bal - total))]].map(([k, v]) => `<div class="wl-kv"><span>${k}</span><b>${v}</b></div>`).join("")
      + (short ? `<div class="es-short">${icon("wallet", 16)}<span>You need ${money(short)} more in your wallet.</span><button data-od="topup">Add money</button></div>` : "");
    if (btn) btn.disabled = !!short || !val("address").trim();
  }
  async function confirmOrder(c, btn) {
    const err = document.getElementById("odE"); err.textContent = "";
    if (!val("address").trim()) { err.textContent = "Add a delivery address."; return; }
    btn.disabled = true; btn.classList.add("busy");
    try {
      const r = await rpc(c, "place_order", { p_kind: od.kind, p_item: od.id, p_qty: qtyOf(), p_days: od.kind === "equipment_rental" ? parseInt(val("days"), 10) : null, p_address: val("address"), p_note: val("note") || null });
      F().closeSheet(); c.toast(`Order placed. ${money(r.amount)} is held in escrow.`); c.go(`order/${r.order_id}`);
    } catch (e) { const m = friendly(e); err.textContent = m.short ? `You need ${money(m.short)} more in your wallet.` : m; btn.disabled = false; btn.classList.remove("busy"); }
  }

  /* ---- list ---- */
  async function ordersView(c) {
    const { head, empty, sec } = U(), list = await rpc(c, "my_orders").catch(() => []), sup = c.role === "business";
    const mine = list.filter((o) => (sup ? o.role === "supplier" : o.role === "buyer"));
    const need = (o) => (sup ? ["placed", "accepted"].includes(o.status) : o.status === "delivered");
    const card = (o) => `<button class="row es-row" data-go="order/${esc(o.id)}"><span class="ic">${icon(o.kind === "product" ? "box" : "equip", 17)}</span><span class="tx"><b>${esc(o.item_name)}${o.quantity > 1 ? ` × ${o.quantity}` : ""}</b><small>${esc(o.counterpart || "")} · ${money(o.amount_ghs)} · ${esc(ago(o.created_at))}</small></span>${pill(o.status)}</button>`;
    const act = mine.filter(need), rest = mine.filter((o) => !need(o));
    return head(sup ? "Orders" : "My orders") + (mine.length ? (act.length ? sec(sup ? "Needs your action" : "Waiting for you to confirm") + act.map(card).join("") : "") + (rest.length ? sec(act.length ? "All orders" : "Orders") + rest.map(card).join("") : "")
      : empty("box", "No orders yet", sup ? "When a buyer orders from your catalog, it shows here with the payment already held in escrow." : "Buy materials or rent equipment from verified suppliers. Your payment stays safe in escrow until you confirm delivery.", sup ? "" : `<button class="btn-light sm" data-go="materials">Browse materials</button>`));
  }

  /* ---- detail ---- */
  async function orderView(c, id) {
    const { head, empty } = U(), list = await rpc(c, "my_orders").catch(() => []), o = list.find((x) => x.id === id);
    if (!o) return head("Order") + empty("box", "Not found", "This order doesn't exist or isn't yours.", `<button class="btn-light sm" data-go="orders">Back</button>`);
    const sup = o.role === "supplier", dis = o.status === "disputed", done = o.status === "completed", gone = ["declined", "cancelled", "refunded"].includes(o.status);
    const step = (t, st, sub) => `<li class="${st}"><i>${st === "done" ? icon("check", 13) : ""}</i><div><b>${t}</b>${sub ? `<small>${sub}</small>` : ""}</div></li>`;
    const acc = !!o.accepted_at, del = !!o.delivered_at;
    const steps = gone ? "" : `<ol class="es-steps">${step("Order placed · payment held in escrow", "done", when(o.created_at))}${step(sup ? "You accept the order" : "Supplier accepts", acc ? "done" : o.status === "placed" ? "now" : "", o.status === "placed" && o.placed_expires_at ? `Refunded automatically if no reply by ${when(o.placed_expires_at)}` : o.accepted_at ? when(o.accepted_at) : "")}${step(sup ? "You deliver" : "Supplier delivers", del ? "done" : o.status === "accepted" ? "now" : "", o.delivered_at ? when(o.delivered_at) : "")}${step(sup ? "Buyer confirms, you are paid" : "You confirm receipt", done ? "done" : o.status === "delivered" ? "now" : "", o.status === "delivered" && o.auto_release_at ? `Releases automatically ${when(o.auto_release_at)}` : done && o.completed_at ? when(o.completed_at) : "")}</ol>`;
    let acts = "";
    if (sup && o.status === "placed") acts = `<button class="es-btn" data-od="accept" data-id="${esc(o.id)}">${icon("check", 18)} Accept order</button><button class="es-btn ghost" data-od="cancel" data-id="${esc(o.id)}">Decline and refund</button>`;
    else if (sup && o.status === "accepted") acts = `<button class="es-btn" data-od="deliver" data-id="${esc(o.id)}">${icon("check", 18)} Mark as delivered</button><div class="es-2"><button class="es-btn ghost" data-od="dispute" data-id="${esc(o.id)}">Report a problem</button><button class="es-btn ghost" data-od="cancel" data-id="${esc(o.id)}">Cancel order</button></div>`;
    else if (!sup && o.status === "placed") acts = `<button class="es-btn ghost" data-od="cancel" data-id="${esc(o.id)}">Cancel and refund</button>`;
    else if (!sup && ["accepted", "delivered"].includes(o.status)) acts = `<button class="es-btn" data-od="receive" data-id="${esc(o.id)}">${icon("check", 18)} I received it, release payment</button><button class="es-btn ghost" data-od="dispute" data-id="${esc(o.id)}">Report a problem</button>`;
    else if (sup && o.status === "delivered") acts = `<button class="es-btn ghost" data-od="dispute" data-id="${esc(o.id)}">Report a problem</button>`;
    const fee = o.commission_ghs != null ? Number(o.commission_ghs) : null, net = o.net_ghs != null ? Number(o.net_ghs) : null;
    const brk = done && net != null ? `<div class="es-break"><div class="wl-kv"><span>Order total</span><b>${money(o.amount_ghs)}</b></div>${sup ? `<div class="wl-kv"><span>BAID X fee</span><b>− ${money(fee)}</b></div><div class="wl-kv"><span>You received</span><b class="g">${money(net)}</b></div>` : `<div class="wl-kv"><span>Paid to supplier</span><b>${money(o.amount_ghs)}</b></div>`}</div>` : "";
    return head(o.item_name, `<button class="btn-dark sm" data-go="orders">Orders</button>`)
      + `<div class="es-card"><div class="es-top"><small>${esc(KIND[o.kind] || "Order")} · ${sup ? "Buyer" : "Supplier"}</small>${pill(o.status)}</div><div class="es-who">${esc(o.counterpart || "—")}</div>
        <div class="es-amt"><small>${sup ? "Secured for you" : "Held in escrow"}</small><b>${money(o.amount_ghs)}</b><span>${money(o.unit_price)}${o.kind === "equipment_rental" ? "/day" : ""} × ${o.quantity}${o.days ? ` × ${o.days} day${o.days > 1 ? "s" : ""}` : ""}</span></div></div>
        ${steps}${brk}
        <div class="es-quote"><small>Deliver to</small><p>${esc(o.delivery_address || "—")}</p>${o.note ? `<small style="display:block;margin-top:8px">Note</small><p>${esc(o.note)}</p>` : ""}</div>
        ${o.delivery_note ? `<div class="es-quote"><small>Delivery note</small><p>${esc(o.delivery_note)}</p></div>` : ""}
        ${dis ? `<div class="es-warn">${icon("shield", 18)}<div><b>This is in dispute.</b> The money stays safe in escrow while BAID X reviews it. ${esc(o.dispute_reason || "")}</div></div>` : ""}
        ${o.resolution_note ? `<div class="es-quote"><small>BAID X decision</small><p>${esc(o.resolution_note)}</p></div>` : ""}
        ${gone ? `<div class="es-quote"><small>${esc(ST[o.status][0])}</small><p>${sup ? "This order did not go ahead. The buyer was refunded." : "This order did not go ahead. Your payment was refunded to your wallet."}</p></div>` : ""}
        ${acts ? `<div class="es-acts">${acts}</div>` : ""}
        <div class="es-trust">${icon("shield", 18)}<div>${sup ? "The buyer's payment is already held by BAID X. It is released to you when they confirm receipt, or 3 days after you mark it delivered." : "Your money is held by BAID X. The supplier only gets it when you confirm receipt, or 3 days after delivery if you do nothing."}</div></div><p class="es-fine">Ref ${esc(o.public_id)}</p>`;
  }

  const sheet = (title, text, action, id, label) => F().openSheet(title, `<p class="es-s">${text}</p><button class="es-btn" data-od="${action}" data-id="${esc(id)}">${label}</button><button class="es-btn ghost" data-close style="margin-top:8px">Not now</button>`);
  const run = async (c, btn, fn, ok) => {
    btn.disabled = true; btn.classList.add("busy");
    try { await fn(); F().closeSheet(); if (ok) c.toast(ok); window.APP.route(); } catch (e) { const m = friendly(e); c.toast(m.short ? "Not enough money in your wallet." : m); btn.disabled = false; btn.classList.remove("busy"); }
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-od]"); if (!el || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), a = el.dataset.od, id = el.dataset.id;
    e.preventDefault(); e.stopPropagation();
    if (a === "order") return orderSheet(c, el).catch((x) => F().fail(c, x));
    if (a === "confirm") return confirmOrder(c, el);
    if (a === "topup") { F().closeSheet(); return c.go("wallet"); }
    if (a === "accept") return run(c, el, () => rpc(c, "order_accept", { p_id: id }), "Order accepted.");
    if (a === "cancel") return sheet("Cancel this order?", "The payment held in escrow goes back to the buyer's wallet and the stock is restored.", "confirm-cancel", id, "Yes, cancel and refund");
    if (a === "confirm-cancel") return run(c, el, () => rpc(c, "order_cancel", { p_id: id }), "Cancelled. The payment was refunded.");
    if (a === "deliver") return F().openSheet("Mark as delivered", `<p class="es-s">The buyer then has 3 days to confirm. If they don't, your payment is released automatically.</p>${F().fld("Delivery note (optional)", F().area("note", { rows: 3, max: 500, ph: "Who received it, where it was left." }))}<button class="es-btn" data-od="confirm-deliver" data-id="${esc(id)}">${icon("check", 18)} Mark as delivered</button>`);
    if (a === "confirm-deliver") return run(c, el, () => rpc(c, "order_deliver", { p_id: id, p_note: val("note") || null }), "Marked as delivered.");
    if (a === "receive") return sheet("Release payment", "This pays the supplier. You can't undo it, so only confirm if you have received the order and are happy with it.", "confirm-receive", id, "Yes, release payment");
    if (a === "confirm-receive") return run(c, el, () => rpc(c, "order_receive", { p_id: id }), "Payment released.");
    if (a === "dispute") return F().openSheet("Report a problem", `<p class="es-s">The money stays frozen in escrow while BAID X reviews. Be specific so we can decide quickly.</p>${F().fld("What is the problem?", F().sel("reason", REASONS.map((r) => [r, r]), REASONS[0]))}${F().fld("Details", F().area("details", { rows: 4, max: 2000 }))}<button class="es-btn" data-od="confirm-dispute" data-id="${esc(id)}">Open dispute</button>`);
    if (a === "confirm-dispute") return run(c, el, () => rpc(c, "order_dispute", { p_id: id, p_reason: val("reason"), p_details: val("details") || null }), "Dispute opened. BAID X will review.");
  }, true);
  document.addEventListener("input", (e) => { if (e.target.matches('#sheetRoot [name="qty"], #sheetRoot [name="days"], #sheetRoot [name="address"]') && document.getElementById("odQ")) orderQuote(); });

  window.ORDERS = { buttons };
  window.DASH.register("orders", ordersView);
  window.DASH.register("order", orderView);
})();
