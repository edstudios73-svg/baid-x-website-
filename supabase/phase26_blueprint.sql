-- Phase 26: Blueprint, house plans and designs sold by architects and designers.
-- Blueprint (sites/blueprint) is its own website on the same database and BAID X accounts.
--   house_plans        a plan for sale: details, photos (public bucket plan-previews), price
--   plan_purchases     who bought which plan; one purchase per buyer per plan
--   plan files         the drawings themselves, in the private bucket plan-files, readable only by the
--                      seller and by buyers who paid
-- Phase 1 sellers are verified BAID X professionals (worker accounts with a badge). The Architect
-- account type comes in phase 2 and only widens _blueprint_seller().
-- Paying: buy_plan() takes the price from the buyer's BAID X wallet through an escrow hold that is
-- released to the seller at once (the files are delivered at once), so the seller is paid minus the
-- platform's commission (platform_settings.commission_rate) exactly like other BAID X sales.
-- Non-destructive: new tables, buckets, policies and functions only.

create table if not exists public.house_plans (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('BXD-PLAN-' || upper(substr(md5(random()::text), 1, 8))),
  seller_id uuid not null,
  seller_role text not null default 'worker' check (seller_role in ('worker', 'architect')),
  title text not null check (length(trim(title)) between 3 and 90),
  summary text check (summary is null or length(summary) <= 200),
  description text check (description is null or length(description) <= 3000),
  style text check (style is null or length(style) <= 40),
  bedrooms int check (bedrooms is null or bedrooms between 0 and 30),
  bathrooms int check (bathrooms is null or bathrooms between 0 and 30),
  storeys int check (storeys is null or storeys between 1 and 30),
  floor_area_m2 numeric check (floor_area_m2 is null or floor_area_m2 > 0),
  plot_size text check (plot_size is null or length(plot_size) <= 40),
  est_build_cost_ghs numeric check (est_build_cost_ghs is null or est_build_cost_ghs > 0),
  price_ghs numeric not null check (price_ghs >= 10 and price_ghs <= 500000),
  includes text[] not null default '{}',
  cover_url text, image_urls text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'removed')),
  sales int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists house_plans_seller_idx on public.house_plans (seller_id, created_at desc);
create index if not exists house_plans_live_idx on public.house_plans (status, created_at desc);
alter table public.house_plans enable row level security;
create policy house_plans_read on public.house_plans for select to anon, authenticated
  using (status = 'published' or seller_id = auth.uid() or public.is_active_admin());
revoke insert, update, delete on public.house_plans from anon, authenticated;

create table if not exists public.plan_purchases (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  plan_id uuid not null references public.house_plans(id) on delete restrict,
  buyer_id uuid not null, buyer_role text not null,
  seller_id uuid not null,
  amount_ghs numeric not null check (amount_ghs > 0),
  escrow_id uuid references public.escrow_holds(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plan_id, buyer_id));
create index if not exists plan_purchases_buyer_idx on public.plan_purchases (buyer_id, created_at desc);
create index if not exists plan_purchases_seller_idx on public.plan_purchases (seller_id, created_at desc);
alter table public.plan_purchases enable row level security;
create policy plan_purchases_party on public.plan_purchases for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_active_admin());
revoke insert, update, delete on public.plan_purchases from anon, authenticated;

