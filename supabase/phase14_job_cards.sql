-- BAID X · Phase 14: Digital Job Card. Applied to project igfmmprlrybxsdzehwid.
-- Every hired job (job_engagements) gets a card: scope items, materials, photo evidence and sign-off.
-- Parties are the worker, the client (payer) and, when the job belongs to a project with a PM, that PM.
-- Tables are read-only to clients; every change goes through a job_card_* function. Nothing is ever deleted:
-- removing an item, material or photo sets removed_at, so the card stays a complete record.
-- Sign-off drives the escrow: the worker's sign-off submits the work (3-day auto-release starts as before),
-- and the money is released once the worker, the client and the PM (if any) have all signed.

create sequence if not exists public.job_card_no_seq start 10001;
alter table public.job_engagements add column if not exists card_no bigint unique default nextval('public.job_card_no_seq');

create table if not exists public.job_card_items (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.job_engagements(id) on delete cascade,
  title text not null check (length(title) between 2 and 120),
  qty_total int not null default 1 check (qty_total between 1 and 100000),
  qty_done int not null default 0 check (qty_done >= 0),
  position int not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), removed_at timestamptz,
  check (qty_done <= qty_total));
create index if not exists job_card_items_eng_idx on public.job_card_items (engagement_id, position, created_at);

create table if not exists public.job_card_materials (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.job_engagements(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  unit text not null default '' check (length(unit) <= 12),
  qty_required numeric not null check (qty_required > 0 and qty_required <= 10000000),
  qty_used numeric not null default 0 check (qty_used >= 0 and qty_used <= 10000000),
  created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), removed_at timestamptz);
create index if not exists job_card_materials_eng_idx on public.job_card_materials (engagement_id, created_at);

create table if not exists public.job_card_photos (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.job_engagements(id) on delete cascade,
  stage text not null check (stage in ('before','during','after')),
  storage_path text not null unique,
  uploaded_by uuid not null,
  taken_at timestamptz not null default now(), removed_at timestamptz);
create index if not exists job_card_photos_eng_idx on public.job_card_photos (engagement_id, taken_at);

create table if not exists public.job_card_signoffs (
  engagement_id uuid not null references public.job_engagements(id) on delete cascade,
  party text not null check (party in ('worker','client','pm')),
  signed_by uuid not null,
  note text,
  signed_at timestamptz not null default now(),
  primary key (engagement_id, party));

