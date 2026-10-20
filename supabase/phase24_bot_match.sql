-- Phase 24: BAID Bot can recommend real people and open jobs.
--   bot_find_people(): the best matching active members for a trade, place and need, ranked like Discover
--     (boosted, then paid plan, then verified) and then by reviews and experience. Returns only what the public
--     directory already shows (name, trade, town, rate, experience, badge, rating); never phone, email or IDs.
--   bot_find_jobs(): open jobs matching a trade and place.
--   _bot_ai_key(): the Anthropic key, read from Vault by the baid-bot function.
-- All three are for the service role only (the baid-bot function); visitors never call them directly.
-- Non-destructive: functions only.

create or replace function public._bot_years(p text) returns int language sql immutable as $$
  select case p when '<1' then 0 when '1-3' then 1 when '3-5' then 3 when '5-10' then 5 when '10+' then 10 else null end
$$;

create or replace function public.bot_find_people(
  p_kind text default 'worker',          -- worker | pm | company | supplier
  p_query text default null,             -- trade or need, e.g. "electrician", "tiling a bathroom"
  p_region text default null,            -- region or town, e.g. "Accra", "Ashanti", "Kumasi"
  p_min_years int default null,
  p_max_rate numeric default null,       -- GH₵ a day (workers)
  p_verified_only boolean default false,
  p_limit int default 5
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  promo jsonb := public.promoted();
  words text[] := array(select w from unnest(regexp_split_to_array(lower(coalesce(p_query, '')), '[^a-z0-9]+')) w
                        where length(w) > 2 and w not in ('the','and','for','top','best','good','need','want','someone','who','can','with','near','find','one','looking','person','people','professional','experienced','verified'));
  place text := nullif(lower(trim(coalesce(p_region, ''))), '');
  lim int := least(greatest(coalesce(p_limit, 5), 1), 8);
  out jsonb;
begin
  with plan as (select (m->>'id')::uuid id, m->>'tier' tier from jsonb_array_elements(promo->'members') m),
  boost as (select (b->>'id')::uuid id from jsonb_array_elements(promo->'boosts') b where b->>'type' not in ('job', 'project', 'business_listing')),
  rating as (
    select uid, round(avg(r)::numeric, 1) avg, count(*) n from (
      select worker_id uid, rating r from job_reviews where rating is not null
      union all select reviewee_id, rating from project_reviews where rating is not null) x group by uid),
  cand as (
    select 'worker' kind, w.id, w.full_name name, coalesce(c.name, w.specialty, 'Professional') trade, w.city_town town, w.region,
      w.daily_rate_ghs rate, _bot_years(w.years_of_experience::text) years, w.years_of_experience::text years_label,
      w.verification_status::text = 'verified' verified, w.badge_tier, coalesce(w.short_bio, w.personal_statement) bio,
      w.profile_photo_url photo, coalesce(w.available_for_work, true) available, w.created_at,
      lower(concat_ws(' ', c.name, w.specialty, w.short_bio, w.personal_statement)) hay
    from worker_profiles w left join job_categories c on c.id = w.primary_job_category_id
    where p_kind = 'worker' and coalesce(w.account_status, 'active') = 'active' and w.verification_status::text <> 'rejected'
    union all
    select 'pm', p.id, p.full_name, coalesce(initcap(replace(p.specialization::text, '_', ' ')), 'Project manager'), p.city_town, p.region,
      null, p.years_managing_projects, p.years_managing_projects::text, p.verification_status::text = 'verified', p.badge_tier,
      array_to_string(p.specialization_tags, ', '), p.profile_photo_url, true, p.created_at,
      lower(concat_ws(' ', p.specialization::text, array_to_string(p.specialization_tags, ' '), 'project manager'))
    from project_manager_profiles p
    where p_kind = 'pm' and coalesce(p.account_status, 'active') = 'active' and p.verification_status::text <> 'rejected'
    union all
    select 'company', co.id, co.company_name, coalesce(initcap(replace(co.industry_sector::text, '_', ' ')), 'Company'), co.city_town, co.region,
      null, null, null, co.verification_status::text = 'verified', co.badge_tier, co.company_overview, co.company_logo_url, true, co.created_at,
      lower(concat_ws(' ', co.industry_sector::text, co.company_overview, co.company_name))
    from company_profiles co
    where p_kind = 'company' and coalesce(co.account_status, 'active') = 'active' and co.verification_status::text <> 'rejected'
    union all
    select 'supplier', b.id, b.business_name, coalesce(b.specialty, 'Supplier'), b.city_town, b.region,
      null, b.years_in_operation, b.years_in_operation::text, b.verification_status::text = 'verified', b.badge_tier, b.short_bio, b.logo_url,
      coalesce(b.accepting_orders, true), b.created_at,
      lower(concat_ws(' ', b.specialty, b.short_bio, b.business_name, array_to_string(b.equipment_owned, ' ')))
    from business_profiles b
    where p_kind = 'supplier' and coalesce(b.account_status, 'active') = 'active' and b.verification_status::text <> 'rejected'
  ),
  scored as (
    select c.*, pl.tier plan, (bo.id is not null) boosted, ra.avg rating, coalesce(ra.n, 0) reviews,
      (select count(*) from unnest(words) w where c.hay like '%' || w || '%') hits
    from cand c left join plan pl on pl.id = c.id left join boost bo on bo.id = c.id left join rating ra on ra.uid = c.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind, 'id', id, 'name', name, 'trade', trade, 'town', town, 'region', region, 'rate', rate,
      'experience', years_label, 'verified', verified, 'badge', case when verified then coalesce(badge_tier, 'verified') end,
      'plan', plan, 'featured', boosted, 'rating', rating, 'reviews', reviews, 'available', available,
      'about', left(bio, 160), 'photo', photo) order by ord), '[]'::jsonb)
  into out
  from (
    select s.*, row_number() over (order by
        s.hits desc, s.boosted desc,
        case s.plan when 'enterprise' then 3 when 'premium' then 2 when 'pro' then 1 else 0 end desc,
        s.verified desc, coalesce(s.rating, 0) desc, s.reviews desc, coalesce(s.years, -1) desc,
        (s.rate is not null) desc, s.created_at) ord
    from scored s
    where (cardinality(words) = 0 or s.hits > 0)
      and (place is null or lower(concat_ws(' ', s.town, s.region)) like '%' || place || '%'
           or place like '%' || lower(coalesce(s.town, '~')) || '%' or place like '%' || lower(coalesce(s.region, '~')) || '%')
      and (p_min_years is null or coalesce(s.years, 0) >= p_min_years)
      and (p_max_rate is null or s.rate is null or s.rate <= p_max_rate)
      and (not coalesce(p_verified_only, false) or s.verified)
      and s.available
    order by ord limit lim) t;
  return out;
