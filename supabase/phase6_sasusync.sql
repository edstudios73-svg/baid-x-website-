-- BAID X · Phase 6: SasuSync SMS/OTP support. Applied to project igfmmprlrybxsdzehwid.
-- Never stores OTP codes, API keys or webhook secrets. All new tables are service-role only (RLS on, no policies).

-- 1) Delivery state per provider message (webhook idempotency + out-of-order handling)
create table if not exists public.sasusync_message_state (
  message_id text primary key,
  status text not null check (status in ('sent','delivered','failed','expired')),
  event_ts timestamptz not null,
  recipient_tail text,                       -- last 3 digits only
  events_seen integer not null default 1,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sasusync_message_state enable row level security;
revoke all on public.sasusync_message_state from anon, authenticated;

-- 2) Provider OTP references (the provider's otp_id, never the code)
create table if not exists public.sasusync_otp_requests (
  id uuid primary key default gen_random_uuid(),
  otp_id text not null unique,
  phone text not null,                        -- canonical 233XXXXXXXXX
  purpose text not null check (purpose in ('signup','reset')),
  status text not null default 'sent' check (status in ('sent','verified','expired','failed')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists sasusync_otp_phone_idx on public.sasusync_otp_requests (phone, created_at desc);
alter table public.sasusync_otp_requests enable row level security;
revoke all on public.sasusync_otp_requests from anon, authenticated;

-- 3) Application-level rate limiting (fixed windows)
create table if not exists public.app_rate_limits (
  key text not null, bucket_start timestamptz not null, n integer not null default 0,
  primary key (key, bucket_start)
);
alter table public.app_rate_limits enable row level security;
revoke all on public.app_rate_limits from anon, authenticated;

-- 4) Apply one webhook event. Same message_id = same row. The LATER event timestamp wins, never the later HTTP request.
create or replace function public.sasusync_apply_event(p_message_id text, p_status text, p_ts timestamptz, p_recipient text default null)
returns text language plpgsql security definer set search_path = public as $$
declare cur public.sasusync_message_state%rowtype; rank_new int; rank_cur int;
begin
  if p_message_id is null or length(p_message_id) = 0 or p_status not in ('sent','delivered','failed','expired') or p_ts is null then return 'invalid'; end if;
  select * into cur from sasusync_message_state where message_id = p_message_id for update;
  if not found then
    insert into sasusync_message_state(message_id, status, event_ts, recipient_tail) values (p_message_id, p_status, p_ts, right(regexp_replace(coalesce(p_recipient,''), '\D', '', 'g'), 3))
    on conflict (message_id) do nothing;
    if found then return 'applied'; end if;
    select * into cur from sasusync_message_state where message_id = p_message_id for update; -- lost a race: fall through
  end if;
  rank_new := case p_status when 'sent' then 1 when 'failed' then 2 when 'expired' then 2 else 3 end;
  rank_cur := case cur.status when 'sent' then 1 when 'failed' then 2 when 'expired' then 2 else 3 end;
  if p_ts = cur.event_ts and p_status = cur.status then
    update sasusync_message_state set events_seen = events_seen + 1 where message_id = p_message_id; return 'noop';  -- exact duplicate
  elsif p_ts > cur.event_ts or (p_ts = cur.event_ts and rank_new > rank_cur) then
    update sasusync_message_state set status = p_status, event_ts = p_ts, events_seen = events_seen + 1, updated_at = now() where message_id = p_message_id; return 'applied';
  else
    update sasusync_message_state set events_seen = events_seen + 1 where message_id = p_message_id; return 'stale';  -- older than what we hold
  end if;
end $$;

-- 5) Fixed-window rate limiter used by the OTP / phone-auth routes
create or replace function public.rl_hit(p_key text, p_window_s integer, p_max integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s); cnt int;
begin
  insert into app_rate_limits(key, bucket_start, n) values (p_key, b, 1) on conflict (key, bucket_start) do update set n = app_rate_limits.n + 1 returning n into cnt;
  if random() < 0.02 then delete from app_rate_limits where bucket_start < now() - interval '2 days'; end if;
  return jsonb_build_object('allowed', cnt <= p_max, 'count', cnt, 'retry_after_s', greatest(1, ceil(extract(epoch from (b + make_interval(secs => p_window_s) - now())))::int));