-- Who the caller is on this card: 'worker', 'client', 'pm' or null.
create or replace function public.job_card_party(p_eng uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when e.worker_id = auth.uid() then 'worker' when e.payer_id = auth.uid() then 'client'
              when p.pm_id is not null and p.pm_id = auth.uid() then 'pm' end
  from job_engagements e join jobs j on j.id = e.job_id left join projects p on p.id = j.project_id
  where e.id = p_eng $$;

-- Same, from a storage path whose first folder is the engagement id (bad paths read as no access).
create or replace function public.job_card_party_path(p_name text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return public.job_card_party((storage.foldername(p_name))[1]::uuid);
exception when others then return null;
end $$;

create or replace function public._job_card_needs_pm(p_eng uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p.pm_id is not null, false) from job_engagements e join jobs j on j.id = e.job_id left join projects p on p.id = j.project_id where e.id = p_eng $$;

alter table public.job_card_items enable row level security;
alter table public.job_card_materials enable row level security;
alter table public.job_card_photos enable row level security;
alter table public.job_card_signoffs enable row level security;
create policy job_card_items_select on public.job_card_items for select to authenticated using (public.job_card_party(engagement_id) is not null or public.is_active_admin());
create policy job_card_materials_select on public.job_card_materials for select to authenticated using (public.job_card_party(engagement_id) is not null or public.is_active_admin());
create policy job_card_photos_select on public.job_card_photos for select to authenticated using (public.job_card_party(engagement_id) is not null or public.is_active_admin());
create policy job_card_signoffs_select on public.job_card_signoffs for select to authenticated using (public.job_card_party(engagement_id) is not null or public.is_active_admin());
revoke insert, update, delete on public.job_card_items, public.job_card_materials, public.job_card_photos, public.job_card_signoffs from anon, authenticated;

-- Private photo bucket: <engagement id>/<uploader id>/<file>. Parties read; each party uploads into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-cards', 'job-cards', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;
create policy job_cards_read on storage.objects for select to authenticated using (bucket_id = 'job-cards' and (public.job_card_party_path(name) is not null or public.is_active_admin()));
create policy job_cards_upload on storage.objects for insert to authenticated with check (bucket_id = 'job-cards' and public.job_card_party_path(name) is not null and (storage.foldername(name))[2] = auth.uid()::text);
create policy job_cards_delete on storage.objects for delete to authenticated using (bucket_id = 'job-cards' and (storage.foldername(name))[2] = auth.uid()::text);
-- Photos are evidence: a restrictive policy keeps any job-card file from being deleted by users (overrides the policy above).
create policy job_cards_keep on storage.objects as restrictive for delete to authenticated using (bucket_id <> 'job-cards');

-- Caller must be a party, the job must still be running, and (for edits) the worker must not have signed yet.
create or replace function public._job_card_guard(p_eng uuid, p_edit boolean default true) returns text
language plpgsql stable security definer set search_path = public as $$
declare me text := public.job_card_party(p_eng); st text;
begin
  if auth.uid() is null or me is null then raise exception 'not your job card'; end if;
  select status into st from job_engagements where id = p_eng;
  if st not in ('active','submitted') then raise exception 'this job is %', st; end if;
  if p_edit and exists (select 1 from job_card_signoffs where engagement_id = p_eng and party = 'worker') then raise exception 'the worker has signed off, so the card is locked'; end if;
  return me;
end $$;

-- The whole card in one read.
create or replace function public.job_card(p_eng uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text := public.job_card_party(p_eng); e job_engagements; j jobs; p projects; h escrow_holds; r jsonb; prog int; locked boolean;
begin
  if me is null and not public.is_active_admin() then raise exception 'not your job card'; end if;
  select * into e from job_engagements where id = p_eng;
  select * into j from jobs where id = e.job_id;
  select * into p from projects where id = j.project_id;
  select * into h from escrow_holds where id = e.escrow_id;
  select case when e.status = 'released' then 100 else coalesce(round(avg(qty_done::numeric / qty_total) * 100)::int, 0) end into prog from job_card_items where engagement_id = p_eng and removed_at is null;
  locked := e.status not in ('active','submitted') or exists (select 1 from job_card_signoffs where engagement_id = p_eng and party = 'worker');
  r := jsonb_build_object(
    'id', e.id, 'card_no', e.card_no, 'public_id', e.public_id, 'title', j.title, 'status', e.status, 'my_party', me,
    'needs_pm', p.pm_id is not null, 'project', p.name,
    'worker_name', (select full_name from worker_profiles where id = e.worker_id),
    'client_name', coalesce((select company_name from company_profiles where id = e.payer_id), (select full_name from individual_employer_profiles where id = e.payer_id), 'Client'),
    'pm_name', (select full_name from project_manager_profiles where id = p.pm_id),
    'location', nullif(concat_ws(', ', j.city_town, j.region), ''),
    'amount', e.amount_ghs, 'rate', e.rate_ghs, 'days', e.days,
    'paid', case when e.status = 'released' then e.amount_ghs else 0 end,
    'held', case when e.status in ('active','submitted','disputed') then e.amount_ghs else 0 end,
    'commission', h.commission_ghs, 'net', h.net_ghs,
    'started_at', e.started_at, 'submitted_at', e.submitted_at, 'auto_release_at', e.auto_release_at, 'released_at', e.released_at,
    'submit_note', e.submit_note, 'dispute_reason', e.dispute_reason, 'resolution_note', e.resolution_note,
    'progress', prog, 'locked', locked,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'total', qty_total, 'done', qty_done, 'mine', created_by = auth.uid()) order by position, created_at) from job_card_items where engagement_id = p_eng and removed_at is null), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit, 'required', qty_required, 'used', qty_used, 'mine', created_by = auth.uid()) order by created_at) from job_card_materials where engagement_id = p_eng and removed_at is null), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'stage', stage, 'path', storage_path, 'taken_at', taken_at, 'mine', uploaded_by = auth.uid()) order by taken_at) from job_card_photos where engagement_id = p_eng and removed_at is null), '[]'::jsonb),
    'signoffs', coalesce((select jsonb_agg(jsonb_build_object('party', party, 'signed_at', signed_at, 'note', note)) from job_card_signoffs where engagement_id = p_eng), '[]'::jsonb));
  return r;
end $$;

-- Cards the caller is part of (worker, client or PM), newest first, with progress.
create or replace function public.my_job_cards() returns table(id uuid, card_no bigint, title text, status text, party text, project_id uuid, counterpart text, amount_ghs numeric, progress int)
language sql stable security definer set search_path = public as $$
  select e.id, e.card_no, j.title, e.status, public.job_card_party(e.id), j.project_id, w.full_name, e.amount_ghs,
    case when e.status = 'released' then 100 else coalesce((select round(avg(i.qty_done::numeric / i.qty_total) * 100)::int from job_card_items i where i.engagement_id = e.id and i.removed_at is null), 0) end
  from job_engagements e join jobs j on j.id = e.job_id join worker_profiles w on w.id = e.worker_id left join projects p on p.id = j.project_id
  where e.worker_id = auth.uid() or e.payer_id = auth.uid() or (p.pm_id is not null and p.pm_id = auth.uid())
  order by e.created_at desc limit 100 $$;

