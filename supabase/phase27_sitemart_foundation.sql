-- Phase 27: SiteMart foundation (Phase 1 of docs/sitemart/ARCHITECTURE.md).
-- SiteMart is BAID X's construction marketplace. Same Supabase project, same accounts, same wallet and
-- escrow. This file adds, without touching any existing row:
--   sm_countries     markets (Ghana live; Nigeria, Togo, Benin, Côte d'Ivoire, Senegal set up but off)
--   sm_categories    the fixed material and equipment categories with their units
--   listing details  extra columns on business_products / business_equipment (unit, minimum order,
--                    bulk prices, delivery, specs; maker, model, year, hours, hour/week rates, deposit, operator)
--   sm_accounts      the SiteMart account type a member chose (buyer, contractor, equipment owner ...)
--   sm_verification  documents a member sends for review (private bucket sm-verification); only BAID X staff decide
--   sm_saved         saved listings and followed suppliers
--   reads            sitemart_home, sitemart_search, sitemart_listing, sitemart_supplier (public)
--   writes           sm_register, sm_me, sm_listing_details, sm_toggle_saved, sm_submit_verification,
--                    admin_sm_review_verification (all security definer, all checked)
-- Trust: a member's trust level is computed from BAID X verification, never set by the member and never
-- raised by a paid plan. Non-destructive: new tables, new nullable columns, new functions.

-- ---------- markets ----------
create table if not exists public.sm_countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text not null, currency text not null check (currency ~ '^[A-Z]{3}$'), dial_code text not null,
  active boolean not null default false, sort int not null default 100);
alter table public.sm_countries enable row level security;
drop policy if exists sm_countries_read on public.sm_countries;
create policy sm_countries_read on public.sm_countries for select to anon, authenticated using (true);
revoke insert, update, delete on public.sm_countries from anon, authenticated;
insert into public.sm_countries(code, name, currency, dial_code, active, sort) values
  ('GH', 'Ghana', 'GHS', '+233', true, 1), ('NG', 'Nigeria', 'NGN', '+234', false, 2), ('TG', 'Togo', 'XOF', '+228', false, 3),
  ('BJ', 'Benin', 'XOF', '+229', false, 4), ('CI', 'Côte d''Ivoire', 'XOF', '+225', false, 5), ('SN', 'Senegal', 'XOF', '+221', false, 6)
on conflict (code) do nothing;

-- ---------- categories ----------
create table if not exists public.sm_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  kind text not null check (kind in ('material', 'equipment')),
  name text not null, units text[] not null default '{}', sort int not null default 100);