-- Who may sell plans. Phase 1: a verified professional. Phase 2 adds the Architect account here.
create or replace function public._blueprint_seller(p_uid uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select 'worker' from worker_profiles w join account_roles a on a.user_id = w.id and a.role = 'worker' and a.account_status = 'active'
  where w.id = p_uid and w.verification_status::text = 'verified' limit 1
$$;

-- Photos: public bucket, <seller id>/<plan id>/<file>. Files: private bucket, same layout.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plan-previews', 'plan-previews', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plan-files', 'plan-files', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png', 'application/zip', 'application/x-zip-compressed'])
on conflict (id) do nothing;

-- the plan a storage path belongs to, when the caller owns it
create or replace function public._plan_of_path(p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from house_plans p
  where (storage.foldername(p_name))[1] = auth.uid()::text and p.seller_id = auth.uid()
    and p.id::text = (storage.foldername(p_name))[2]
$$;
-- may the caller read this plan file: the seller, a buyer who paid, or staff
create or replace function public._plan_file_reader(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from house_plans p where p.id::text = (storage.foldername(p_name))[2]
      and (p.seller_id = auth.uid() or public.is_active_admin()
        or exists (select 1 from plan_purchases b where b.plan_id = p.id and b.buyer_id = auth.uid())))
$$;
create policy plan_previews_upload on storage.objects for insert to authenticated with check (bucket_id = 'plan-previews' and public._plan_of_path(name) is not null);
create policy plan_previews_delete on storage.objects for delete to authenticated using (bucket_id = 'plan-previews' and public._plan_of_path(name) is not null);
create policy plan_files_upload on storage.objects for insert to authenticated with check (bucket_id = 'plan-files' and public._plan_of_path(name) is not null);
create policy plan_files_read on storage.objects for select to authenticated using (bucket_id = 'plan-files' and public._plan_file_reader(name));
create policy plan_files_delete on storage.objects for delete to authenticated using (bucket_id = 'plan-files' and public._plan_of_path(name) is not null);

-- The gallery: published plans, newest and best-selling first, with the designer's public profile.
create or replace function public.blueprint_plans(p_query text default null, p_bedrooms int default null, p_max_price numeric default null,
  p_style text default null, p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  words text[] := array(select w from unnest(regexp_split_to_array(lower(coalesce(p_query, '')), '[^a-z0-9]+')) w where length(w) > 1);
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  return (
    with f as (
      select p.*, w.full_name designer, w.profile_photo_url photo, w.city_town town, w.region, w.verification_status::text = 'verified' verified,
        (select count(*) from unnest(words) x where lower(concat_ws(' ', p.title, p.summary, p.style, p.description)) like '%' || x || '%') hits
      from house_plans p left join worker_profiles w on w.id = p.seller_id
      where p.status = 'published'
        and (p_bedrooms is null or p.bedrooms >= p_bedrooms)
        and (p_max_price is null or p.price_ghs <= p_max_price)
        and (nullif(trim(coalesce(p_style, '')), '') is null or lower(p.style) = lower(trim(p_style)))
    ), m as (select * from f where cardinality(words) = 0 or hits > 0)
    select jsonb_build_object(
      'total', (select count(*) from m),
      'styles', coalesce((select jsonb_agg(distinct style) from house_plans where status = 'published' and style is not null), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'summary', summary, 'style', style, 'bedrooms', bedrooms,
          'bathrooms', bathrooms, 'storeys', storeys, 'floor_area_m2', floor_area_m2, 'plot_size', plot_size, 'est_build_cost_ghs', est_build_cost_ghs,
          'price_ghs', price_ghs, 'cover', coalesce(cover_url, image_urls[1]), 'sales', sales,
          'designer', jsonb_build_object('id', seller_id, 'name', designer, 'photo', photo, 'town', town, 'region', region, 'verified', verified)) order by ord)
        from (select m.*, row_number() over (order by hits desc, sales desc, created_at desc) ord from m order by ord limit lim offset greatest(coalesce(p_offset, 0), 0)) t), '[]'::jsonb)));
end $$;

-- One plan, with whether the caller already owns it. Never the file paths.
create or replace function public.blueprint_plan(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'public_id', p.public_id, 'title', p.title, 'summary', p.summary, 'description', p.description, 'style', p.style,
      'bedrooms', p.bedrooms, 'bathrooms', p.bathrooms, 'storeys', p.storeys, 'floor_area_m2', p.floor_area_m2, 'plot_size', p.plot_size,
      'est_build_cost_ghs', p.est_build_cost_ghs, 'price_ghs', p.price_ghs, 'includes', p.includes, 'cover', coalesce(p.cover_url, p.image_urls[1]),
      'images', p.image_urls, 'sales', p.sales, 'status', p.status, 'created_at', p.created_at,
      'owned', exists (select 1 from plan_purchases b where b.plan_id = p.id and b.buyer_id = auth.uid()),
      'mine', p.seller_id = auth.uid(),
      'designer', jsonb_build_object('id', p.seller_id, 'name', w.full_name, 'photo', w.profile_photo_url, 'town', w.city_town, 'region', w.region,
        'verified', w.verification_status::text = 'verified', 'about', left(w.short_bio, 300)))
  from house_plans p left join worker_profiles w on w.id = p.seller_id
  where p.id = p_id and (p.status = 'published' or p.seller_id = auth.uid() or public.is_active_admin())
