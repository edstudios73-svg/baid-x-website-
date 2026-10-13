-- Phase 23: platform staff roles that really differ, and two-step sign-in that is enforced.
--
-- Roles (admin_users.admin_role -> org_roles key -> role_permissions):
--   super    -> super_admin       everything, including staff, settings and Paystack
--   platform -> platform_admin    runs the platform: everything except staff, settings and deleting
--   ops      -> ops_admin         members, verification, jobs, projects, reports and support; no money
--   finance  -> finance_admin     money: deposits, withdrawals, escrow, disputes, Paystack, plans
--   auditor  -> platform_auditor  read-only: members, projects, money and the audit log
--
-- Every admin_* function now checks the role's permission (_need) instead of "is any staff" (_adm), and
-- platform_perm also requires an authenticator code (aal2) for privileged roles once Settings -> Two-step
-- is on. Non-destructive: functions are re-created with the same body apart from the check.

alter table public.admin_users drop constraint if exists admin_users_admin_role_check;
alter table public.admin_users add constraint admin_users_admin_role_check check (admin_role = any (array['super', 'platform', 'ops', 'finance', 'auditor']));

create or replace function public.platform_role(p_uid uuid default auth.uid()) returns text language sql stable security definer set search_path = public as $$
  select case admin_role when 'super' then 'super_admin' when 'platform' then 'platform_admin' when 'ops' then 'ops_admin'
    when 'finance' then 'finance_admin' when 'auditor' then 'platform_auditor' else null end
  from admin_users where id = p_uid and is_active
$$;

-- Operations also reviews verification documents (day-to-day work).
insert into public.role_permissions (role_key, resource, action, scope)
select 'ops_admin', 'verification', a, 'GLOBAL_PLATFORM' from unnest(array['VIEW', 'APPROVE', 'EDIT']) a
where not exists (select 1 from public.role_permissions where role_key = 'ops_admin' and resource = 'verification' and action = a);

-- any active staff member who has passed two-step where it is required
create or replace function public._staff() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_admin() then raise exception 'not authorized'; end if;
  if not _mfa_ok(platform_role()) then raise exception 'Enter your authenticator code to continue.'; end if;
end $$;

-- a staff member whose role grants resource:action
create or replace function public._need(p_resource text, p_action text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform _staff();
  if not platform_perm(p_resource, p_action, auth.uid()) then raise exception 'Your staff role can''t do this.'; end if;
end $$;
revoke all on function public._staff() from public, anon;
revoke all on function public._need(text, text) from public, anon;

-- whoami also says whether this sign-in still needs the authenticator code
create or replace function public.platform_whoami() returns jsonb language sql stable security definer set search_path = public as $$
  select case when platform_role() is null then null else jsonb_build_object('role', platform_role(), 'label', (select label from org_roles where key = platform_role()),
    'name', (select full_name from admin_users where id = auth.uid()), 'admin_id', (select admin_id from admin_users where id = auth.uid()),
    'mfa_required', coalesce((select value from bx_settings where key = 'enforce_mfa'), 'false') = 'true' and coalesce((select privileged from org_roles where key = platform_role()), false),
    'can', (select coalesce(jsonb_agg(resource || ':' || action), '[]') from role_permissions where role_key = platform_role())) end
$$;

-- Swap the "any staff" check in each admin function for the permission it needs.
do $$
declare m record; def text; n int := 0;
  rx text := '(perform\s+_adm\(\)|if\s+not\s+(public\.)?is_active_admin\(\)\s+then\s+raise\s+exception\s+''[^'']*''\s*;\s*end\s+if)';
begin
  for m in select * from (values
    ('admin_dashboard', null, null), ('admin_analytics', null, null), ('admin_health', null, null),
    ('admin_applications', 'projects', 'VIEW'), ('admin_jobs', 'projects', 'VIEW'), ('admin_projects', 'projects', 'VIEW'),
    ('admin_set_job_status', 'projects', 'EDIT'), ('admin_set_project_status', 'projects', 'EDIT'),
    ('admin_audit', 'audit', 'VIEW'),
    ('admin_broadcast', 'support', 'EDIT'), ('admin_broadcasts', 'support', 'VIEW'), ('admin_reports', 'support', 'VIEW'), ('admin_resolve_report', 'support', 'EDIT'),
    ('admin_decide_deposit', 'finance', 'APPROVE'), ('admin_decide_withdrawal', 'finance', 'APPROVE'), ('admin_release_escrow', 'finance', 'APPROVE'),
    ('admin_resolve_engagement', 'finance', 'APPROVE'), ('admin_resolve_milestone', 'finance', 'APPROVE'), ('admin_resolve_order', 'finance', 'APPROVE'),
    ('admin_resolve_dispute', 'finance', 'APPROVE'),
    ('admin_finance', 'finance', 'VIEW'), ('admin_money_queue', 'finance', 'VIEW'), ('admin_money_disputes', 'finance', 'VIEW'),
    ('admin_reconciliation', 'finance', 'VIEW'), ('admin_plans', 'finance', 'VIEW'),
    ('admin_decide_verification', 'verification', 'APPROVE'), ('admin_update_verification', 'verification', 'APPROVE'), ('admin_verification_queue', 'verification', 'VIEW'),
    ('admin_get_profile_detail', 'users', 'VIEW'), ('admin_user_detail', 'users', 'VIEW'), ('admin_users', 'users', 'VIEW'),
    ('get_all_signups', 'users', 'VIEW'), ('admin_get_recent_logins', 'users', 'VIEW'), ('admin_set_account_status', 'users', 'EDIT'),
    ('admin_save_category', 'platform', 'EDIT'), ('admin_settings', 'platform', 'VIEW'),
    ('admin_sms_automations', 'platform', 'VIEW'), ('admin_sms_broadcasts', 'platform', 'VIEW'), ('admin_sms_jobs', 'platform', 'VIEW'), ('admin_sms_overview', 'platform', 'VIEW')
  ) as t(fn, res, act)
  loop
    for def in select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = m.fn loop
      -- the old check is either "perform _adm()" or "if not is_active_admin() then raise exception '...'; end if"
      if def !~* rx then continue; end if;
      def := regexp_replace(def, rx, case when m.res is null then 'perform _staff()' else format('perform _need(%L, %L)', m.res, m.act) end, 'gi');
      execute def; n := n + 1;
    end loop;
  end loop;
  raise notice 'guarded % functions', n;
end $$;

-- Staff IDs follow the role: BAID-SUPER-000001, BAID-OPS-000002 ...
create sequence if not exists public.staff_no;
select setval('public.staff_no', greatest((select count(*) from public.admin_users), 1));
create or replace function public._staff_id() returns trigger language plpgsql set search_path = public as $$
begin
  if new.admin_id is null then new.admin_id := 'BAID-' || upper(new.admin_role) || '-' || lpad(nextval('public.staff_no')::text, 6, '0'); end if;
  return new;
end $$;
drop trigger if exists staff_id on public.admin_users;
create trigger staff_id before insert on public.admin_users for each row execute function public._staff_id();

-- Admin → Staff
create or replace function public.admin_staff() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _need('roles', 'VIEW');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.full_name, 'email', a.email, 'admin_id', a.admin_id, 'role', platform_role_of(a.admin_role),
      'label', (select label from org_roles where key = platform_role_of(a.admin_role)), 'active', a.is_active, 'me', a.id = auth.uid(), 'created_at', a.created_at,
      'two_step', exists (select 1 from auth.mfa_factors f where f.user_id = a.id and f.status = 'verified'),
      'last_sign_in', (select last_sign_in_at from auth.users u where u.id = a.id)) order by a.is_active desc, a.created_at)
    from admin_users a), '[]'::jsonb);
