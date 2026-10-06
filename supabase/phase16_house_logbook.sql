-- BAID X · Phase 16: House logbook for clients. Applied to project igfmmprlrybxsdzehwid.
-- Who did what comes from the client's completed job cards; the trusted team is everyone they paid through
-- escrow; maintenance reminders are the client's own, optionally linked to someone on that team, and a
-- daily job notifies the client when one is due. Nothing is deleted: removing a reminder sets removed_at.

create table if not exists public.house_reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null check (length(title) between 2 and 100),
  due_on date not null,
  repeat_months int check (repeat_months is null or repeat_months between 1 and 60),
  worker_id uuid references public.worker_profiles(id) on delete set null,
  note text check (note is null or length(note) <= 500),
  last_done_on date, notified_on date, removed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists house_reminders_owner_idx on public.house_reminders (owner_id, due_on) where removed_at is null;
alter table public.house_reminders enable row level security;
create policy house_reminders_select on public.house_reminders for select to authenticated using (owner_id = auth.uid() or public.is_active_admin());
revoke insert, update, delete on public.house_reminders from anon, authenticated;

-- Workers the caller has paid through escrow (the trusted team).
create or replace function public._house_team_ok(p_worker uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_engagements where payer_id = auth.uid() and payer_role = 'individual_employer' and worker_id = p_worker and status = 'released') $$;

create or replace function public.house_reminder_save(p_id uuid, p_title text, p_due date, p_repeat_months int default null, p_worker uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from individual_employer_profiles where id = auth.uid()) then raise exception 'the house logbook is for client accounts'; end if;
  if coalesce(length(trim(p_title)), 0) < 2 then raise exception 'say what needs doing'; end if;
  if p_due is null then raise exception 'choose when it is due'; end if;
  if p_repeat_months is not null and (p_repeat_months < 1 or p_repeat_months > 60) then raise exception 'repeat every 1 to 60 months'; end if;
  if p_worker is not null and not public._house_team_ok(p_worker) then raise exception 'choose someone from your trusted team'; end if;
  if p_id is null then
    if (select count(*) from house_reminders where owner_id = auth.uid() and removed_at is null) >= 50 then raise exception 'you can keep up to 50 reminders'; end if;
    insert into house_reminders(owner_id, title, due_on, repeat_months, worker_id, note)
      values (auth.uid(), left(trim(p_title), 100), p_due, p_repeat_months, p_worker, left(nullif(trim(p_note), ''), 500)) returning id into rid;
  else
    update house_reminders set title = left(trim(p_title), 100), due_on = p_due, repeat_months = p_repeat_months, worker_id = p_worker,
      note = left(nullif(trim(p_note), ''), 500), notified_on = null, updated_at = now()
      where id = p_id and owner_id = auth.uid() and removed_at is null returning id into rid;
    if rid is null then raise exception 'reminder not found'; end if;
  end if;
  return jsonb_build_object('id', rid);
end $$;

-- Done: a repeating reminder moves to its next date, a one-off one is put away.
create or replace function public.house_reminder_done(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r house_reminders; nxt date;
begin
  select * into r from house_reminders where id = p_id and owner_id = auth.uid() and removed_at is null for update;
  if not found then raise exception 'reminder not found'; end if;
  if r.repeat_months is null then
    update house_reminders set last_done_on = current_date, removed_at = now(), updated_at = now() where id = p_id;
    return jsonb_build_object('next', null);
  end if;
  nxt := (greatest(r.due_on, current_date) + make_interval(months => r.repeat_months))::date;
  update house_reminders set last_done_on = current_date, due_on = nxt, notified_on = null, updated_at = now() where id = p_id;
  return jsonb_build_object('next', nxt);
end $$;

create or replace function public.house_reminder_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update house_reminders set removed_at = now(), updated_at = now() where id = p_id and owner_id = auth.uid() and removed_at is null;
  if not found then raise exception 'reminder not found'; end if;
  return jsonb_build_object('removed', true);
end $$;

-- The whole logbook in one read.
create or replace function public.my_house() returns jsonb
language sql stable security definer set search_path = public as $$
  with done as (
    select g.id, g.card_no, j.title, g.worker_id, w.full_name as worker, w.profile_photo_url as photo, jc.name as trade, g.released_at, g.amount_ghs
    from job_engagements g join jobs j on j.id = g.job_id join worker_profiles w on w.id = g.worker_id left join job_categories jc on jc.id = w.primary_job_category_id
    where g.payer_id = auth.uid() and g.payer_role = 'individual_employer' and g.status = 'released')
  select jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'card_no', card_no, 'title', title, 'worker', worker, 'trade', trade, 'done_on', released_at) order by released_at desc) from done), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'due_on', r.due_on, 'repeat_months', r.repeat_months, 'note', r.note,
                            'worker_id', r.worker_id, 'worker', w.full_name, 'last_done_on', r.last_done_on, 'days', r.due_on - current_date) order by r.due_on)
                           from house_reminders r left join worker_profiles w on w.id = r.worker_id where r.owner_id = auth.uid() and r.removed_at is null), '[]'::jsonb),
    'team', coalesce((select jsonb_agg(t order by t->>'last_on' desc) from (
                       select jsonb_build_object('worker_id', d.worker_id, 'name', max(d.worker), 'photo', max(d.photo), 'trade', max(d.trade), 'jobs', count(*), 'last_on', max(d.released_at),
                         'rating', (select round(avg(rv.rating), 1) from job_reviews rv where rv.employer_id = auth.uid() and rv.worker_id = d.worker_id)) as t
                       from done d group by d.worker_id) x), '[]'::jsonb))
$$;

-- Daily: tell clients about reminders that are due (once per due date).
create or replace function public.house_reminders_notify() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select h.*, w.full_name as worker from house_reminders h left join worker_profiles w on w.id = h.worker_id
           where h.removed_at is null and h.due_on <= current_date and (h.notified_on is null or h.notified_on < h.due_on) limit 500 loop
    perform notify_user(r.owner_id, 'house_reminder', 'Due: ' || r.title,
      case when r.worker is not null then 'Your reminder is due. Message ' || r.worker || ' from your house logbook to book it.' else 'Your reminder is due. Open your house logbook to mark it done or find someone.' end,
      '#/house', jsonb_build_object('reminder', r.id));
    update house_reminders set notified_on = current_date where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public._house_team_ok(uuid), public.house_reminders_notify() from public, anon, authenticated;
revoke all on function public.house_reminder_save(uuid, text, date, int, uuid, text), public.house_reminder_done(uuid), public.house_reminder_remove(uuid), public.my_house() from public, anon;
grant execute on function public.house_reminder_save(uuid, text, date, int, uuid, text), public.house_reminder_done(uuid), public.house_reminder_remove(uuid), public.my_house() to authenticated;

select cron.schedule('house-reminders', '7 7 * * *', $$select public.house_reminders_notify()$$);
