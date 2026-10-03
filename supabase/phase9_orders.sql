-- BAID X · Phase 9: product & equipment orders paid through escrow. Applied to project igfmmprlrybxsdzehwid.
-- Buyer wallet -> escrow (locked) -> supplier wallet (minus commission) once the buyer confirms receipt (or 3 days after delivery).
-- Reuses _escrow_release / _escrow_refund / _escrow_split from phase8. All writes are RPCs.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  buyer_id uuid not null, buyer_role text not null check (buyer_role in ('company','individual_employer')),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  kind text not null check (kind in ('product','equipment_sale','equipment_rental')),
  item_id uuid not null, item_name text not null,
  unit_price numeric not null check (unit_price > 0), quantity int not null default 1 check (quantity between 1 and 10000), days int check (days is null or days between 1 and 365),
  amount_ghs numeric not null check (amount_ghs > 0),
  delivery_address text, note text,
  status text not null default 'placed' check (status in ('placed','accepted','delivered','completed','declined','cancelled','disputed','refunded')),
  escrow_id uuid references public.escrow_holds(id) on delete set null,
  placed_expires_at timestamptz, accepted_at timestamptz, delivered_at timestamptz, delivery_note text, auto_release_at timestamptz, completed_at timestamptz,
  dispute_reason text, dispute_details text, disputed_at timestamptz, resolution_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_business_idx on public.orders (business_id, created_at desc);
create index if not exists orders_due_idx on public.orders (status, placed_expires_at, auto_release_at);
alter table public.orders enable row level security;
create policy orders_party_select on public.orders for select to authenticated using (auth.uid() = buyer_id or auth.uid() = business_id or public.is_active_admin());
revoke insert, update, delete on public.orders from anon, authenticated;

create or replace function public._order_restock(o orders) returns void language plpgsql security definer set search_path = public as $$
begin
  if o.kind = 'product' then update business_products set quantity = quantity + o.quantity, updated_at = now() where id = o.item_id and quantity is not null; end if;
end $$;

create or replace function public.place_order(p_kind text, p_item uuid, p_qty int default 1, p_days int default null, p_address text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); brole text; biz uuid; nm text; price numeric; stock int; amt numeric; bal numeric; oid uuid := gen_random_uuid(); esc uuid; tx uuid; ok boolean; accepting boolean;
begin
  if me is null then raise exception 'sign in first'; end if;
  select replace(role, '-', '_') into brole from account_roles where user_id = me and role in ('company','individual-employer') and account_status = 'active' limit 1;
  if brole is null then raise exception 'only clients and companies can place orders'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10000 then raise exception 'choose a quantity'; end if;
  if coalesce(trim(p_address), '') = '' then raise exception 'add a delivery address'; end if;
  if p_kind = 'product' then
    select business_id, name, business_products.price, quantity, available into biz, nm, price, stock, ok from business_products where id = p_item for update;
  elsif p_kind in ('equipment_sale','equipment_rental') then
    select business_id, name, case when p_kind = 'equipment_sale' then sale_price else daily_rate end, null::int, available into biz, nm, price, stock, ok from business_equipment where id = p_item;
    if p_kind = 'equipment_rental' and (p_days is null or p_days < 1 or p_days > 365) then raise exception 'choose how many days'; end if;
  else raise exception 'unknown order type'; end if;
  if biz is null or not coalesce(ok, false) then raise exception 'this item is no longer available'; end if;
  if biz = me then raise exception 'you cannot order your own item'; end if;
  select coalesce(accepting_orders, true) into accepting from business_profiles where id = biz;
  if not accepting then raise exception 'this supplier is not accepting orders right now'; end if;
  if price is null or price <= 0 then raise exception 'this item has no price for that option'; end if;
  if stock is not null and stock < p_qty then raise exception 'only % in stock', stock; end if;
  amt := round(price * p_qty * case when p_kind = 'equipment_rental' then p_days else 1 end, 2);
  select available_ghs into bal from wallet_accounts where owner_role = brole and owner_id = me for update;
  if coalesce(bal, 0) < amt then raise exception 'insufficient_funds:%', round(amt - coalesce(bal, 0), 2); end if;
  update wallet_accounts set available_ghs = available_ghs - amt, lifetime_spent_ghs = lifetime_spent_ghs + amt, updated_at = now() where owner_role = brole and owner_id = me;
  if p_kind = 'product' and stock is not null then update business_products set quantity = quantity - p_qty, updated_at = now() where id = p_item; end if;
  insert into escrow_holds(public_id, payer_role, payer_id, receiver_role, receiver_id, context_type, context_id, amount_ghs, status, description, idempotency_key)
    values ('BXD-ESC-' || upper(substr(md5(random()::text || oid::text), 1, 8)), brole, me, 'business', biz, 'listing', oid, amt, 'locked', 'Order: ' || nm, 'order:' || oid::text) returning id into esc;
  insert into wallet_transactions(public_id, owner_role, owner_id, counterparty_role, counterparty_id, type, amount_ghs, net_ghs, status, description, escrow_id, idempotency_key)
    values ('BXD-TX-' || upper(substr(md5(random()::text || esc::text), 1, 8)), brole, me, 'business', biz, 'escrow_lock', amt, amt, 'completed', 'Held in escrow for ' || nm, esc, 'escrow-lock:' || esc::text) returning id into tx;
  update escrow_holds set lock_tx_id = tx where id = esc;
  insert into orders(id, public_id, buyer_id, buyer_role, business_id, kind, item_id, item_name, unit_price, quantity, days, amount_ghs, delivery_address, note, status, escrow_id, placed_expires_at)
    values (oid, 'BXD-ORD-' || upper(substr(md5(random()::text || oid::text), 1, 8)), me, brole, biz, p_kind, p_item, nm, price, p_qty, case when p_kind = 'equipment_rental' then p_days end, amt,
      left(trim(p_address), 300), left(nullif(trim(p_note), ''), 500), 'placed', esc, now() + interval '3 days');
  perform notify_user(biz, 'order_placed', 'New order', 'New order for ' || nm || ' (GHS ' || amt || '). The payment is held safely in escrow. Accept it to start.', '#/order/' || oid, '{}'::jsonb);
  return jsonb_build_object('order_id', oid, 'amount', amt);