alter table public.sm_categories enable row level security;
drop policy if exists sm_categories_read on public.sm_categories;
create policy sm_categories_read on public.sm_categories for select to anon, authenticated using (true);
revoke insert, update, delete on public.sm_categories from anon, authenticated;
insert into public.sm_categories(slug, kind, name, units, sort) values
  ('cement', 'material', 'Cement', '{bag,tonne,truckload}', 1),
  ('quarry-dust', 'material', 'Quarry dust', '{tonne,cubic_metre,trip,truckload}', 2),
  ('aggregates', 'material', 'Chippings and aggregates', '{tonne,cubic_metre,trip,truckload}', 3),
  ('sand', 'material', 'Sand', '{tonne,cubic_metre,trip,truckload}', 4),
  ('blocks', 'material', 'Blocks', '{piece,truckload}', 5),
  ('bricks', 'material', 'Bricks', '{piece,truckload}', 6),
  ('iron-rods', 'material', 'Iron rods', '{piece,bundle,tonne}', 7),
  ('steel', 'material', 'Steel', '{piece,tonne}', 8),
  ('roofing', 'material', 'Roofing sheets', '{piece,bundle,square_metre}', 9),
  ('tiles', 'material', 'Tiles', '{piece,box,square_metre}', 10),
  ('paint', 'material', 'Paint', '{litre,bucket,piece}', 11),
  ('electrical', 'material', 'Electrical materials', '{piece,roll,box,metre}', 12),
  ('plumbing', 'material', 'Plumbing materials', '{piece,length,box,metre}', 13),
  ('timber', 'material', 'Timber', '{piece,bundle,cubic_metre}', 14),
  ('glass', 'material', 'Glass', '{piece,square_metre}', 15),
  ('doors-windows', 'material', 'Doors and windows', '{piece,set}', 16),
  ('concrete-products', 'material', 'Concrete products', '{piece,cubic_metre}', 17),
  ('insulation', 'material', 'Insulation materials', '{roll,piece,square_metre}', 18),
  ('other-supplies', 'material', 'Other construction supplies', '{piece,bag,box,set}', 19),
  ('excavators', 'equipment', 'Excavators', '{}', 101), ('bulldozers', 'equipment', 'Bulldozers', '{}', 102),
  ('wheel-loaders', 'equipment', 'Wheel loaders', '{}', 103), ('cranes', 'equipment', 'Cranes', '{}', 104),
  ('forklifts', 'equipment', 'Forklifts', '{}', 105), ('graders', 'equipment', 'Graders', '{}', 106),
  ('rollers', 'equipment', 'Rollers', '{}', 107), ('dump-trucks', 'equipment', 'Dump trucks', '{}', 108),
  ('concrete-mixers', 'equipment', 'Concrete mixers', '{}', 109), ('concrete-pumps', 'equipment', 'Concrete pumps', '{}', 110),
  ('drilling', 'equipment', 'Drilling machines', '{}', 111), ('generators', 'equipment', 'Generators', '{}', 112),
  ('compactors', 'equipment', 'Compactors', '{}', 113), ('tractors', 'equipment', 'Tractors', '{}', 114),
  ('industrial', 'equipment', 'Industrial equipment', '{}', 115)
on conflict (slug) do nothing;

-- The units SiteMart understands, with how they read in the interface.
create or replace function public._sm_unit_ok(u text) returns boolean language sql immutable as $$
  select u is null or u in ('bag','tonne','cubic_metre','trip','piece','truckload','bundle','square_metre','box','litre','bucket','roll','metre','length','set')
$$;

-- ---------- listing details (nullable; existing listings keep working) ----------
alter table public.business_products add column if not exists sm_category text references public.sm_categories(slug);
alter table public.business_products add column if not exists unit text;
alter table public.business_products add column if not exists min_order_qty numeric;
alter table public.business_products add column if not exists bulk_tiers jsonb;
alter table public.business_products add column if not exists delivery_options text[];
alter table public.business_products add column if not exists delivery_days_min int;
alter table public.business_products add column if not exists delivery_days_max int;
alter table public.business_products add column if not exists specs jsonb;
alter table public.business_products add column if not exists country text references public.sm_countries(code);
alter table public.business_equipment add column if not exists sm_category text references public.sm_categories(slug);
alter table public.business_equipment add column if not exists manufacturer text;
alter table public.business_equipment add column if not exists model text;
alter table public.business_equipment add column if not exists year_made int;
alter table public.business_equipment add column if not exists hour_meter int;
alter table public.business_equipment add column if not exists hourly_rate numeric;
alter table public.business_equipment add column if not exists weekly_rate numeric;
alter table public.business_equipment add column if not exists deposit_ghs numeric;
alter table public.business_equipment add column if not exists operator text;
alter table public.business_equipment add column if not exists delivery_options text[];
alter table public.business_equipment add column if not exists specs jsonb;
alter table public.business_equipment add column if not exists country text references public.sm_countries(code);
create index if not exists business_products_sm_category_idx on public.business_products (sm_category) where available;
create index if not exists business_equipment_sm_category_idx on public.business_equipment (sm_category) where available;

