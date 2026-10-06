-- BAID X · Phase 15: My build, the homeowner's view of their build. Applied to project igfmmprlrybxsdzehwid.
-- A client (individual employer) sets a name, location, budget and finish date; everything else comes from
-- their job cards: money paid and held in escrow, progress, site photos, and cards waiting for their sign-off.
-- The table is read-only to clients; build_save writes it.

create table if not exists public.client_builds (
  owner_id uuid primary key,
  name text not null check (length(name) between 2 and 80),
  location text check (location is null or length(location) <= 120),
  budget_ghs numeric check (budget_ghs is null or (budget_ghs > 0 and budget_ghs <= 100000000)),
  due_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.client_builds enable row level security;
create policy client_builds_select on public.client_builds for select to authenticated using (owner_id = auth.uid() or public.is_active_admin());
revoke insert, update, delete on public.client_builds from anon, authenticated;

create or replace function public.build_save(p_name text, p_location text default null, p_budget numeric default null, p_due date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from individual_employer_profiles where id = auth.uid()) then raise exception 'my build is for client accounts'; end if;
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'give your build a name'; end if;
  if p_budget is not null and (p_budget <= 0 or p_budget > 100000000) then raise exception 'enter a budget in cedis'; end if;
  insert into client_builds(owner_id, name, location, budget_ghs, due_on)
    values (auth.uid(), left(trim(p_name), 80), left(nullif(trim(p_location), ''), 120), round(p_budget, 2), p_due)
    on conflict (owner_id) do update set name = excluded.name, location = excluded.location, budget_ghs = excluded.budget_ghs, due_on = excluded.due_on, updated_at = now();
  return jsonb_build_object('saved', true);
end $$;

-- The whole build in one read. Progress is each live or finished job's card progress, weighted by its amount.
create or replace function public.my_build() returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select g.id, g.card_no, g.status, g.amount_ghs, j.title, w.full_name as worker,
      case when g.status = 'released' then 100 else coalesce((select round(avg(i.qty_done::numeric / i.qty_total) * 100)::int from job_card_items i where i.engagement_id = g.id and i.removed_at is null), 0) end as progress,
      exists (select 1 from job_card_signoffs s where s.engagement_id = g.id and s.party = 'worker') as worker_signed,
      exists (select 1 from job_card_signoffs s where s.engagement_id = g.id and s.party = 'client') as client_signed,
      g.created_at
    from job_engagements g join jobs j on j.id = g.job_id join worker_profiles w on w.id = g.worker_id
    where g.payer_id = auth.uid() and g.payer_role = 'individual_employer'),
  live as (select * from e where status in ('active','submitted','disputed','released'))
  select jsonb_build_object(
    'build', (select to_jsonb(b) - 'owner_id' from client_builds b where b.owner_id = auth.uid()),
    'paid', coalesce((select sum(amount_ghs) from e where status = 'released'), 0),
    'held', coalesce((select sum(amount_ghs) from e where status in ('active','submitted','disputed')), 0),
    'progress', coalesce((select round(sum(progress * amount_ghs) / nullif(sum(amount_ghs), 0))::int from live), 0),
    'jobs_total', (select count(*) from live),
    'jobs_done', (select count(*) from e where status = 'released'),
    'disputes', (select count(*) from e where status = 'disputed'),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'card_no', card_no, 'title', title, 'worker', worker, 'amount', amount_ghs) order by created_at)
                         from e where status in ('active','submitted') and worker_signed and not client_signed), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'card_no', card_no, 'title', title, 'worker', worker, 'status', status, 'progress', progress, 'amount', amount_ghs) order by created_at desc) from e), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(x order by x->>'taken_at' desc) from (
                         select jsonb_build_object('path', p.storage_path, 'taken_at', p.taken_at, 'stage', p.stage, 'title', e.title, 'engagement_id', e.id) as x
                         from job_card_photos p join e on e.id = p.engagement_id where p.removed_at is null order by p.taken_at desc limit 9) t), '[]'::jsonb))
$$;

revoke all on function public.build_save(text, text, numeric, date), public.my_build() from public, anon;
grant execute on function public.build_save(text, text, numeric, date), public.my_build() to authenticated;