end $$;

-- 6) Find a Supabase user by canonical phone (Supabase stores phones without the plus sign)
create or replace function public.auth_user_by_phone(p_phone text) returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') limit 1 $$;

revoke execute on function public.sasusync_apply_event(text,text,timestamptz,text) from public, anon, authenticated;
revoke execute on function public.rl_hit(text,integer,integer) from public, anon, authenticated;
revoke execute on function public.auth_user_by_phone(text) from public, anon, authenticated;

-- 7) Safe admin overview (no phones, no codes). Same staff gate the admin console already uses.
create or replace function public.admin_sms_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'health', (select value from platform_settings where key = 'sasusync_health'),
    'sms_notifications_enabled', coalesce((select value from platform_settings where key = 'sms_notifications_enabled') = 'true'::jsonb, false),
    'delivery_7d', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from sasusync_message_state where updated_at > now() - interval '7 days' group by status) s), '{}'::jsonb),
    'otp_requests_24h', (select count(*) from sasusync_otp_requests where created_at > now() - interval '24 hours'),
    'otp_verified_24h', (select count(*) from sasusync_otp_requests where verified_at > now() - interval '24 hours'),
    'last_webhook_at', (select max(updated_at) from sasusync_message_state),
    'recent_sms_logs', coalesce((select jsonb_agg(x) from (select created_at, status, provider, provider_ref, left(coalesce(error,''), 80) as error from notification_logs where channel = 'sms' order by created_at desc limit 10) x), '[]'::jsonb));
end $$;
grant execute on function public.admin_sms_overview() to authenticated;
revoke execute on function public.admin_sms_overview() from anon, public;

-- 8) SMS notification dispatch (OFF by default: platform_settings.sms_notifications_enabled = false)
insert into public.platform_settings(key,value) values ('sms_notifications_enabled','false'::jsonb) on conflict (key) do nothing;
create or replace function public.sms_recipient(p_user uuid, p_category text) returns text language plpgsql stable security definer set search_path = public, auth as $$
declare pr notification_preferences%rowtype; ph text; ok boolean;
begin
  select * into pr from notification_preferences where user_id = p_user;
  if not found or coalesce(pr.sms_enabled,false) = false then return null; end if;   -- no row = not opted in
  ok := case p_category when 'jobs' then pr.jobs when 'projects' then pr.projects when 'payments' then pr.payments when 'wallet' then pr.wallet
        when 'listings' then pr.listings when 'account' then pr.account when 'messages' then pr.messages else false end;
  if not coalesce(ok,false) then return null; end if;
  select phone into ph from auth.users where id = p_user and phone_confirmed_at is not null;   -- only a phone proven by OTP
  return ph;
end $$;
revoke execute on function public.sms_recipient(uuid,text) from public, anon, authenticated;
create or replace function public.trg_sms_notification() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare sec text;
begin
  if coalesce((select value from platform_settings where key='sms_notifications_enabled') = 'true'::jsonb, false) = false then return new; end if;
  if coalesce(new.category,'') not in ('payments','wallet','account','jobs','projects') then return new; end if;  -- transactional only
  select v into sec from app_secrets where k = 'push_secret';
  perform net.http_post(url := 'https://baid-x-website.vercel.app/api/sms-notify', headers := jsonb_build_object('content-type','application/json','x-push-secret', sec),
    body := jsonb_build_object('notification_id', new.id), timeout_milliseconds := 20000);
  return new;
exception when others then return new;
end $$;
create trigger sms_on_notification after insert on public.notifications for each row execute function public.trg_sms_notification();