do $$ begin
  alter table public.business_products add constraint business_products_sm_checks check (
    public._sm_unit_ok(unit) and (min_order_qty is null or min_order_qty > 0)
    and (delivery_days_min is null or delivery_days_min between 0 and 120) and (delivery_days_max is null or delivery_days_max between 0 and 120)
    and (bulk_tiers is null or (jsonb_typeof(bulk_tiers) = 'array' and jsonb_array_length(bulk_tiers) <= 5))
    and (specs is null or (jsonb_typeof(specs) = 'object' and length(specs::text) <= 4000))
    and (delivery_options is null or (cardinality(delivery_options) <= 3 and delivery_options <@ array['pickup','supplier_delivery','sitemart_logistics'])));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.business_equipment add constraint business_equipment_sm_checks check (
    (year_made is null or year_made between 1950 and 2100) and (hour_meter is null or hour_meter between 0 and 500000)
    and (hourly_rate is null or hourly_rate > 0) and (weekly_rate is null or weekly_rate > 0) and (deposit_ghs is null or deposit_ghs >= 0)
    and (operator is null or operator in ('included','optional','none'))
    and (manufacturer is null or length(manufacturer) <= 80) and (model is null or length(model) <= 80)
    and (specs is null or (jsonb_typeof(specs) = 'object' and length(specs::text) <= 4000))
    and (delivery_options is null or (cardinality(delivery_options) <= 3 and delivery_options <@ array['pickup','supplier_delivery','sitemart_logistics'])));
exception when duplicate_object then null; end $$;

-- ---------- SiteMart accounts ----------
create table if not exists public.sm_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_type text not null check (account_type in ('buyer','construction_company','material_supplier','equipment_owner','rental_company',
    'contractor','developer','property_agent','logistics','project_manager')),
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  business_name text check (business_name is null or length(trim(business_name)) between 2 and 160),
  phone text check (phone is null or phone ~ '^\+[0-9]{8,15}$'),
  country text not null default 'GH' references public.sm_countries(code),
  business_category text check (business_category is null or length(business_category) <= 80),
  registration_number text check (registration_number is null or length(registration_number) <= 60),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.sm_accounts enable row level security;
drop policy if exists sm_accounts_own on public.sm_accounts;
create policy sm_accounts_own on public.sm_accounts for select to authenticated using (user_id = auth.uid() or public.is_active_admin());
revoke insert, update, delete on public.sm_accounts from anon, authenticated;

-- Sellers (who list on SiteMart) need a BAID X business profile; their listings live in the BAID X catalogue.
create or replace function public._sm_is_seller_type(t text) returns boolean language sql immutable as $$
  select t in ('material_supplier','equipment_owner','rental_company')
$$;


create table if not exists public.sm_verification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('identity','business')),
  documents text[] not null check (cardinality(documents) between 1 and 6),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_id uuid, review_note text check (review_note is null or length(review_note) <= 500), reviewed_at timestamptz,
  created_at timestamptz not null default now());
create unique index if not exists sm_verification_one_pending on public.sm_verification (user_id, kind) where status = 'pending';
alter table public.sm_verification enable row level security;
drop policy if exists sm_verification_own on public.sm_verification;
create policy sm_verification_own on public.sm_verification for select to authenticated using (user_id = auth.uid() or public.is_active_admin());
revoke insert, update, delete on public.sm_verification from anon, authenticated;

-- Private documents: <user_id>/<file>. Members upload and read only their own; staff read through signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sm-verification', 'sm-verification', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
drop policy if exists sm_verification_upload on storage.objects;
create policy sm_verification_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'sm-verification' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sm_verification_read on storage.objects;
create policy sm_verification_read on storage.objects for select to authenticated
  using (bucket_id = 'sm-verification' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_active_admin()));

-- Trust is computed, never stored or chosen: verified BAID X business > verified BAID X member > documents sent > unverified.
create or replace function public._sm_trust(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from business_profiles b where b.id = p_user and b.verification_status::text = 'verified') then 'verified_business'
    when exists (select 1 from sm_verification v where v.user_id = p_user and v.status = 'approved') then 'verified_identity'
    when exists (select 1 from sm_verification v where v.user_id = p_user and v.status = 'pending') then 'in_review'
    else 'unverified' end
