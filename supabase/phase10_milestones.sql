-- BAID X · Phase 10: project milestones paid through escrow. Applied to project igfmmprlrybxsdzehwid.
-- The company that owns a project defines milestones for a team member, funds each one from its wallet into escrow,
-- the team member submits it, and approval (or 5 days of silence) releases the money minus commission.

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  payee_id uuid not null, payee_role text not null check (payee_role in ('worker','project_manager','business')),
  title text not null check (length(title) between 2 and 120), description text, due_on date,
  amount_ghs numeric not null check (amount_ghs > 0),
  status text not null default 'planned' check (status in ('planned','funded','submitted','released','disputed','refunded','cancelled')),
  escrow_id uuid references public.escrow_holds(id) on delete set null,
  funded_at timestamptz, submitted_at timestamptz, submit_note text, auto_release_at timestamptz, released_at timestamptz,
  dispute_reason text, dispute_details text, disputed_at timestamptz, resolution_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists project_milestones_project_idx on public.project_milestones (project_id, created_at);
create index if not exists project_milestones_payee_idx on public.project_milestones (payee_id, created_at desc);
create index if not exists project_milestones_due_idx on public.project_milestones (status, auto_release_at);
alter table public.project_milestones enable row level security;
create policy project_milestones_select on public.project_milestones for select to authenticated using (auth.uid() = owner_id or auth.uid() = payee_id or public.is_active_admin());
revoke insert, update, delete on public.project_milestones from anon, authenticated;