-- 9) Synthetic-email phone identities (Supabase's native Phone provider is NOT used). Applied to project igfmmprlrybxsdzehwid.
create table if not exists public.phone_identities (phone text primary key check (phone ~ '^233[0-9]{9}$'), user_id uuid not null unique references auth.users(id) on delete cascade, created_at timestamptz not null default now());
alter table public.phone_identities enable row level security;
revoke all on public.phone_identities from anon, authenticated;
create or replace function public.auth_user_by_phone(p_phone text) returns uuid language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select user_id from public.phone_identities where phone = regexp_replace(p_phone, '\D', '', 'g')),
    (select id from auth.users where regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') limit 1)) $$;
create or replace function public.sms_recipient(p_user uuid, p_category text) returns text language plpgsql stable security definer set search_path = public, auth as $$
declare pr notification_preferences%rowtype; ph text; ok boolean;
begin
  select * into pr from notification_preferences where user_id = p_user;
  if not found or coalesce(pr.sms_enabled,false) = false then return null; end if;
  ok := case p_category when 'jobs' then pr.jobs when 'projects' then pr.projects when 'payments' then pr.payments when 'wallet' then pr.wallet
        when 'listings' then pr.listings when 'account' then pr.account when 'messages' then pr.messages else false end;
  if not coalesce(ok,false) then return null; end if;
  select phone into ph from public.phone_identities where user_id = p_user;
  if ph is null then select phone into ph from auth.users where id = p_user and phone_confirmed_at is not null; end if;
  return ph;
end $$;

-- 10) One-query phone -> login email lookup (speeds up phone sign-in)
create or replace function public.auth_email_by_phone(p_phone text) returns text language sql stable security definer set search_path = public, auth as $$
  select u.email from auth.users u where u.id = public.auth_user_by_phone(p_phone) $$;
revoke execute on function public.auth_email_by_phone(text) from public, anon, authenticated;

-- 11) SMS announcements (admin bulk SMS). Applied to project igfmmprlrybxsdzehwid. No phone numbers are stored in sms_broadcasts.
create table if not exists public.sms_broadcasts (id uuid primary key default gen_random_uuid(), request_id uuid not null unique, created_by uuid, message text not null, parts int not null, target_roles text[] not null default '{}', mode text not null, status text not null default 'sending' check (status in ('sending','sent','partial','failed')), recipients int not null default 0, accepted int not null default 0, credits_used numeric, chunks jsonb not null default '[]'::jsonb, error text, created_at timestamptz not null default now(), finished_at timestamptz);
alter table public.sms_broadcasts enable row level security;
revoke all on public.sms_broadcasts from anon, authenticated;
create or replace function public.sms_broadcast_recipients(p_roles text[]) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role, 'phone', coalesce(pi.phone, case a.role
      when 'worker' then (select phone_number from worker_profiles where id = a.user_id)
      when 'company' then (select contact_phone from company_profiles where id = a.user_id)
      when 'project-manager' then (select phone_number from project_manager_profiles where id = a.user_id)
      when 'business' then (select contact_phone from business_profiles where id = a.user_id)
      when 'individual-employer' then (select phone_number from individual_employer_profiles where id = a.user_id) end))), '[]'::jsonb)
  from account_roles a
  left join phone_identities pi on pi.user_id = a.user_id
  left join notification_preferences np on np.user_id = a.user_id
  where a.account_status = 'active'
    and (coalesce(array_length(p_roles, 1), 0) = 0 or a.role = any(p_roles))
    and coalesce(np.sms_enabled, true) and coalesce(np.announcements, true) $$;
revoke execute on function public.sms_broadcast_recipients(text[]) from public, anon, authenticated;
create or replace function public.admin_sms_broadcasts() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x) from (select id, created_at, finished_at, left(message, 160) as message, parts, target_roles, mode, status, recipients, accepted, credits_used, error from sms_broadcasts order by created_at desc limit 20) x), '[]'::jsonb);
end $$;
grant execute on function public.admin_sms_broadcasts() to authenticated;
revoke execute on function public.admin_sms_broadcasts() from anon, public;
-- admin_broadcast: the sms channel is no longer reported as "not configured" (the SMS itself is sent by /api/sasusync-admin sms_broadcast)

