-- BAID X · Phase 17: supplier listings with photo galleries. Applied to project igfmmprlrybxsdzehwid.
-- Equipment gets a description like products; supplier_catalog returns every photo plus what a buyer needs to
-- judge a listing (supplier logo, town, verification, condition, stock, date). Listing writes stay owner-only (RLS).

alter table public.business_equipment add column if not exists description text check (description is null or length(description) <= 600);

create or replace function public.supplier_catalog(p_kind text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if p_kind = 'equipment' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'business_id', e.business_id, 'business', b.business_name, 'logo', b.logo_url,
        'verified', b.verification_status = 'verified', 'region', b.region, 'town', b.city_town, 'name', e.name, 'category', e.category,
        'daily_rate', e.daily_rate, 'sale_price', e.sale_price, 'rental_price', e.rental_price, 'condition', e.condition, 'description', e.description,
        'images', coalesce(e.image_urls, '{}'), 'accepting', coalesce(b.accepting_orders, true), 'created_at', e.created_at) order by e.created_at desc), '[]')
      from business_equipment e join business_profiles b on b.id = e.business_id where e.available);
  else
    return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'business_id', p.business_id, 'business', b.business_name, 'logo', b.logo_url,
        'verified', b.verification_status = 'verified', 'region', b.region, 'town', b.city_town, 'name', p.name, 'category', p.category,
        'price', p.price, 'quantity', p.quantity, 'description', p.description,
        'images', coalesce(p.image_urls, '{}'), 'accepting', coalesce(b.accepting_orders, true), 'created_at', p.created_at) order by p.created_at desc), '[]')
      from business_products p join business_profiles b on b.id = p.business_id where p.available);
  end if;
end $function$;