$$;

create table if not exists public.sm_saved (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('material','equipment','supplier')),
  item_id uuid not null, created_at timestamptz not null default now(),
  primary key (user_id, kind, item_id));
alter table public.sm_saved enable row level security;
drop policy if exists sm_saved_own on public.sm_saved;
create policy sm_saved_own on public.sm_saved for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.sm_saved from anon, authenticated;

-- ---------- public reads ----------
create or replace function public._sm_supplier_brief(p_biz uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'name', b.business_name, 'logo', b.logo_url, 'town', b.city_town, 'region', b.region,
    'verified', b.verification_status::text = 'verified', 'accepting', coalesce(b.accepting_orders, true))
  from business_profiles b where b.id = p_biz and coalesce(b.account_status, 'active') = 'active' and b.verification_status::text <> 'rejected'
$$;

-- One listing as the storefront shows it. Never phone numbers, emails, IDs or payout details.
create or replace function public._sm_card(p_kind text, p_id uuid, p_full boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p_kind = 'equipment' then (
    select jsonb_build_object('kind', 'equipment', 'id', e.id, 'name', e.name, 'category', coalesce(c.name, nullif(trim(e.category), '')), 'category_slug', e.sm_category,
      'images', coalesce(e.image_urls, '{}'), 'description', case when p_full then e.description else left(e.description, 200) end,
      'daily_rate', e.daily_rate, 'hourly_rate', e.hourly_rate, 'weekly_rate', e.weekly_rate, 'sale_price', e.sale_price,
      'condition', e.condition::text, 'manufacturer', e.manufacturer, 'model', e.model, 'year', e.year_made, 'hours', e.hour_meter,
      'deposit', e.deposit_ghs, 'operator', e.operator, 'delivery', e.delivery_options, 'specs', case when p_full then e.specs end,
      'country', coalesce(e.country, 'GH'), 'created_at', e.created_at,
      'supplier', public._sm_supplier_brief(e.business_id))
    from business_equipment e left join sm_categories c on c.slug = e.sm_category where e.id = p_id and e.available)
  else (
    select jsonb_build_object('kind', 'material', 'id', p.id, 'name', p.name, 'category', coalesce(c.name, nullif(trim(p.category), '')), 'category_slug', p.sm_category,
      'images', coalesce(p.image_urls, '{}'), 'description', case when p_full then p.description else left(p.description, 200) end,
      'price', p.price, 'unit', p.unit, 'quantity', p.quantity, 'min_order', p.min_order_qty, 'bulk', p.bulk_tiers,
      'delivery', p.delivery_options, 'delivery_days', case when p.delivery_days_min is not null or p.delivery_days_max is not null
        then jsonb_build_object('min', p.delivery_days_min, 'max', p.delivery_days_max) end,
      'specs', case when p_full then p.specs end, 'country', coalesce(p.country, 'GH'), 'created_at', p.created_at,
      'supplier', public._sm_supplier_brief(p.business_id))
    from business_products p left join sm_categories c on c.slug = p.sm_category where p.id = p_id and p.available) end
$$;


-- Search everything SiteMart sells. p: {q, kind: all|material|equipment, category, region, deal: rent|sale, sort: best|price_low|price_high|newest, limit, offset}
create or replace function public.sitemart_search(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  words text[] := array(select w from unnest(regexp_split_to_array(lower(coalesce(p->>'q', '')), '[^a-z0-9]+')) w where length(w) > 1);
  k text := coalesce(nullif(p->>'kind', ''), 'all');
  f_cat text := nullif(p->>'category', ''); place text := nullif(lower(trim(coalesce(p->>'region', ''))), '');
  deal text := nullif(p->>'deal', ''); srt text := coalesce(nullif(p->>'sort', ''), 'best');
  lim int := least(greatest(coalesce((p->>'limit')::int, 24), 1), 60); off int := greatest(coalesce((p->>'offset')::int, 0), 0);
  boosted uuid[] := coalesce(array(select (b->>'id')::uuid from jsonb_array_elements(public.promoted()->'boosts') b where b->>'type' not in ('job', 'project')), '{}');
begin
  if k not in ('all','material','equipment') then raise exception 'unknown kind'; end if;
  return (
    with l as (
      select 'equipment' kind, e.id, e.business_id, concat_ws(' ', e.name, e.category, e.sm_category, e.manufacturer, e.model, e.description) txt,
        e.sm_category cat, coalesce(e.daily_rate, e.hourly_rate * 8, e.weekly_rate / 7, e.sale_price) sort_price, e.created_at,
        (e.daily_rate > 0 or e.hourly_rate > 0 or e.weekly_rate > 0) rent, e.sale_price > 0 sale
      from business_equipment e where e.available and k in ('all', 'equipment')
      union all
      select 'material', p2.id, p2.business_id, concat_ws(' ', p2.name, p2.category, p2.sm_category, p2.description), p2.sm_category, p2.price, p2.created_at, false, true
      from business_products p2 where p2.available and k in ('all', 'material')
    ), s as (
      select l.*, b.verification_status::text = 'verified' verified, b.id = any(boosted) featured,
        (select count(*) from unnest(words) w where lower(concat_ws(' ', l.txt, b.business_name)) like '%' || w || '%') hits
      from l join business_profiles b on b.id = l.business_id
      where coalesce(b.account_status, 'active') = 'active' and b.verification_status::text <> 'rejected'
        and (place is null or lower(concat_ws(' ', b.city_town, b.region)) like '%' || place || '%')
    ), f as (
      select * from s where (cardinality(words) = 0 or hits > 0) and (f_cat is null or s.cat = f_cat)
        and (deal is null or (deal = 'rent' and coalesce(rent, false)) or (deal = 'sale' and coalesce(sale, false)))
    ), o as (
      select f.*, row_number() over (order by
        case when srt = 'best' then hits end desc nulls last, case when srt = 'best' then featured end desc, case when srt = 'best' then verified end desc,
        case when srt = 'price_low' then sort_price end asc nulls last, case when srt = 'price_high' then sort_price end desc nulls last,
        created_at desc) ord from f)
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(public._sm_card(o.kind, o.id) || jsonb_build_object('featured', o.featured) order by o.ord) from o where o.ord > off and o.ord <= off + lim), '[]'::jsonb),
      'suppliers', case when cardinality(words) > 0 and off = 0 then coalesce((select jsonb_agg(public._sm_supplier_brief(b.id)) from (
          select b.id from business_profiles b where coalesce(b.account_status, 'active') = 'active' and b.verification_status::text <> 'rejected'
            and (select count(*) from unnest(words) w where lower(concat_ws(' ', b.business_name, b.city_town, b.region)) like '%' || w || '%') > 0
          order by b.verification_status::text = 'verified' desc limit 6) b), '[]'::jsonb) else '[]'::jsonb end)
  );
