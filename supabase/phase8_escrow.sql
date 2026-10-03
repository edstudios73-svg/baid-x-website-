-- BAID X · Phase 8: hire -> escrow -> release for jobs. Applied to project igfmmprlrybxsdzehwid.
-- Money path: payer wallet -> escrow_holds (locked) -> receiver wallet (minus platform commission). Every change is an RPC; tables are read-only to clients.

alter table public.escrow_holds drop constraint escrow_holds_payer_role_check;
alter table public.escrow_holds add constraint escrow_holds_payer_role_check check (payer_role = any (array['worker','company','project_manager','business','individual_employer']));

create table if not exists public.job_engagements (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  job_id uuid not null references public.jobs(id) on delete cascade,
  application_id uuid unique references public.job_applications(id) on delete set null,
  worker_id uuid not null references public.worker_profiles(id) on delete cascade,
  payer_id uuid not null, payer_role text not null check (payer_role in ('company','individual_employer')),
  escrow_id uuid references public.escrow_holds(id) on delete set null,
  days int not null check (days between 1 and 365), rate_ghs numeric not null check (rate_ghs > 0), amount_ghs numeric not null check (amount_ghs > 0),
  status text not null default 'active' check (status in ('active','submitted','released','disputed','cancelled','refunded')),
  started_at timestamptz, submitted_at timestamptz, submit_note text, auto_release_at timestamptz, released_at timestamptz,
  dispute_reason text, dispute_details text, disputed_at timestamptz, resolution_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists job_engagements_worker_idx on public.job_engagements (worker_id, created_at desc);
create index if not exists job_engagements_payer_idx on public.job_engagements (payer_id, created_at desc);
create index if not exists job_engagements_due_idx on public.job_engagements (status, auto_release_at);
alter table public.job_engagements enable row level security;
create policy job_engagements_party_select on public.job_engagements for select to authenticated using (auth.uid() = payer_id or auth.uid() = worker_id or public.is_active_admin());
revoke insert, update, delete on public.job_engagements from anon, authenticated;

-- ---- internals (already applied): _escrow_release(p_id) / _escrow_refund(p_id) credit the receiver (minus commission) or the payer. See DB for bodies.

-- Split a locked/disputed escrow: p_release goes to the receiver (minus commission), the rest returns to the payer.
create or replace function public._escrow_split(p_id uuid, p_release numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e escrow_holds; rest numeric; res jsonb;
begin
  select * into e from escrow_holds where id = p_id for update;
  if not found or e.status not in ('locked','disputed') then raise exception 'this escrow is already settled'; end if;
  if p_release <= 0 then return public._escrow_refund(p_id); end if;
  if p_release >= e.amount_ghs then return public._escrow_release(p_id); end if;
  rest := e.amount_ghs - p_release;
  insert into wallet_accounts(owner_role, owner_id, available_ghs) values (e.payer_role, e.payer_id, rest)
    on conflict (owner_role, owner_id) do update set available_ghs = wallet_accounts.available_ghs + rest,
      lifetime_spent_ghs = greatest(wallet_accounts.lifetime_spent_ghs - rest, 0), updated_at = now();
  insert into wallet_transactions(public_id, owner_role, owner_id, type, amount_ghs, net_ghs, status, description, escrow_id, idempotency_key)
    values ('BXD-TX-' || upper(substr(md5(random()::text || e.id::text), 1, 8)), e.payer_role, e.payer_id, 'escrow_refund', rest, rest, 'completed',
      'Partial refund ' || coalesce(e.public_id, ''), e.id, 'escrow-refund:' || e.id::text);
  update escrow_holds set amount_ghs = p_release, updated_at = now() where id = p_id;
  res := public._escrow_release(p_id);
  return res || jsonb_build_object('refunded', rest);
end $$;

-- Hire: the job owner picks an applicant; funds move wallet -> escrow in one transaction.
create or replace function public.hire_worker(p_application uuid, p_days int, p_rate numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a job_applications; j jobs; prole text; rate numeric; amt numeric; bal numeric;
  esc uuid; tx uuid; eng uuid; pid text; accepted int;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into a from job_applications where id = p_application for update;
  if not found then raise exception 'application not found'; end if;
  select * into j from jobs where id = a.job_id for update;
  if j.company_id = me then prole := 'company'; elsif j.employer_id = me then prole := 'individual_employer';
  else raise exception 'only the job owner can hire'; end if;
  if j.status <> 'open' then raise exception 'this job is not open'; end if;
  if a.status not in ('submitted','shortlisted') then raise exception 'this application can no longer be hired'; end if;
  if exists (select 1 from job_engagements where application_id = a.id) then raise exception 'already hired'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'days must be between 1 and 365'; end if;
  rate := coalesce(p_rate, a.proposed_rate_ghs, j.daily_rate_ghs);
  if rate is null or rate <= 0 then raise exception 'set a daily rate'; end if;
  amt := round(rate * p_days, 2);
  select available_ghs into bal from wallet_accounts where owner_role = prole and owner_id = me for update;
  if coalesce(bal, 0) < amt then raise exception 'insufficient_funds:%', round(amt - coalesce(bal, 0), 2); end if;
  update wallet_accounts set available_ghs = available_ghs - amt, lifetime_spent_ghs = lifetime_spent_ghs + amt, updated_at = now()
    where owner_role = prole and owner_id = me;
  pid := 'BXD-ESC-' || upper(substr(md5(random()::text || a.id::text), 1, 8));
  insert into escrow_holds(public_id, payer_role, payer_id, receiver_role, receiver_id, context_type, context_id, amount_ghs, status, description, idempotency_key)
    values (pid, prole, me, 'worker', a.worker_id, 'job', j.id, amt, 'locked', 'Job: ' || j.title, 'job-hire:' || a.id::text) returning id into esc;
  insert into wallet_transactions(public_id, owner_role, owner_id, counterparty_role, counterparty_id, type, amount_ghs, net_ghs, status, description, escrow_id, idempotency_key)
    values ('BXD-TX-' || upper(substr(md5(random()::text || esc::text), 1, 8)), prole, me, 'worker', a.worker_id, 'escrow_lock', amt, amt, 'completed',
      'Held in escrow for ' || j.title, esc, 'escrow-lock:' || esc::text) returning id into tx;
  update escrow_holds set lock_tx_id = tx where id = esc;
  insert into job_engagements(public_id, job_id, application_id, worker_id, payer_id, payer_role, escrow_id, days, rate_ghs, amount_ghs, status, started_at)
    values ('BXD-ENG-' || upper(substr(md5(random()::text || esc::text), 1, 8)), j.id, a.id, a.worker_id, me, prole, esc, p_days, rate, amt, 'active', now()) returning id into eng;
  update job_applications set status = 'accepted' where id = a.id;
  select count(*) into accepted from job_applications where job_id = j.id and status = 'accepted';
  if accepted >= j.workers_needed then update jobs set status = 'filled', updated_at = now() where id = j.id; end if;
  perform notify_user(a.worker_id, 'hired', 'You are hired', 'You were hired for "' || j.title || '". Payment of GHS ' || amt || ' is held safely in escrow.', '#/engagement/' || eng, jsonb_build_object('engagement', eng));
  return jsonb_build_object('engagement_id', eng, 'escrow_id', esc, 'amount', amt, 'days', p_days, 'rate', rate);
end $$;

-- Worker marks the work as done; starts the 3-day auto-release clock.
create or replace function public.engagement_submit(p_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g job_engagements; t text;
begin
  select * into g from job_engagements where id = p_id for update;
  if not found or g.worker_id is distinct from me then raise exception 'not your engagement'; end if;
  if g.status <> 'active' then raise exception 'this engagement is %', g.status; end if;
  update job_engagements set status = 'submitted', submitted_at = now(), submit_note = left(nullif(trim(p_note), ''), 1000),
    auto_release_at = now() + interval '3 days', updated_at = now() where id = p_id;
  select title into t from jobs where id = g.job_id;
  perform notify_user(g.payer_id, 'work_submitted', 'Work submitted', 'The worker finished "' || coalesce(t, 'your job') || '". Review it within 3 days or payment releases automatically.', '#/engagement/' || p_id, '{}'::jsonb);
  return jsonb_build_object('status', 'submitted', 'auto_release_at', now() + interval '3 days');
end $$;

-- Employer approves: release to worker minus commission.
create or replace function public.engagement_approve(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g job_engagements; r jsonb; t text;
begin
  select * into g from job_engagements where id = p_id for update;
  if not found or g.payer_id is distinct from me then raise exception 'not your engagement'; end if;
  if g.status not in ('active','submitted') then raise exception 'this engagement is %', g.status; end if;
  r := public._escrow_release(g.escrow_id);
  update job_engagements set status = 'released', released_at = now(), updated_at = now() where id = p_id;
  select title into t from jobs where id = g.job_id;
  perform notify_user(g.worker_id, 'payment_released', 'Payment released', 'GHS ' || (r->>'net') || ' for "' || coalesce(t, 'your job') || '" is now in your wallet.', '#/wallet', r);
  return r;
end $$;

-- Either side opens a dispute; escrow stays frozen for admin.
create or replace function public.engagement_dispute(p_id uuid, p_reason text, p_details text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g job_engagements; other uuid;
begin
  select * into g from job_engagements where id = p_id for update;
  if not found or me not in (g.payer_id, g.worker_id) then raise exception 'not your engagement'; end if;
  if g.status not in ('active','submitted') then raise exception 'this engagement is %', g.status; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'tell us the reason'; end if;
  update job_engagements set status = 'disputed', disputed_at = now(), auto_release_at = null, dispute_reason = left(trim(p_reason), 200),
    dispute_details = left(nullif(trim(p_details), ''), 2000), updated_at = now() where id = p_id;
  update escrow_holds set status = 'disputed', updated_at = now() where id = g.escrow_id and status = 'locked';
  other := case when me = g.payer_id then g.worker_id else g.payer_id end;
  perform notify_user(other, 'dispute_opened', 'Dispute opened', 'A dispute was opened. Funds stay safe in escrow while BAID X reviews.', '#/engagement/' || p_id, '{}'::jsonb);
  return jsonb_build_object('status', 'disputed');
end $$;

-- Employer cancels before work starts being submitted: full refund. (Worker may also decline = refund.)
create or replace function public.engagement_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g job_engagements; r jsonb; other uuid;
begin
  select * into g from job_engagements where id = p_id for update;
  if not found or me not in (g.payer_id, g.worker_id) then raise exception 'not your engagement'; end if;
  if g.status <> 'active' then raise exception 'only active work can be cancelled'; end if;
  r := public._escrow_refund(g.escrow_id);
  update job_engagements set status = 'refunded', updated_at = now() where id = p_id;
  update job_applications set status = 'withdrawn' where id = g.application_id;
  update jobs set status = 'open', updated_at = now() where id = g.job_id and status = 'filled';
  other := case when me = g.payer_id then g.worker_id else g.payer_id end;
  perform notify_user(other, 'engagement_cancelled', 'Engagement cancelled', 'The engagement was cancelled and the escrow was refunded to the employer.', '#/engagement/' || p_id, '{}'::jsonb);
  return r;
end $$;

-- Cron: release submitted work nobody reviewed within 3 days.
create or replace function public.escrow_auto_release() returns int
language plpgsql security definer set search_path = public as $$
declare g job_engagements; n int := 0; r jsonb;
begin
  for g in select * from job_engagements where status = 'submitted' and auto_release_at <= now() order by auto_release_at limit 100 for update skip locked loop
    r := public._escrow_release(g.escrow_id);
    update job_engagements set status = 'released', released_at = now(), updated_at = now() where id = g.id;
    perform notify_user(g.worker_id, 'payment_released', 'Payment released', 'GHS ' || (r->>'net') || ' was released automatically and is in your wallet.', '#/wallet', r);
    perform notify_user(g.payer_id, 'payment_released', 'Payment auto-released', 'The review window ended, so payment was released to the worker.', '#/engagement/' || g.id, '{}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Admin settles a dispute: p_release_ghs goes to the worker (minus commission), the rest back to the employer.
create or replace function public.admin_resolve_engagement(p_id uuid, p_release_ghs numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g job_engagements; r jsonb;
begin
  if not public.is_active_admin() then raise exception 'admin only'; end if;
  select * into g from job_engagements where id = p_id for update;
  if not found or g.status <> 'disputed' then raise exception 'not in dispute'; end if;
  if p_release_ghs < 0 or p_release_ghs > g.amount_ghs then raise exception 'release amount out of range'; end if;
  r := public._escrow_split(g.escrow_id, round(p_release_ghs, 2));
  update job_engagements set status = case when p_release_ghs <= 0 then 'refunded' else 'released' end, released_at = now(),
    resolution_note = left(nullif(trim(p_note), ''), 1000), updated_at = now() where id = p_id;
  perform public._audit('resolve_engagement', 'job_engagement', p_id::text, null, r, jsonb_build_object('release', p_release_ghs));
  perform notify_user(g.worker_id, 'dispute_resolved', 'Dispute resolved', 'BAID X settled the dispute. Check your wallet.', '#/wallet', '{}'::jsonb);
  perform notify_user(g.payer_id, 'dispute_resolved', 'Dispute resolved', 'BAID X settled the dispute. Check your wallet.', '#/wallet', '{}'::jsonb);
  return r;
end $$;

revoke all on function public._escrow_split(uuid, numeric), public._escrow_release(uuid), public._escrow_refund(uuid), public.escrow_auto_release() from public, anon, authenticated;
revoke all on function public.hire_worker(uuid, int, numeric), public.engagement_submit(uuid, text), public.engagement_approve(uuid), public.engagement_dispute(uuid, text, text),
  public.engagement_cancel(uuid), public.admin_resolve_engagement(uuid, numeric, text) from public, anon;
grant execute on function public.hire_worker(uuid, int, numeric), public.engagement_submit(uuid, text), public.engagement_approve(uuid), public.engagement_dispute(uuid, text, text),
  public.engagement_cancel(uuid), public.admin_resolve_engagement(uuid, numeric, text) to authenticated;

select cron.schedule('escrow-auto-release', '*/15 * * * *', $$select public.escrow_auto_release()$$);

-- Read helpers (applied as migration phase8_escrow_read_rpcs): job_applicants(p_job) for the job owner, my_engagements() for either party.
-- Employers can only read verified worker rows directly, so applicants are served by this security-definer function with just the fields needed to choose.
create or replace function public.job_applicants(p_job uuid) returns table(application_id uuid, worker_id uuid, name text, photo text, trade text, verified boolean, trust numeric, years text, proposed_rate numeric, status text, applied_at timestamptz, engagement_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.worker_id, w.full_name, w.profile_photo_url, jc.name, (w.verification_status = 'verified'), w.trust_score, w.years_of_experience::text, a.proposed_rate_ghs, a.status, a.created_at, e.id
  from job_applications a
  join jobs j on j.id = a.job_id and (j.company_id = auth.uid() or j.employer_id = auth.uid())
  join worker_profiles w on w.id = a.worker_id
  left join job_categories jc on jc.id = w.primary_job_category_id
  left join job_engagements e on e.application_id = a.id
  where a.job_id = p_job and a.status <> 'withdrawn'
  order by (a.status = 'accepted') desc, a.created_at desc
$$;

create or replace function public.my_engagements() returns table(id uuid, public_id text, job_id uuid, title text, role text, counterpart text, days int, rate_ghs numeric, amount_ghs numeric, status text, submit_note text, submitted_at timestamptz, auto_release_at timestamptz, released_at timestamptz, dispute_reason text, dispute_details text, resolution_note text, started_at timestamptz, commission_ghs numeric, net_ghs numeric)
language sql stable security definer set search_path = public as $$
  select e.id, e.public_id, e.job_id, j.title, case when e.worker_id = auth.uid() then 'worker' else 'payer' end,
    case when e.worker_id = auth.uid() then coalesce(c.company_name, ie.full_name, 'Client') else w.full_name end,
    e.days, e.rate_ghs, e.amount_ghs, e.status, e.submit_note, e.submitted_at, e.auto_release_at, e.released_at, e.dispute_reason, e.dispute_details, e.resolution_note, e.started_at, h.commission_ghs, h.net_ghs
  from job_engagements e
  join jobs j on j.id = e.job_id
  join worker_profiles w on w.id = e.worker_id
  left join company_profiles c on c.id = e.payer_id
  left join individual_employer_profiles ie on ie.id = e.payer_id
  left join escrow_holds h on h.id = e.escrow_id
  where e.worker_id = auth.uid() or e.payer_id = auth.uid() or public.is_active_admin()
  order by e.created_at desc limit 100
$$;
revoke all on function public.job_applicants(uuid), public.my_engagements() from public, anon;
grant execute on function public.job_applicants(uuid), public.my_engagements() to authenticated;