create or replace function public.milestone_create(p_project uuid, p_payee uuid, p_title text, p_amount numeric, p_description text default null, p_due date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p projects; prole text; mid uuid;
begin
  select * into p from projects where id = p_project;
  if p.id is null or p.company_id is distinct from me then raise exception 'only the project owner can add milestones'; end if;
  if p.status in ('completed','cancelled') then raise exception 'this project is closed'; end if;
  select case when pp.role_type = 'pm' then 'project_manager' else pp.role_type end into prole from project_participants pp
    where pp.project_id = p_project and pp.profile_id = p_payee and pp.status in ('accepted','active') limit 1;
  if prole is null and p.pm_id = p_payee then prole := 'project_manager'; end if;
  if prole is null then raise exception 'choose someone on this project''s team'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'give the milestone a title'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then raise exception 'enter a valid amount'; end if;
  insert into project_milestones(public_id, project_id, owner_id, payee_id, payee_role, title, description, due_on, amount_ghs)
    values ('BXD-MS-' || upper(substr(md5(random()::text || p_project::text), 1, 8)), p_project, me, p_payee, prole, left(trim(p_title), 120), left(nullif(trim(p_description), ''), 1000), p_due, round(p_amount, 2)) returning id into mid;
  perform notify_user(p_payee, 'milestone_planned', 'New milestone', '"' || left(trim(p_title), 80) || '" (GHS ' || round(p_amount, 2) || ') was added on ' || p.name || '. You will be told when it is funded.', '#/ws/milestones', '{}'::jsonb);
  return jsonb_build_object('milestone_id', mid);
end $$;

create or replace function public.milestone_fund(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m project_milestones; bal numeric; esc uuid; tx uuid; pn text;
begin
  select * into m from project_milestones where id = p_id for update;
  if not found or m.owner_id is distinct from me then raise exception 'not your milestone'; end if;
  if m.status <> 'planned' then raise exception 'this milestone is %', m.status; end if;
  select name into pn from projects where id = m.project_id;
  select available_ghs into bal from wallet_accounts where owner_role = 'company' and owner_id = me for update;
  if coalesce(bal, 0) < m.amount_ghs then raise exception 'insufficient_funds:%', round(m.amount_ghs - coalesce(bal, 0), 2); end if;
  update wallet_accounts set available_ghs = available_ghs - m.amount_ghs, lifetime_spent_ghs = lifetime_spent_ghs + m.amount_ghs, updated_at = now() where owner_role = 'company' and owner_id = me;
  insert into escrow_holds(public_id, payer_role, payer_id, receiver_role, receiver_id, context_type, context_id, amount_ghs, status, description, idempotency_key)
    values ('BXD-ESC-' || upper(substr(md5(random()::text || m.id::text), 1, 8)), 'company', me, m.payee_role, m.payee_id, 'project', m.project_id, m.amount_ghs, 'locked', 'Milestone: ' || m.title, 'milestone:' || m.id::text) returning id into esc;
  insert into wallet_transactions(public_id, owner_role, owner_id, counterparty_role, counterparty_id, type, amount_ghs, net_ghs, status, description, escrow_id, idempotency_key)
    values ('BXD-TX-' || upper(substr(md5(random()::text || esc::text), 1, 8)), 'company', me, m.payee_role, m.payee_id, 'escrow_lock', m.amount_ghs, m.amount_ghs, 'completed', 'Held in escrow: ' || m.title, esc, 'escrow-lock:' || esc::text) returning id into tx;
  update escrow_holds set lock_tx_id = tx where id = esc;
  update project_milestones set status = 'funded', escrow_id = esc, funded_at = now(), updated_at = now() where id = p_id;
  perform notify_user(m.payee_id, 'milestone_funded', 'Milestone funded', '"' || m.title || '" on ' || coalesce(pn, 'your project') || ' is funded. GHS ' || m.amount_ghs || ' is held safely in escrow.', '#/ws/milestones', '{}'::jsonb);
  return jsonb_build_object('status', 'funded');
end $$;

create or replace function public.milestone_submit(p_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m project_milestones;
begin
  select * into m from project_milestones where id = p_id for update;
  if not found or m.payee_id is distinct from auth.uid() then raise exception 'not your milestone'; end if;
  if m.status <> 'funded' then raise exception 'this milestone is %', m.status; end if;
  update project_milestones set status = 'submitted', submitted_at = now(), submit_note = left(nullif(trim(p_note), ''), 1000), auto_release_at = now() + interval '5 days', updated_at = now() where id = p_id;
  perform notify_user(m.owner_id, 'milestone_submitted', 'Milestone submitted', '"' || m.title || '" is ready for your review. It releases automatically in 5 days if you do nothing.', '#/ws/milestones', '{}'::jsonb);
  return jsonb_build_object('status', 'submitted');
end $$;

create or replace function public.milestone_approve(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m project_milestones; r jsonb;
begin
  select * into m from project_milestones where id = p_id for update;
  if not found or m.owner_id is distinct from auth.uid() then raise exception 'not your milestone'; end if;
  if m.status not in ('funded','submitted') then raise exception 'this milestone is %', m.status; end if;
  r := public._escrow_release(m.escrow_id);
  update project_milestones set status = 'released', released_at = now(), auto_release_at = null, updated_at = now() where id = p_id;
  perform notify_user(m.payee_id, 'payment_released', 'Payment released', 'GHS ' || (r->>'net') || ' for "' || m.title || '" is now in your wallet.', '#/wallet', r);
  return r;
end $$;

create or replace function public.milestone_dispute(p_id uuid, p_reason text, p_details text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m project_milestones; me uuid := auth.uid();
begin
  select * into m from project_milestones where id = p_id for update;
  if not found or me not in (m.owner_id, m.payee_id) then raise exception 'not your milestone'; end if;
  if m.status not in ('funded','submitted') then raise exception 'this milestone is %', m.status; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'tell us the reason'; end if;
  update project_milestones set status = 'disputed', disputed_at = now(), auto_release_at = null, dispute_reason = left(trim(p_reason), 200), dispute_details = left(nullif(trim(p_details), ''), 2000), updated_at = now() where id = p_id;
  update escrow_holds set status = 'disputed', updated_at = now() where id = m.escrow_id and status = 'locked';
  perform notify_user(case when me = m.owner_id then m.payee_id else m.owner_id end, 'dispute_opened', 'Dispute opened', 'A dispute was opened on a milestone. Funds stay safe in escrow while BAID X reviews.', '#/ws/milestones', '{}'::jsonb);
  return jsonb_build_object('status', 'disputed');
end $$;

-- Owner removes an unfunded milestone, or takes back a funded one the team member has not submitted. The payee can also decline a funded one.
create or replace function public.milestone_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m project_milestones; me uuid := auth.uid(); r jsonb;
begin
  select * into m from project_milestones where id = p_id for update;
  if not found or me not in (m.owner_id, m.payee_id) then raise exception 'not your milestone'; end if;
  if m.status = 'planned' then
    if me <> m.owner_id then raise exception 'only the owner can remove this'; end if;
    update project_milestones set status = 'cancelled', updated_at = now() where id = p_id; return jsonb_build_object('status', 'cancelled');
  end if;
  if m.status <> 'funded' then raise exception 'this milestone can no longer be cancelled'; end if;
  r := public._escrow_refund(m.escrow_id);
  update project_milestones set status = 'refunded', updated_at = now() where id = p_id;
  perform notify_user(case when me = m.owner_id then m.payee_id else m.owner_id end, 'milestone_cancelled', 'Milestone cancelled', '"' || m.title || '" was cancelled and the escrow refunded to the owner.', '#/ws/milestones', '{}'::jsonb);
  return r;
end $$;

create or replace function public.admin_resolve_milestone(p_id uuid, p_release_ghs numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m project_milestones; r jsonb;
begin
  if not public.is_active_admin() then raise exception 'admin only'; end if;
  select * into m from project_milestones where id = p_id for update;
  if not found or m.status <> 'disputed' then raise exception 'not in dispute'; end if;
  if p_release_ghs < 0 or p_release_ghs > m.amount_ghs then raise exception 'release amount out of range'; end if;
  r := public._escrow_split(m.escrow_id, round(p_release_ghs, 2));
  update project_milestones set status = case when p_release_ghs <= 0 then 'refunded' else 'released' end, released_at = now(), resolution_note = left(nullif(trim(p_note), ''), 1000), updated_at = now() where id = p_id;
  perform public._audit('resolve_milestone', 'project_milestone', p_id::text, null, r, jsonb_build_object('release', p_release_ghs));
  perform notify_user(m.payee_id, 'dispute_resolved', 'Dispute resolved', 'BAID X settled the dispute. Check your wallet.', '#/wallet', '{}'::jsonb);
  perform notify_user(m.owner_id, 'dispute_resolved', 'Dispute resolved', 'BAID X settled the dispute. Check your wallet.', '#/wallet', '{}'::jsonb);
  return r;
end $$;

create or replace function public.milestones_auto_release() returns int
language plpgsql security definer set search_path = public as $$
declare m project_milestones; n int := 0; r jsonb;
begin
  for m in select * from project_milestones where status = 'submitted' and auto_release_at <= now() order by auto_release_at limit 100 for update skip locked loop
    r := public._escrow_release(m.escrow_id);
    update project_milestones set status = 'released', released_at = now(), auto_release_at = null, updated_at = now() where id = m.id;
    perform notify_user(m.payee_id, 'payment_released', 'Payment released', 'GHS ' || (r->>'net') || ' for "' || m.title || '" was released automatically.', '#/wallet', r);
    perform notify_user(m.owner_id, 'payment_released', 'Milestone auto-released', 'The review window ended, so "' || m.title || '" was released to the team member.', '#/ws/milestones', '{}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.project_milestone_list(p_project uuid) returns table(id uuid, public_id text, payee_id uuid, payee_role text, payee_name text, title text, description text, due_on date, amount_ghs numeric, status text, funded_at timestamptz, submitted_at timestamptz, submit_note text, auto_release_at timestamptz, released_at timestamptz, dispute_reason text, resolution_note text, net_ghs numeric, commission_ghs numeric, mine boolean)
language plpgsql stable security definer set search_path = public as $$
declare p projects; owner boolean; mgr boolean;
begin
  select * into p from projects where projects.id = p_project;
  if p.id is null or not public.is_project_member(p_project) then raise exception 'No access to this project'; end if;
  owner := p.company_id = auth.uid(); mgr := public.is_project_pm(p_project);
  return query select m.id, m.public_id, m.payee_id, m.payee_role, public._person_name(m.payee_id), m.title, m.description, m.due_on, m.amount_ghs, m.status, m.funded_at, m.submitted_at, m.submit_note, m.auto_release_at, m.released_at, m.dispute_reason, m.resolution_note, h.net_ghs, h.commission_ghs, (m.payee_id = auth.uid())
    from project_milestones m left join escrow_holds h on h.id = m.escrow_id
    where m.project_id = p_project and (owner or mgr or m.payee_id = auth.uid()) and m.status <> 'cancelled' order by m.created_at;
end $$;

revoke all on function public.milestones_auto_release() from public, anon, authenticated;
revoke all on function public.milestone_create(uuid, uuid, text, numeric, text, date), public.milestone_fund(uuid), public.milestone_submit(uuid, text), public.milestone_approve(uuid), public.milestone_dispute(uuid, text, text), public.milestone_cancel(uuid), public.admin_resolve_milestone(uuid, numeric, text), public.project_milestone_list(uuid) from public, anon;
grant execute on function public.milestone_create(uuid, uuid, text, numeric, text, date), public.milestone_fund(uuid), public.milestone_submit(uuid, text), public.milestone_approve(uuid), public.milestone_dispute(uuid, text, text), public.milestone_cancel(uuid), public.admin_resolve_milestone(uuid, numeric, text), public.project_milestone_list(uuid) to authenticated;
select cron.schedule('milestones-auto-release', '*/15 * * * *', $$select public.milestones_auto_release()$$);