end $$;
create or replace function public.platform_role_of(p_admin_role text) returns text language sql immutable set search_path = public as $$
  select case p_admin_role when 'super' then 'super_admin' when 'platform' then 'platform_admin' when 'ops' then 'ops_admin' when 'finance' then 'finance_admin' when 'auditor' then 'platform_auditor' end
$$;

create or replace function public.admin_set_staff(p_id uuid, p_role text, p_active boolean) returns void language plpgsql security definer set search_path = public as $$
declare cur admin_users;
begin
  perform _need('roles', 'ADMINISTER');
  if p_id = auth.uid() then raise exception 'You can''t change your own access. Ask another Super Admin.'; end if;
  if p_role not in ('super', 'platform', 'ops', 'finance', 'auditor') then raise exception 'Choose a role.'; end if;
  select * into cur from admin_users where id = p_id for update;
  if not found then raise exception 'Staff member not found.'; end if;
  update admin_users set admin_role = p_role, is_active = p_active, updated_at = now() where id = p_id;
  perform _audit('staff.updated', 'admin_user', p_id::text, jsonb_build_object('role', cur.admin_role, 'active', cur.is_active), jsonb_build_object('role', p_role, 'active', p_active), '{}'::jsonb);
end $$;

-- a lost phone: remove the authenticator so they set it up again at their next sign-in
create or replace function public.admin_reset_staff_two_step(p_id uuid) returns void language plpgsql security definer set search_path = public, auth as $$
begin
  perform _need('roles', 'ADMINISTER');
  if p_id = auth.uid() then raise exception 'You can''t reset your own two-step here.'; end if;
  if not exists (select 1 from public.admin_users where id = p_id) then raise exception 'Staff member not found.'; end if;
  delete from auth.mfa_factors where user_id = p_id;
  perform public._audit('staff.two_step_reset', 'admin_user', p_id::text, null, '{}'::jsonb, '{}'::jsonb);
end $$;

revoke all on function public.admin_staff() from public, anon;
revoke all on function public.admin_set_staff(uuid, text, boolean) from public, anon;
revoke all on function public.admin_reset_staff_two_step(uuid) from public, anon;
grant execute on function public.admin_staff() to authenticated;
grant execute on function public.admin_set_staff(uuid, text, boolean) to authenticated;
grant execute on function public.admin_reset_staff_two_step(uuid) to authenticated;

-- /api/admin-users "create_staff" asks this as the caller before it creates the login with the service key
create or replace function public.admin_can_add_staff() returns boolean language plpgsql stable security definer set search_path = public as $$
begin perform _need('roles', 'ADMINISTER'); return true; end $$;
revoke all on function public.admin_can_add_staff() from public, anon;
grant execute on function public.admin_can_add_staff() to authenticated;