create or replace function public.job_card_item_add(p_eng uuid, p_title text, p_qty int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare iid uuid;
begin
  perform public._job_card_guard(p_eng);
  if coalesce(length(trim(p_title)), 0) < 2 then raise exception 'describe the scope item'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'enter a quantity of 1 or more'; end if;
  if (select count(*) from job_card_items where engagement_id = p_eng and removed_at is null) >= 60 then raise exception 'a card can hold up to 60 scope items'; end if;
  insert into job_card_items(engagement_id, title, qty_total, position, created_by)
    values (p_eng, left(trim(p_title), 120), p_qty, coalesce((select max(position) + 1 from job_card_items where engagement_id = p_eng), 0), auth.uid()) returning id into iid;
  return jsonb_build_object('id', iid);
end $$;

-- The worker or PM records how much of an item is done.
create or replace function public.job_card_item_progress(p_id uuid, p_done int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it job_card_items; me text;
begin
  select * into it from job_card_items where id = p_id and removed_at is null for update;
  if not found then raise exception 'scope item not found'; end if;
  me := public._job_card_guard(it.engagement_id);
  if me not in ('worker','pm') then raise exception 'only the worker or the PM can record progress'; end if;
  if p_done is null or p_done < 0 or p_done > it.qty_total then raise exception 'enter a number from 0 to %', it.qty_total; end if;
  update job_card_items set qty_done = p_done, updated_at = now() where id = p_id;
  return jsonb_build_object('done', p_done);
end $$;

create or replace function public.job_card_item_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it job_card_items; me text;
begin
  select * into it from job_card_items where id = p_id and removed_at is null for update;
  if not found then raise exception 'scope item not found'; end if;
  me := public._job_card_guard(it.engagement_id);
  if it.created_by <> auth.uid() and me not in ('client','pm') then raise exception 'only whoever added it, the client or the PM can remove this'; end if;
  update job_card_items set removed_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('removed', true);
end $$;

create or replace function public.job_card_material_add(p_eng uuid, p_name text, p_unit text, p_required numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  perform public._job_card_guard(p_eng);
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'name the material'; end if;
  if p_required is null or p_required <= 0 or p_required > 10000000 then raise exception 'enter the quantity required'; end if;
  if (select count(*) from job_card_materials where engagement_id = p_eng and removed_at is null) >= 60 then raise exception 'a card can hold up to 60 materials'; end if;
  insert into job_card_materials(engagement_id, name, unit, qty_required, created_by)
    values (p_eng, left(trim(p_name), 80), left(coalesce(trim(p_unit), ''), 12), round(p_required, 2), auth.uid()) returning id into mid;
  return jsonb_build_object('id', mid);
end $$;

-- The worker or PM logs how much was used.
create or replace function public.job_card_material_used(p_id uuid, p_used numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m job_card_materials; me text;
begin
  select * into m from job_card_materials where id = p_id and removed_at is null for update;
  if not found then raise exception 'material not found'; end if;
  me := public._job_card_guard(m.engagement_id);
  if me not in ('worker','pm') then raise exception 'only the worker or the PM can log materials used'; end if;
  if p_used is null or p_used < 0 or p_used > 10000000 then raise exception 'enter the amount used'; end if;
  update job_card_materials set qty_used = round(p_used, 2), updated_at = now() where id = p_id;
  return jsonb_build_object('used', round(p_used, 2));
end $$;

create or replace function public.job_card_material_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m job_card_materials; me text;
begin
  select * into m from job_card_materials where id = p_id and removed_at is null for update;
  if not found then raise exception 'material not found'; end if;
  me := public._job_card_guard(m.engagement_id);
  if m.created_by <> auth.uid() and me not in ('client','pm') then raise exception 'only whoever added it, the client or the PM can remove this'; end if;
  update job_card_materials set removed_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('removed', true);
end $$;

-- Records a photo the caller has uploaded to job-cards/<engagement>/<caller>/...; the time is set here, not by the phone.
create or replace function public.job_card_photo_add(p_eng uuid, p_stage text, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform public._job_card_guard(p_eng, false);
  if p_stage not in ('before','during','after') then raise exception 'choose before, during or after'; end if;
  if p_path is null or (storage.foldername(p_path))[1] <> p_eng::text or (storage.foldername(p_path))[2] <> auth.uid()::text then raise exception 'upload the photo first'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'job-cards' and name = p_path) then raise exception 'upload the photo first'; end if;
  if (select count(*) from job_card_photos where engagement_id = p_eng and removed_at is null) >= 90 then raise exception 'a card can hold up to 90 photos'; end if;
  insert into job_card_photos(engagement_id, stage, storage_path, uploaded_by) values (p_eng, p_stage, p_path, auth.uid()) returning id into pid;
  return jsonb_build_object('id', pid);
end $$;

-- The uploader removes their photo from the card (the file is kept as evidence).
create or replace function public.job_card_photo_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ph job_card_photos;
begin
  select * into ph from job_card_photos where id = p_id and removed_at is null for update;
  if not found then raise exception 'photo not found'; end if;
  perform public._job_card_guard(ph.engagement_id, false);
  if ph.uploaded_by <> auth.uid() then raise exception 'only whoever took the photo can remove it'; end if;
  update job_card_photos set removed_at = now() where id = p_id;
  return jsonb_build_object('removed', true);
end $$;

-- Sign-off. The worker's sign-off submits the work; once every required party has signed, the escrow is released.
create or replace function public.job_card_sign(p_eng uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; g job_engagements; t text; need_pm boolean; r jsonb; pm uuid;
begin
  me := public._job_card_guard(p_eng, false);
  select * into g from job_engagements where id = p_eng for update;
  if exists (select 1 from job_card_signoffs where engagement_id = p_eng and party = me) then raise exception 'you have already signed off'; end if;
  insert into job_card_signoffs(engagement_id, party, signed_by, note) values (p_eng, me, auth.uid(), left(nullif(trim(p_note), ''), 1000));
  select j.title, p.pm_id into t, pm from jobs j left join projects p on p.id = j.project_id where j.id = g.job_id;
  need_pm := pm is not null;
  if me = 'worker' and g.status = 'active' then
    update job_engagements set status = 'submitted', submitted_at = now(), submit_note = left(nullif(trim(p_note), ''), 1000),
      auto_release_at = now() + interval '3 days', updated_at = now() where id = p_eng;
    perform notify_user(g.payer_id, 'work_submitted', 'Work signed off', 'The worker signed off "' || coalesce(t, 'your job') || '". Check the job card and sign off within 3 days or payment releases automatically.', '#/engagement/' || p_eng, '{}'::jsonb);
    if need_pm then perform notify_user(pm, 'work_submitted', 'Job card ready for sign-off', 'The worker signed off "' || coalesce(t, 'a job') || '". Check the job card and sign off.', '#/engagement/' || p_eng, '{}'::jsonb); end if;
  end if;
  if exists (select 1 from job_card_signoffs where engagement_id = p_eng and party = 'worker')
     and exists (select 1 from job_card_signoffs where engagement_id = p_eng and party = 'client')
     and (not need_pm or exists (select 1 from job_card_signoffs where engagement_id = p_eng and party = 'pm')) then
    r := public._escrow_release(g.escrow_id);
    update job_engagements set status = 'released', released_at = now(), updated_at = now() where id = p_eng;
    perform notify_user(g.worker_id, 'payment_released', 'Payment released', 'Everyone signed off "' || coalesce(t, 'your job') || '". GHS ' || (r->>'net') || ' is now in your wallet.', '#/wallet', r);
    if me <> 'client' then perform notify_user(g.payer_id, 'payment_released', 'Job complete', 'Everyone signed off "' || coalesce(t, 'your job') || '" and the payment was released.', '#/engagement/' || p_eng, '{}'::jsonb); end if;
    return jsonb_build_object('signed', me, 'released', true) || r;
  end if;
  return jsonb_build_object('signed', me, 'released', false);
end $$;

revoke all on function public._job_card_guard(uuid, boolean), public._job_card_needs_pm(uuid) from public, anon, authenticated;
revoke all on function public.job_card(uuid), public.my_job_cards(), public.job_card_item_add(uuid, text, int), public.job_card_item_progress(uuid, int), public.job_card_item_remove(uuid),
  public.job_card_material_add(uuid, text, text, numeric), public.job_card_material_used(uuid, numeric), public.job_card_material_remove(uuid),
  public.job_card_photo_add(uuid, text, text), public.job_card_photo_remove(uuid), public.job_card_sign(uuid, text), public.job_card_party(uuid), public.job_card_party_path(text) from public, anon;
grant execute on function public.job_card(uuid), public.my_job_cards(), public.job_card_item_add(uuid, text, int), public.job_card_item_progress(uuid, int), public.job_card_item_remove(uuid),
  public.job_card_material_add(uuid, text, text, numeric), public.job_card_material_used(uuid, numeric), public.job_card_material_remove(uuid),
  public.job_card_photo_add(uuid, text, text), public.job_card_photo_remove(uuid), public.job_card_sign(uuid, text), public.job_card_party(uuid), public.job_card_party_path(text) to authenticated;