-- 12) Scheduled SMS + automated welcome messages. Applied to project igfmmprlrybxsdzehwid.
create table if not exists public.sms_jobs (id uuid primary key default gen_random_uuid(), kind text not null check (kind in ('broadcast','welcome')), run_at timestamptz not null default now(), status text not null default 'queued' check (status in ('queued','running','sent','partial','failed','skipped','cancelled')), dedupe_key text unique, payload jsonb not null default '{}'::jsonb, created_by uuid, created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz, result jsonb, error text);
create table if not exists public.sms_automations (role text primary key check (role in ('worker','company','project-manager','business','individual-employer')), enabled boolean not null default false, template text not null, updated_at timestamptz not null default now(), updated_by uuid);
alter table public.sms_jobs enable row level security; alter table public.sms_automations enable row level security;
revoke all on public.sms_jobs, public.sms_automations from anon, authenticated;
create index if not exists sms_jobs_due_idx on public.sms_jobs (status, run_at);
insert into public.sms_automations(role, enabled, template) values
 ('worker', false, 'Welcome to BAID X, {first_name}! Complete your profile and get verified to start landing jobs: baid-x-website.vercel.app'),
 ('company', false, 'Welcome to BAID X, {name}! Post your first job and find verified workers fast: baid-x-website.vercel.app'),
 ('project-manager', false, 'Welcome to BAID X, {first_name}! Start a project and build your team with verified talent: baid-x-website.vercel.app'),
 ('business', false, 'Welcome to BAID X, {name}! List your services and get found by clients: baid-x-website.vercel.app'),
 ('individual-employer', false, 'Welcome to BAID X, {first_name}! Post what you need done and hire trusted people: baid-x-website.vercel.app')
on conflict (role) do nothing;
insert into public.platform_settings(key, value) values ('sms_automations_enabled', 'false'::jsonb) on conflict (key) do nothing;
create or replace function public.sms_jobs_claim(p_limit int default 20) returns setof public.sms_jobs language plpgsql security definer set search_path = public as $$
begin
  update sms_jobs set status = 'failed', error = 'STUCK (may have been sent)', finished_at = now() where status = 'running' and started_at < now() - interval '10 minutes';
  return query with c as (select id from sms_jobs where status = 'queued' and run_at <= now() order by run_at limit greatest(1, least(p_limit, 50)) for update skip locked)
    update sms_jobs j set status = 'running', started_at = now() from c where j.id = c.id returning j.*;
end $$;
create or replace function public.sms_welcome_context(p_user uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', a.role,
    'name', case a.role when 'worker' then (select full_name from worker_profiles where id = p_user) when 'company' then (select company_name from company_profiles where id = p_user)
       when 'project-manager' then (select full_name from project_manager_profiles where id = p_user) when 'business' then (select business_name from business_profiles where id = p_user)
       when 'individual-employer' then (select full_name from individual_employer_profiles where id = p_user) end,
    'phone', coalesce((select phone from phone_identities where user_id = p_user), case a.role when 'worker' then (select phone_number from worker_profiles where id = p_user)
       when 'company' then (select contact_phone from company_profiles where id = p_user) when 'project-manager' then (select phone_number from project_manager_profiles where id = p_user)
       when 'business' then (select contact_phone from business_profiles where id = p_user) when 'individual-employer' then (select phone_number from individual_employer_profiles where id = p_user) end),
    'opted_out', coalesce((select not (np.sms_enabled and np.announcements) from notification_preferences np where np.user_id = p_user), false))
  from account_roles a where a.user_id = p_user and a.account_status = 'active' limit 1 $$;
create or replace function public.sms_scheduler_poke() returns void language plpgsql security definer set search_path = public, extensions as $$
declare sec text;
begin
  if not exists (select 1 from sms_jobs where status = 'queued' and run_at <= now()) then return; end if;
  select v into sec from app_secrets where k = 'push_secret';
  perform net.http_post(url := 'https://baid-x-website.vercel.app/api/sms-scheduler', headers := jsonb_build_object('content-type','application/json','x-push-secret', sec), body := '{}'::jsonb, timeout_milliseconds := 25000);
