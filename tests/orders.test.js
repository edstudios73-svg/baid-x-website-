const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(f, "utf8");
const sql = read("supabase/phase9_orders.sql");

test("orders SQL: money functions are locked down, locked rows, auto-settle scheduled", () => {
  assert.match(sql, /revoke all on function public\._order_restock\(orders\), public\.orders_auto_settle\(\) from public, anon, authenticated/);
  for (const fn of ["place_order", "order_accept", "order_cancel", "order_deliver", "order_receive", "order_dispute", "admin_resolve_order", "my_orders"]) assert.match(sql, new RegExp(`grant execute on function[^;]*public\\.${fn}\\(`), fn);
  assert.match(sql, /revoke insert, update, delete on public\.orders from anon, authenticated/);
  assert.match(sql, /idempotency_key\)[\s\S]*'order:'/);
  assert.match(sql, /for update/); assert.match(sql, /orders-auto-settle/);
  assert.match(sql, /only clients and companies can place orders/); assert.match(sql, /you cannot order your own item/);
  assert.match(sql, /not public\.is_active_admin\(\)/);
});

test("orders UI is wired, and catalog inserts use statuses the database accepts", () => {
  const html = read("index.html"), common = read("js/common.js"), market = read("js/market.js");
  assert.match(html, /js\/orders\.js/); assert.ok(html.indexOf("js/orders.js") > html.indexOf("js/market.js"));
  assert.match(common, /business: \[[^\]]*"orders", "order"/); assert.match(common, /company: \[[^\]]*"orders", "order"/); assert.match(common, /"individual-employer": \[[^\]]*"orders", "order"/);
  assert.match(market, /status: "in_stock"/); assert.match(market, /status: "available"/); assert.doesNotMatch(market, /status: "active", image_urls/);
  new Function(read("js/orders.js"));
});
