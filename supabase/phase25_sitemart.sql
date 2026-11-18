-- Phase 25: SiteMart by BAID X, the public storefront for equipment and building materials.
-- SiteMart (sites/sitemart, its own website) shows what suppliers already list on BAID X
-- (business_equipment, business_products). Visitors browse without signing in; ordering and paying
-- stay on BAID X (place_order, wallet and escrow from phase 9), so no money path changes here.
--   sitemart_catalog(): search the live listings, featured and verified suppliers first.
--   sitemart_item(): one listing with its supplier, for the listing page.
-- Returns only what a public storefront shows: never phone numbers, emails, IDs or payout details.
-- Non-destructive: functions only.

create or replace function public.sitemart_catalog(
  p_kind text default 'all',        -- all | equipment | materials
  p_query text default null,        -- words, e.g. "excavator", "cement blocks"
  p_region text default null,       -- town or region
  p_category text default null,     -- the supplier's own category label
  p_limit int default 24,
  p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  words text[] := array(select w from unnest(regexp_split_to_array(lower(coalesce(p_query, '')), '[^a-z0-9]+')) w where length(w) > 1);
  place text := nullif(lower(trim(coalesce(p_region, ''))), '');
  cat text := nullif(lower(trim(coalesce(p_category, ''))), '');
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  off int := greatest(coalesce(p_offset, 0), 0);
  boosted uuid[] := array(select (b->>'id')::uuid from jsonb_array_elements(public.promoted()->'boosts') b where b->>'type' not in ('job', 'project'));
begin
  return (
    with l as (
      select 'equipment' kind, e.id, e.business_id, e.name, e.category, e.description, e.image_urls, e.created_at,
        e.daily_rate, e.sale_price, e.rental_price, null::numeric price, null::numeric quantity, e.condition::text condition
      from business_equipment e where e.available and p_kind in ('all', 'equipment')
      union all
      select 'material', p.id, p.business_id, p.name, p.category, p.description, p.image_urls, p.created_at,
        null, null, null, p.price, p.quantity, null
      from business_products p where p.available and p_kind in ('all', 'materials')
    ), s as (
      select l.*, b.business_name, b.logo_url, b.city_town, b.region, b.verification_status::text = 'verified' verified,
        coalesce(b.accepting_orders, true) accepting, b.id = any(boosted) featured,
        (select count(*) from unnest(words) w where lower(concat_ws(' ', l.name, l.category, l.description, b.business_name)) like '%' || w || '%') hits
      from l join business_profiles b on b.id = l.business_id
      where coalesce(b.account_status, 'active') = 'active' and b.verification_status::text <> 'rejected'
    ), f as (
      select * from s
      where (cardinality(words) = 0 or hits > 0)
        and (place is null or lower(concat_ws(' ', city_town, region)) like '%' || place || '%')
        and (cat is null or lower(trim(coalesce(category, ''))) = cat)
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', kind, 'id', id, 'name', name, 'category', nullif(trim(category), ''), 'description', left(description, 240),
          'images', coalesce(image_urls, '{}'), 'daily_rate', daily_rate, 'sale_price', sale_price, 'rental_price', rental_price,
          'price', price, 'quantity', quantity, 'condition', condition, 'created_at', created_at,
          'supplier', jsonb_build_object('id', business_id, 'name', business_name, 'logo', logo_url, 'town', city_town, 'region', region,
            'verified', verified, 'accepting', accepting, 'featured', featured)) order by ord)
        from (select f.*, row_number() over (order by hits desc, featured desc, verified desc, created_at desc) ord from f order by ord limit lim offset off) t), '[]'::jsonb),
      'categories', coalesce((select jsonb_agg(c order by c) from (select distinct nullif(trim(category), '') c from s) x where c is not null), '[]'::jsonb)
    ));
end $$;

create or replace function public.sitemart_item(p_kind text, p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (
    select 'equipment' kind, e.id, e.business_id, e.name, e.category, e.description, e.image_urls, e.created_at,
      e.daily_rate, e.sale_price, e.rental_price, null::numeric price, null::numeric quantity, e.condition::text condition
    from business_equipment e where p_kind = 'equipment' and e.id = p_id and e.available
    union all
    select 'material', p.id, p.business_id, p.name, p.category, p.description, p.image_urls, p.created_at,
      null, null, null, p.price, p.quantity, null
    from business_products p where p_kind = 'materials' and p.id = p_id and p.available
  )
  select jsonb_build_object('kind', l.kind, 'id', l.id, 'name', l.name, 'category', nullif(trim(l.category), ''), 'description', l.description,
      'images', coalesce(l.image_urls, '{}'), 'daily_rate', l.daily_rate, 'sale_price', l.sale_price, 'rental_price', l.rental_price,
      'price', l.price, 'quantity', l.quantity, 'condition', l.condition, 'created_at', l.created_at,
      'supplier', jsonb_build_object('id', b.id, 'name', b.business_name, 'logo', b.logo_url, 'town', b.city_town, 'region', b.region,
        'verified', b.verification_status::text = 'verified', 'accepting', coalesce(b.accepting_orders, true), 'about', left(b.short_bio, 300)))
  from l join business_profiles b on b.id = l.business_id
  where coalesce(b.account_status, 'active') = 'active' and b.verification_status::text <> 'rejected'
$$;

-- A storefront is public: visitors (anon) and members can read it.
revoke all on function public.sitemart_catalog(text, text, text, text, int, int) from public;
revoke all on function public.sitemart_item(text, uuid) from public;
grant execute on function public.sitemart_catalog(text, text, text, text, int, int) to anon, authenticated;
grant execute on function public.sitemart_item(text, uuid) to anon, authenticated;