end $$;

-- The landing page in one call: categories with live counts, newest verified listings, verified suppliers, markets.
create or replace function public.sitemart_home() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'categories', (select jsonb_agg(jsonb_build_object('slug', c.slug, 'kind', c.kind, 'name', c.name, 'units', c.units,
        'count', case when c.kind = 'material' then (select count(*) from business_products p where p.available and p.sm_category = c.slug)
                      else (select count(*) from business_equipment e where e.available and e.sm_category = c.slug) end) order by c.sort) from sm_categories c),
    'countries', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'currency', currency, 'active', active) order by sort) from sm_countries),
    'suppliers', coalesce((select jsonb_agg(public._sm_supplier_brief(b.id)) from (
        select b.id from business_profiles b where b.verification_status::text = 'verified' and coalesce(b.account_status, 'active') = 'active'
          and (exists (select 1 from business_products p where p.business_id = b.id and p.available) or exists (select 1 from business_equipment e where e.business_id = b.id and e.available))
        order by b.business_name limit 8) b), '[]'::jsonb),
    'latest', coalesce((select jsonb_agg(public._sm_card(x.kind, x.id)) from (
        select * from (select 'material' kind, p.id, p.created_at, p.business_id from business_products p where p.available
                       union all select 'equipment', e.id, e.created_at, e.business_id from business_equipment e where e.available) y
        where public._sm_supplier_brief(y.business_id) is not null order by y.created_at desc limit 8) x), '[]'::jsonb))