exception when others then null;
end $$;
create or replace function public.trg_sms_welcome() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce((select value from platform_settings where key = 'sms_automations_enabled') = 'true'::jsonb, false)
     and exists (select 1 from sms_automations where role = new.role and enabled) then
    insert into sms_jobs(kind, run_at, dedupe_key, payload, created_by) values ('welcome', now(), 'welcome:' || new.user_id::text, jsonb_build_object('user_id', new.user_id, 'role', new.role), new.user_id) on conflict (dedupe_key) do nothing;
    perform public.sms_scheduler_poke();
  end if;
  return new;
exception when others then return new;
end $$;
create trigger sms_welcome_on_role after insert on public.account_roles for each row execute function public.trg_sms_welcome();
create extension if not exists pg_cron;
select cron.schedule('sms-scheduler', '* * * * *', 'select public.sms_scheduler_poke()');
create or replace function public.sched_broadcast_inapp(p_title text, p_body text, p_href text, p_roles text[], p_by uuid, p_channels text[]) returns integer language plpgsql security definer set search_path = public as $$
declare bid uuid; n int; ch text[] := coalesce(p_channels, array['in_app']);
begin
  insert into notification_broadcasts(created_by, title, body, href, target_roles, channels, status, sent_at, meta) values (p_by, trim(p_title), trim(p_body), nullif(trim(coalesce(p_href,'')),''), coalesce(p_roles,'{}'), ch, 'sent', now(),
    jsonb_build_object('delivered', jsonb_build_object('in_app', true), 'scheduled', true, 'not_configured', (select coalesce(jsonb_agg(c), '[]') from unnest(ch) c where c not in ('in_app','sms')))) returning id into bid;
  insert into notifications(user_id, type, title, body, href, category, meta, broadcast_id)
    select user_id, 'announcement', trim(p_title), trim(p_body), nullif(trim(coalesce(p_href,'')),''), 'announcement', '{}', bid from account_roles where account_status = 'active' and (coalesce(array_length(p_roles,1),0) = 0 or role = any(p_roles));
  get diagnostics n = row_count; update notification_broadcasts set recipient_count = n where id = bid;
  return n;
end $$;
-- admin_sms_jobs() and admin_sms_automations() are admin-gated read RPCs (granted to authenticated); the rest are service-only.
create or replace function public.admin_sms_jobs() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x) from (select id, kind, status, run_at, created_at, finished_at, error,
      left(coalesce(payload->>'message',''), 160) as message, payload->'roles' as roles, coalesce((payload->'in_app') is not null, false) as in_app, result
    from sms_jobs where kind = 'broadcast' order by case when status in ('queued','running') then 0 else 1 end, run_at desc limit 30) x), '[]'::jsonb);
end $$;
create or replace function public.admin_sms_automations() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object('master', coalesce((select value from platform_settings where key = 'sms_automations_enabled') = 'true'::jsonb, false),
    'automations', coalesce((select jsonb_agg(jsonb_build_object('role', role, 'enabled', enabled, 'template', template, 'updated_at', updated_at) order by role) from sms_automations), '[]'::jsonb),
    'sent_7d', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from sms_jobs where kind = 'welcome' and created_at > now() - interval '7 days' group by status) s), '{}'::jsonb));
end $$;
grant execute on function public.admin_sms_jobs() to authenticated; grant execute on function public.admin_sms_automations() to authenticated;
revoke execute on function public.admin_sms_jobs() from anon, public; revoke execute on function public.admin_sms_automations() from anon, public;
revoke execute on function public.sms_jobs_claim(int) from public, anon, authenticated; revoke execute on function public.sms_welcome_context(uuid) from public, anon, authenticated;
revoke execute on function public.sms_scheduler_poke() from public, anon, authenticated; revoke execute on function public.sched_broadcast_inapp(text,text,text,text[],uuid,text[]) from public, anon, authenticated;

-- 13) one-time password set after a verified phone code (password_set_at)
alter table public.sasusync_otp_requests add column if not exists password_set_at timestamptz;
