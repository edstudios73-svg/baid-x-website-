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