$$;

create or replace function public.sitemart_listing(p_kind text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if p_kind not in ('material','equipment') then raise exception 'unknown kind'; end if;
  r := public._sm_card(p_kind, p_id, true);
  if r is null or r->'supplier' is null or r->'supplier' = 'null'::jsonb then return null; end if;
  return r || jsonb_build_object('supplier', (r->'supplier') || jsonb_build_object('trust', public._sm_trust((r->'supplier'->>'id')::uuid),
    'about', (select left(short_bio, 300) from business_profiles where id = (r->'supplier'->>'id')::uuid)));
end $$;

create or replace function public.sitemart_supplier(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when public._sm_supplier_brief(p_id) is null then null else public._sm_supplier_brief(p_id) || jsonb_build_object(
    'trust', public._sm_trust(p_id), 'about', (select left(short_bio, 600) from business_profiles where id = p_id),
    'listings', coalesce((select jsonb_agg(public._sm_card(x.kind, x.id) order by x.created_at desc) from (
      select 'material' kind, id, created_at from business_products where business_id = p_id and available
      union all select 'equipment', id, created_at from business_equipment where business_id = p_id and available limit 60) x), '[]'::jsonb),
    'completed_orders', (select count(*) from orders where business_id = p_id and status = 'completed')) end
$$;

-- ---------- member writes ----------
create or replace function public.sm_register(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text := p->>'account_type'; ph text := nullif(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), '');
begin
  if me is null then raise exception 'sign in first'; end if;
  if t is null or t not in ('buyer','construction_company','material_supplier','equipment_owner','rental_company','contractor','developer','property_agent','logistics','project_manager')
    then raise exception 'choose an account type'; end if;
  if length(trim(coalesce(p->>'display_name', ''))) < 2 then raise exception 'add your full name'; end if;
  if t <> 'buyer' and length(trim(coalesce(p->>'business_name', ''))) < 2 then raise exception 'add your registered business name'; end if;
  if ph is not null and ph !~ '^\+[0-9]{8,15}$' then raise exception 'add your phone number with the country code, like +233 20 000 0000'; end if;
  if not exists (select 1 from sm_countries where code = coalesce(p->>'country', 'GH') and active) then raise exception 'SiteMart is not open in that country yet'; end if;
  insert into sm_accounts(user_id, account_type, display_name, business_name, phone, country, business_category, registration_number)
  values (me, t, trim(p->>'display_name'), nullif(trim(coalesce(p->>'business_name', '')), ''), ph, coalesce(p->>'country', 'GH'),
    nullif(trim(coalesce(p->>'business_category', '')), ''), nullif(trim(coalesce(p->>'registration_number', '')), ''))
  on conflict (user_id) do update set account_type = excluded.account_type, display_name = excluded.display_name, business_name = excluded.business_name,
    phone = excluded.phone, country = excluded.country, business_category = excluded.business_category, registration_number = excluded.registration_number, updated_at = now();
  return public.sm_me();
end $$;

create or replace function public.sm_me() returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'account', (select to_jsonb(a) - 'user_id' from sm_accounts a where a.user_id = auth.uid()),
    'trust', public._sm_trust(auth.uid()),
    'business', (select jsonb_build_object('id', b.id, 'name', b.business_name, 'verified', b.verification_status::text = 'verified') from business_profiles b where b.id = auth.uid()),
    'verification', coalesce((select jsonb_agg(jsonb_build_object('kind', v.kind, 'status', v.status, 'note', v.review_note, 'created_at', v.created_at) order by v.created_at desc)
      from sm_verification v where v.user_id = auth.uid()), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('kind', 'material', 'id', id, 'name', name, 'available', available, 'category_slug', sm_category, 'unit', unit, 'price', price,
        'min_order', min_order_qty, 'bulk', bulk_tiers, 'delivery', delivery_options, 'delivery_days_min', delivery_days_min, 'delivery_days_max', delivery_days_max, 'specs', specs, 'created_at', created_at) x
        from business_products where business_id = auth.uid()
      union all select jsonb_build_object('kind', 'equipment', 'id', id, 'name', name, 'available', available, 'category_slug', sm_category, 'daily_rate', daily_rate,
        'hourly_rate', hourly_rate, 'weekly_rate', weekly_rate, 'sale_price', sale_price, 'manufacturer', manufacturer, 'model', model, 'year', year_made,
        'hours', hour_meter, 'deposit', deposit_ghs, 'operator', operator, 'delivery', delivery_options, 'specs', specs, 'created_at', created_at)
        from business_equipment where business_id = auth.uid()) y), '[]'::jsonb),
    'saved', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'id', item_id)) from sm_saved where user_id = auth.uid()), '[]'::jsonb)) end