$$;

-- A seller creates or edits a plan (p_id null creates a draft). Photos and files are uploaded to the
-- buckets under <seller id>/<plan id>/ and passed back here as public URLs (photos).
create or replace function public.blueprint_save_plan(p_id uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); srole text := public._blueprint_seller(); pid uuid := p_id; st text := coalesce(p_plan->>'status', 'draft');
  imgs text[] := coalesce(array(select jsonb_array_elements_text(p_plan->'image_urls')), '{}');
  inc text[] := coalesce(array(select jsonb_array_elements_text(p_plan->'includes')), '{}');
begin
  if me is null then raise exception 'sign in first'; end if;
  if srole is null then raise exception 'Only verified professionals can sell plans on Blueprint for now.'; end if;
  if st not in ('draft', 'published', 'paused') then raise exception 'choose draft, published or paused'; end if;
  if cardinality(imgs) > 12 then raise exception 'up to 12 photos'; end if;
  if exists (select 1 from unnest(imgs) u where u not like '%/storage/v1/object/public/plan-previews/' || me::text || '/%') then raise exception 'photos must be uploaded to your plan folder'; end if;
  if st = 'published' and cardinality(imgs) = 0 then raise exception 'add at least one photo before publishing'; end if;
  if pid is null then
    insert into house_plans (seller_id, seller_role, title, price_ghs) values (me, srole, coalesce(nullif(trim(p_plan->>'title'), ''), 'Untitled plan'), coalesce((p_plan->>'price_ghs')::numeric, 10))
      returning id into pid;
  elsif not exists (select 1 from house_plans where id = pid and seller_id = me and status <> 'removed') then raise exception 'not your plan';
  end if;
  update house_plans set
    title = coalesce(nullif(trim(p_plan->>'title'), ''), title), summary = nullif(trim(p_plan->>'summary'), ''), description = nullif(trim(p_plan->>'description'), ''),
    style = nullif(trim(p_plan->>'style'), ''), bedrooms = (p_plan->>'bedrooms')::int, bathrooms = (p_plan->>'bathrooms')::int, storeys = coalesce((p_plan->>'storeys')::int, 1),
    floor_area_m2 = (p_plan->>'floor_area_m2')::numeric, plot_size = nullif(trim(p_plan->>'plot_size'), ''), est_build_cost_ghs = (p_plan->>'est_build_cost_ghs')::numeric,
    price_ghs = coalesce((p_plan->>'price_ghs')::numeric, price_ghs), includes = inc, image_urls = imgs, cover_url = imgs[1], status = st, updated_at = now()
  where id = pid;
  return jsonb_build_object('id', pid, 'status', st);
end $$;

-- The seller's own plans with sales.
create or replace function public.blueprint_my_plans() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'price_ghs', price_ghs, 'sales', sales,
    'cover', coalesce(cover_url, image_urls[1]), 'updated_at', updated_at) order by updated_at desc), '[]'::jsonb)
  from house_plans where seller_id = auth.uid() and status <> 'removed'
$$;