end $$;

create or replace function public.bot_find_jobs(p_query text default null, p_region text default null, p_limit int default 5)
returns jsonb language sql stable security definer set search_path = public as $$
  with promo as (select public.promoted() p),
  boost as (select (b->>'id')::uuid id from promo, jsonb_array_elements(p->'boosts') b where b->>'type' = 'job'),
  words as (select array(select w from unnest(regexp_split_to_array(lower(coalesce(p_query, '')), '[^a-z0-9]+')) w
              where length(w) > 2 and w not in ('the','and','for','job','jobs','work','need','want','find','any','near','looking')) ws),
  cand as (
    select j.id, j.title, coalesce(c.name, 'General') trade, j.city_town town, j.region, j.daily_rate_ghs rate, j.workers_needed,
      j.starts_on, j.created_at, (bo.id is not null) featured, left(j.description, 160) about,
      coalesce(co.company_name, 'A client') posted_by,
      (select count(*) from words, unnest(ws) w where lower(concat_ws(' ', j.title, j.description, c.name)) like '%' || w || '%') hits,
      (select cardinality(ws) from words) nwords
    from jobs j left join job_categories c on c.id = j.job_category_id left join company_profiles co on co.id = j.company_id
      left join boost bo on bo.id = j.id
    where j.status = 'open'
      and (nullif(trim(coalesce(p_region, '')), '') is null or lower(concat_ws(' ', j.city_town, j.region)) like '%' || lower(trim(p_region)) || '%'))
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'job', 'id', id, 'title', title, 'trade', trade, 'town', town, 'region', region,
      'rate', rate, 'workers_needed', workers_needed, 'starts_on', starts_on, 'featured', featured, 'about', about, 'posted_by', posted_by)
      order by featured desc, hits desc, created_at desc), '[]'::jsonb)
  from (select * from cand where nwords = 0 or hits > 0 order by featured desc, hits desc, created_at desc
        limit least(greatest(coalesce(p_limit, 5), 1), 8)) t;
$$;

revoke all on function public._bot_years(text) from public, anon, authenticated;
revoke all on function public.bot_find_people(text, text, text, int, numeric, boolean, int) from public, anon, authenticated;
revoke all on function public.bot_find_jobs(text, text, int) from public, anon, authenticated;
grant execute on function public.bot_find_people(text, text, text, int, numeric, boolean, int) to service_role;
grant execute on function public.bot_find_jobs(text, text, int) to service_role;

-- The Anthropic key lives in Vault (vault.create_secret(<key>, 'anthropic_api_key')); never in this file.
create or replace function public._bot_ai_key() returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_api_key' limit 1
$$;
revoke all on function public._bot_ai_key() from public, anon, authenticated;
grant execute on function public._bot_ai_key() to service_role;