end $$;

create or replace function public.order_accept(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_id for update;
  if not found or o.business_id is distinct from auth.uid() then raise exception 'not your order'; end if;
  if o.status <> 'placed' then raise exception 'this order is %', o.status; end if;
  update orders set status = 'accepted', accepted_at = now(), placed_expires_at = null, updated_at = now() where id = p_id;
  perform notify_user(o.buyer_id, 'order_accepted', 'Order accepted', 'The supplier accepted your order for ' || o.item_name || '.', '#/order/' || p_id, '{}'::jsonb);
  return jsonb_build_object('status', 'accepted');
end $$;

-- Supplier declines, or buyer cancels before it is accepted: full refund and restock.
create or replace function public.order_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; me uuid := auth.uid(); r jsonb; by_supplier boolean;
begin
  select * into o from orders where id = p_id for update;
  if not found or me not in (o.buyer_id, o.business_id) then raise exception 'not your order'; end if;
  by_supplier := me = o.business_id;
  if o.status <> 'placed' and not (by_supplier and o.status = 'accepted') then raise exception 'this order can no longer be cancelled'; end if;
  r := public._escrow_refund(o.escrow_id); perform public._order_restock(o);
  update orders set status = case when by_supplier then 'declined' else 'cancelled' end, placed_expires_at = null, updated_at = now() where id = p_id;
  perform notify_user(case when by_supplier then o.buyer_id else o.business_id end, 'order_cancelled', 'Order ' || case when by_supplier then 'declined' else 'cancelled' end, o.item_name || ': the payment was refunded to the buyer.', '#/order/' || p_id, '{}'::jsonb);
  return r;
end $$;

create or replace function public.order_deliver(p_id uuid, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_id for update;
  if not found or o.business_id is distinct from auth.uid() then raise exception 'not your order'; end if;
  if o.status <> 'accepted' then raise exception 'this order is %', o.status; end if;
  update orders set status = 'delivered', delivered_at = now(), delivery_note = left(nullif(trim(p_note), ''), 500), auto_release_at = now() + interval '3 days', updated_at = now() where id = p_id;
  perform notify_user(o.buyer_id, 'order_delivered', 'Order delivered', o.item_name || ' was marked as delivered. Confirm you received it within 3 days, or payment releases automatically.', '#/order/' || p_id, '{}'::jsonb);
  return jsonb_build_object('status', 'delivered');
end $$;

create or replace function public.order_receive(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; r jsonb;
begin
  select * into o from orders where id = p_id for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'not your order'; end if;
  if o.status not in ('accepted','delivered') then raise exception 'this order is %', o.status; end if;
  r := public._escrow_release(o.escrow_id);
  update orders set status = 'completed', completed_at = now(), auto_release_at = null, updated_at = now() where id = p_id;
  perform notify_user(o.business_id, 'payment_released', 'Payment released', 'GHS ' || (r->>'net') || ' for ' || o.item_name || ' is now in your wallet.', '#/wallet', r);
  return r;
end $$;

create or replace function public.order_dispute(p_id uuid, p_reason text, p_details text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; me uuid := auth.uid();
begin
  select * into o from orders where id = p_id for update;
  if not found or me not in (o.buyer_id, o.business_id) then raise exception 'not your order'; end if;
  if o.status not in ('accepted','delivered') then raise exception 'this order is %', o.status; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'tell us the reason'; end if;
  update orders set status = 'disputed', disputed_at = now(), auto_release_at = null, dispute_reason = left(trim(p_reason), 200), dispute_details = left(nullif(trim(p_details), ''), 2000), updated_at = now() where id = p_id;
  update escrow_holds set status = 'disputed', updated_at = now() where id = o.escrow_id and status = 'locked';
  perform notify_user(case when me = o.buyer_id then o.business_id else o.buyer_id end, 'dispute_opened', 'Dispute opened', 'A dispute was opened on an order. Funds stay safe in escrow while BAID X reviews.', '#/order/' || p_id, '{}'::jsonb);
  return jsonb_build_object('status', 'disputed');
end $$;

create or replace function public.admin_resolve_order(p_id uuid, p_release_ghs numeric, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; r jsonb;
begin
  if not public.is_active_admin() then raise exception 'admin only'; end if;
  select * into o from orders where id = p_id for update;
  if not found or o.status <> 'disputed' then raise exception 'not in dispute'; end if;
  if p_release_ghs < 0 or p_release_ghs > o.amount_ghs then raise exception 'release amount out of range'; end if;
  r := public._escrow_split(o.escrow_id, round(p_release_ghs, 2));
  if p_release_ghs <= 0 then perform public._order_restock(o); end if;
  update orders set status = case when p_release_ghs <= 0 then 'refunded' else 'completed' end, completed_at = now(), resolution_note = left(nullif(trim(p_note), ''), 1000), updated_at = now() where id = p_id;
  perform public._audit('resolve_order', 'order', p_id::text, null, r, jsonb_build_object('release', p_release_ghs));
  perform notify_user(o.buyer_id, 'dispute_resolved', 'Dispute resolved', 'BAID X settled the dispute. Check your wallet.', '#/wallet', '{}'::jsonb);
  perform notify_user(o.business_id, 'dispute_resolved', 'Dispute resolved', 'BAID X settled the dispute. Check your wallet.', '#/wallet', '{}'::jsonb);
  return r;
end $$;

-- Cron: unanswered orders refund after 3 days; delivered orders nobody confirmed release after 3 days.
create or replace function public.orders_auto_settle() returns int language plpgsql security definer set search_path = public as $$
declare o orders; n int := 0; r jsonb;
begin
  for o in select * from orders where status = 'placed' and placed_expires_at <= now() order by placed_expires_at limit 100 for update skip locked loop
    perform public._escrow_refund(o.escrow_id); perform public._order_restock(o);
    update orders set status = 'cancelled', placed_expires_at = null, updated_at = now() where id = o.id;
    perform notify_user(o.buyer_id, 'order_cancelled', 'Order expired', 'The supplier did not respond in 3 days, so ' || o.item_name || ' was cancelled and refunded.', '#/order/' || o.id, '{}'::jsonb);
    n := n + 1;
  end loop;
  for o in select * from orders where status = 'delivered' and auto_release_at <= now() order by auto_release_at limit 100 for update skip locked loop
    r := public._escrow_release(o.escrow_id);
    update orders set status = 'completed', completed_at = now(), auto_release_at = null, updated_at = now() where id = o.id;
    perform notify_user(o.business_id, 'payment_released', 'Payment released', 'GHS ' || (r->>'net') || ' for ' || o.item_name || ' was released automatically.', '#/wallet', r);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.my_orders() returns table(id uuid, public_id text, role text, counterpart text, kind text, item_name text, unit_price numeric, quantity int, days int, amount_ghs numeric, delivery_address text, note text, status text, placed_expires_at timestamptz, accepted_at timestamptz, delivered_at timestamptz, delivery_note text, auto_release_at timestamptz, completed_at timestamptz, dispute_reason text, resolution_note text, created_at timestamptz, net_ghs numeric, commission_ghs numeric)
language sql stable security definer set search_path = public as $$
  select o.id, o.public_id, case when o.business_id = auth.uid() then 'supplier' else 'buyer' end,
    case when o.business_id = auth.uid() then coalesce(c.company_name, ie.full_name, 'Customer') else b.business_name end,
    o.kind, o.item_name, o.unit_price, o.quantity, o.days, o.amount_ghs, o.delivery_address, o.note, o.status, o.placed_expires_at, o.accepted_at, o.delivered_at, o.delivery_note, o.auto_release_at, o.completed_at, o.dispute_reason, o.resolution_note, o.created_at, h.net_ghs, h.commission_ghs
  from orders o join business_profiles b on b.id = o.business_id
  left join company_profiles c on c.id = o.buyer_id left join individual_employer_profiles ie on ie.id = o.buyer_id left join escrow_holds h on h.id = o.escrow_id
  where o.buyer_id = auth.uid() or o.business_id = auth.uid() or public.is_active_admin()
  order by o.created_at desc limit 100
$$;

revoke all on function public._order_restock(orders), public.orders_auto_settle() from public, anon, authenticated;
revoke all on function public.place_order(text, uuid, int, int, text, text), public.order_accept(uuid), public.order_cancel(uuid), public.order_deliver(uuid, text), public.order_receive(uuid), public.order_dispute(uuid, text, text), public.admin_resolve_order(uuid, numeric, text), public.my_orders() from public, anon;
grant execute on function public.place_order(text, uuid, int, int, text, text), public.order_accept(uuid), public.order_cancel(uuid), public.order_deliver(uuid, text), public.order_receive(uuid), public.order_dispute(uuid, text, text), public.admin_resolve_order(uuid, numeric, text), public.my_orders() to authenticated;
select cron.schedule('orders-auto-settle', '*/15 * * * *', $$select public.orders_auto_settle()$$);