-- Buy a plan with the BAID X wallet. The money goes through an escrow hold released to the seller at
-- once (the files are delivered at once), so the seller is paid minus BAID X's commission.
create or replace function public.buy_plan(p_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); brole text; p house_plans; bal numeric; esc uuid; tx uuid; pid uuid := gen_random_uuid();
begin
  if me is null then raise exception 'sign in first'; end if;
  select replace(role, '-', '_') into brole from account_roles where user_id = me and account_status = 'active' limit 1;
  if brole is null then raise exception 'finish setting up your BAID X account first'; end if;
  select * into p from house_plans where id = p_plan and status = 'published' for update;
  if not found then raise exception 'this plan is not for sale'; end if;
  if p.seller_id = me then raise exception 'this is your own plan'; end if;
  if exists (select 1 from plan_purchases where plan_id = p.id and buyer_id = me) then raise exception 'you already own this plan'; end if;
  select available_ghs into bal from wallet_accounts where owner_role = brole and owner_id = me for update;
  if coalesce(bal, 0) < p.price_ghs then raise exception 'insufficient_funds:%', round(p.price_ghs - coalesce(bal, 0), 2); end if;
  update wallet_accounts set available_ghs = available_ghs - p.price_ghs, lifetime_spent_ghs = lifetime_spent_ghs + p.price_ghs, updated_at = now()
    where owner_role = brole and owner_id = me;
  insert into escrow_holds(public_id, payer_role, payer_id, receiver_role, receiver_id, context_type, context_id, amount_ghs, status, description, idempotency_key)
    values ('BXD-ESC-' || upper(substr(md5(random()::text || pid::text), 1, 8)), brole, me, p.seller_role, p.seller_id, 'listing', pid, p.price_ghs, 'locked',
      'House plan: ' || p.title, 'plan:' || pid::text) returning id into esc;
  insert into wallet_transactions(public_id, owner_role, owner_id, counterparty_role, counterparty_id, type, amount_ghs, net_ghs, status, description, escrow_id, idempotency_key)
    values ('BXD-TX-' || upper(substr(md5(random()::text || esc::text), 1, 8)), brole, me, p.seller_role, p.seller_id, 'escrow_lock', p.price_ghs, p.price_ghs, 'completed',
      'House plan: ' || p.title, esc, 'escrow-lock:' || esc::text) returning id into tx;
  update escrow_holds set lock_tx_id = tx where id = esc;
  insert into plan_purchases(id, public_id, plan_id, buyer_id, buyer_role, seller_id, amount_ghs, escrow_id)
    values (pid, 'BXD-PP-' || upper(substr(md5(random()::text || pid::text), 1, 8)), p.id, me, brole, p.seller_id, p.price_ghs, esc);
  perform public._escrow_release(esc);
  update house_plans set sales = sales + 1, updated_at = now() where id = p.id;
  perform notify_user(p.seller_id, 'plan_sold', 'Plan sold', 'Someone bought "' || p.title || '". The money is in your BAID X wallet.', '#/wallet', '{}'::jsonb);
  return jsonb_build_object('purchase_id', pid, 'plan_id', p.id, 'amount', p.price_ghs);
end $$;

-- The plans a member bought, with the folder their files are in.
create or replace function public.blueprint_my_purchases() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('purchase_id', b.id, 'plan_id', p.id, 'title', p.title, 'cover', coalesce(p.cover_url, p.image_urls[1]),
    'amount', b.amount_ghs, 'bought_at', b.created_at, 'files_folder', p.seller_id::text || '/' || p.id::text) order by b.created_at desc), '[]'::jsonb)
  from plan_purchases b join house_plans p on p.id = b.plan_id where b.buyer_id = auth.uid()
$$;

revoke all on function public._blueprint_seller(uuid) from public, anon, authenticated;
revoke all on function public._plan_of_path(text) from public, anon;
revoke all on function public._plan_file_reader(text) from public, anon;
revoke all on function public.blueprint_plans(text, int, numeric, text, int, int) from public;
revoke all on function public.blueprint_plan(uuid) from public;
revoke all on function public.blueprint_save_plan(uuid, jsonb) from public, anon;
revoke all on function public.blueprint_my_plans() from public, anon;
revoke all on function public.buy_plan(uuid) from public, anon;
revoke all on function public.blueprint_my_purchases() from public, anon;
grant execute on function public.blueprint_plans(text, int, numeric, text, int, int) to anon, authenticated;
grant execute on function public.blueprint_plan(uuid) to anon, authenticated;
grant execute on function public._plan_of_path(text) to authenticated;
grant execute on function public._plan_file_reader(text) to authenticated;
grant execute on function public.blueprint_save_plan(uuid, jsonb) to authenticated;
grant execute on function public.blueprint_my_plans() to authenticated;
grant execute on function public.buy_plan(uuid) to authenticated;
grant execute on function public.blueprint_my_purchases() to authenticated;