$$;

-- A seller adds the SiteMart details to one of their own BAID X listings. Prices and stock stay in the BAID X catalogue editor.
create or replace function public.sm_listing_details(p_kind text, p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cat text := nullif(p->>'category', ''); dl text[] := array(select jsonb_array_elements_text(coalesce(p->'delivery', '[]'::jsonb)));
  tiers jsonb := p->'bulk'; t jsonb;
begin
  if me is null then raise exception 'sign in first'; end if;
  if cat is not null and not exists (select 1 from sm_categories where slug = cat and kind = p_kind) then raise exception 'choose a category'; end if;
  if tiers is not null and tiers <> 'null'::jsonb then
    if jsonb_typeof(tiers) <> 'array' or jsonb_array_length(tiers) > 5 then raise exception 'up to 5 bulk prices'; end if;
    for t in select * from jsonb_array_elements(tiers) loop
      if (t->>'min_qty')::numeric is null or (t->>'min_qty')::numeric <= 0 or (t->>'unit_price')::numeric is null or (t->>'unit_price')::numeric <= 0
        then raise exception 'each bulk price needs a quantity and a price'; end if;
    end loop;
  else tiers := null; end if;
  if p_kind = 'material' and not public._sm_unit_ok(nullif(p->>'unit', '')) then raise exception 'choose a unit from the list'; end if;
  if p_kind = 'material' then
    update business_products set sm_category = cat, unit = nullif(p->>'unit', ''), min_order_qty = nullif(p->>'min_order', '')::numeric, bulk_tiers = tiers,
      delivery_options = nullif(dl, '{}'), delivery_days_min = nullif(p->>'delivery_days_min', '')::int, delivery_days_max = nullif(p->>'delivery_days_max', '')::int,
      specs = case when jsonb_typeof(p->'specs') = 'object' then p->'specs' end, updated_at = now()
    where id = p_id and business_id = me;
  elsif p_kind = 'equipment' then
    update business_equipment set sm_category = cat, manufacturer = nullif(trim(coalesce(p->>'manufacturer', '')), ''), model = nullif(trim(coalesce(p->>'model', '')), ''),
      year_made = nullif(p->>'year', '')::int, hour_meter = nullif(p->>'hours', '')::int, hourly_rate = nullif(p->>'hourly_rate', '')::numeric,
      weekly_rate = nullif(p->>'weekly_rate', '')::numeric, deposit_ghs = nullif(p->>'deposit', '')::numeric, operator = nullif(p->>'operator', ''),
      delivery_options = nullif(dl, '{}'), specs = case when jsonb_typeof(p->'specs') = 'object' then p->'specs' end, updated_at = now()
    where id = p_id and business_id = me;
  else raise exception 'unknown kind'; end if;
  if not found then raise exception 'not your listing'; end if;
  return public._sm_card(p_kind, p_id, true);
end $$;

create or replace function public.sm_toggle_saved(p_kind text, p_id uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_kind not in ('material','equipment','supplier') then raise exception 'unknown kind'; end if;
  delete from sm_saved where user_id = me and kind = p_kind and item_id = p_id;
  if found then return false; end if;
  if (select count(*) from sm_saved where user_id = me) >= 500 then raise exception 'you have saved the most you can'; end if;
  insert into sm_saved(user_id, kind, item_id) values (me, p_kind, p_id);
  return true;
end $$;

create or replace function public.sm_submit_verification(p_kind text, p_documents text[], p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d text;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_kind not in ('identity','business') then raise exception 'unknown check'; end if;
  if not exists (select 1 from sm_accounts where user_id = me) then raise exception 'finish setting up your SiteMart account first'; end if;
  if coalesce(cardinality(p_documents), 0) not between 1 and 6 then raise exception 'add 1 to 6 documents'; end if;
  foreach d in array p_documents loop
    if split_part(d, '/', 1) <> me::text or d like '%..%' then raise exception 'documents must be your own uploads'; end if;
  end loop;
  insert into sm_verification(user_id, kind, documents, note) values (me, p_kind, p_documents, left(nullif(trim(p_note), ''), 500));
  return jsonb_build_object('status', 'pending');
exception when unique_violation then raise exception 'you already have documents in review for this check';
end $$;

-- Only BAID X staff with the verification permission decide; every decision is audited.
create or replace function public.admin_sm_review_verification(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare v sm_verification;
begin
  perform public._need('verification', 'APPROVE');
  select * into v from sm_verification where id = p_id for update;
  if not found or v.status <> 'pending' then raise exception 'not in review'; end if;
  update sm_verification set status = case when p_approve then 'approved' else 'rejected' end, reviewer_id = auth.uid(), review_note = left(nullif(trim(p_note), ''), 500), reviewed_at = now() where id = p_id;
  perform public._audit('sm_review_verification', 'sm_verification', p_id::text, to_jsonb(v), jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end), jsonb_build_object('approve', p_approve));
  perform notify_user(v.user_id, 'verification_reviewed', 'SiteMart verification', case when p_approve then 'Your documents were approved.' else 'Your documents were not approved. ' || coalesce(p_note, '') end, '#/dashboard', '{}'::jsonb);
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end);
end $$;

-- ---------- grants ----------
revoke all on function public._sm_unit_ok(text), public._sm_is_seller_type(text), public._sm_trust(uuid), public._sm_card(text, uuid, boolean), public._sm_supplier_brief(uuid) from public, anon, authenticated;
revoke all on function public.sitemart_search(jsonb), public.sitemart_home(), public.sitemart_listing(text, uuid), public.sitemart_supplier(uuid) from public;
grant execute on function public.sitemart_search(jsonb), public.sitemart_home(), public.sitemart_listing(text, uuid), public.sitemart_supplier(uuid) to anon, authenticated;
revoke all on function public.sm_register(jsonb), public.sm_me(), public.sm_listing_details(text, uuid, jsonb), public.sm_toggle_saved(text, uuid),
  public.sm_submit_verification(text, text[], text), public.admin_sm_review_verification(uuid, boolean, text) from public, anon;
grant execute on function public.sm_register(jsonb), public.sm_me(), public.sm_listing_details(text, uuid, jsonb), public.sm_toggle_saved(text, uuid),
  public.sm_submit_verification(text, text[], text), public.admin_sm_review_verification(uuid, boolean, text) to authenticated;
