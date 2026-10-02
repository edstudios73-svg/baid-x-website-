-- BAID X Phase 3 (billing, part 1): schema, pricing seed, checkout, idempotent activation, lifecycle, RLS.
-- Applied to production. Money is stored as integer pesewas (GHS 30 = 3000). Paystack is the processor;
-- this database is the authority for plans, access and billing state. Webhook + Paystack calls are server-side
-- (api/ functions, service role). Browsers can only read their own rows and call the user RPCs below.

create table if not exists membership_plans(
 id uuid primary key default gen_random_uuid(),
 role text not null check (role in ('worker','individual-employer','business','project-manager','company')),
 tier text not null check (tier in ('access','pro','premium','enterprise')),
 billing_interval text not null check (billing_interval in ('monthly','annual')),
 price_minor integer not null check (price_minor>=0), currency text not null default 'GHS',
 paystack_plan_code text, is_active boolean not null default true, is_founding boolean not null default false,
 capacity_limits jsonb not null default '{}', metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(role,tier,billing_interval,is_founding,currency));
create table if not exists founding_slots(role text primary key, total_slots integer not null, claimed_slots integer not null default 0 check (claimed_slots>=0), program_start timestamptz, program_end timestamptz);
create table if not exists billing_customers(id uuid primary key default gen_random_uuid(), user_id uuid not null, organization_id uuid references organizations(id) on delete set null, paystack_customer_code text unique, email text not null, phone text, created_at timestamptz not null default now(), unique(user_id));
create table if not exists subscriptions(
 id uuid primary key default gen_random_uuid(), user_id uuid not null, organization_id uuid references organizations(id) on delete set null,
 membership_plan_id uuid not null references membership_plans(id), scheduled_plan_id uuid references membership_plans(id),
 paystack_customer_code text, paystack_subscription_code text unique, paystack_plan_code text, paystack_authorization_code text,
 status text not null default 'trialing' check (status in ('trialing','active','past_due','grace_period','cancel_at_period_end','cancelled','expired','suspended')),
 current_period_start timestamptz, current_period_end timestamptz, activated_at timestamptz,
 trial_start timestamptz, trial_end timestamptz, trial_converted boolean not null default false,
 cancel_at_period_end boolean not null default false, cancelled_at timestamptz, grace_until timestamptz,
 is_founding_member boolean not null default false, founding_price_lock_end timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists subscriptions_one_live_per_owner on subscriptions((coalesce(organization_id,user_id))) where status in ('trialing','active','past_due','grace_period','cancel_at_period_end');
create table if not exists billing_payments(
 id uuid primary key default gen_random_uuid(), user_id uuid not null, organization_id uuid references organizations(id) on delete set null, subscription_id uuid references subscriptions(id),
 amount_minor integer not null check (amount_minor>=0), expected_amount_minor integer not null check (expected_amount_minor>=0), currency text not null default 'GHS',
 provider text not null default 'paystack', provider_transaction_id text, provider_reference text not null,
 status text not null default 'pending' check (status in ('pending','processing','successful','failed','cancelled','refunded','partially_refunded','disputed','reversed')),
 purpose text not null check (purpose in ('subscription','verification','boost','promotion','xid','protected_payment_fee')),
 target jsonb not null default '{}', invoice_reference text, metadata jsonb not null default '{}', discrepancy text, refund_status text, refunded_minor integer not null default 0,
 created_at timestamptz not null default now(), confirmed_at timestamptz, refunded_at timestamptz, unique(provider,provider_reference));
create unique index if not exists billing_payments_tx on billing_payments(provider,provider_transaction_id) where provider_transaction_id is not null;
create index if not exists billing_payments_user on billing_payments(user_id,created_at desc);
create table if not exists billing_webhook_events(id uuid primary key default gen_random_uuid(), provider text not null default 'paystack', dedupe_key text not null, event_type text not null, payload jsonb not null,
 status text not null default 'received' check (status in ('received','processed','ignored','failed','flagged')), error text, received_at timestamptz not null default now(), processed_at timestamptz, unique(provider,dedupe_key));
create table if not exists service_catalog(id uuid primary key default gen_random_uuid(), kind text not null check (kind in ('verification','boost','promotion','xid')), code text not null, role text, label text not null,
 price_minor integer not null check (price_minor>=0), currency text not null default 'GHS', duration_hours integer, metadata jsonb not null default '{}', is_active boolean not null default true, unique(kind,code,role));
create table if not exists verification_requests(id uuid primary key default gen_random_uuid(), user_id uuid not null, organization_id uuid references organizations(id) on delete set null, role text not null, verification_type text not null,
 status text not null default 'pending' check (status in ('pending','under_review','verified','rejected','expired')), price_paid_minor integer not null, payment_id uuid references billing_payments(id), requested_at timestamptz not null default now(), decided_at timestamptz, decided_by uuid);
create table if not exists boosts(id uuid primary key default gen_random_uuid(), target_type text not null check (target_type in ('worker_profile','pm_profile','job','project','business_listing')), target_id uuid not null, user_id uuid not null,
 catalog_id uuid references service_catalog(id), price_paid_minor integer not null, payment_id uuid references billing_payments(id), starts_at timestamptz not null, expires_at timestamptz not null);
create table if not exists marketplace_promotions(id uuid primary key default gen_random_uuid(), business_id uuid not null, package_code text not null, listing_ids uuid[] not null default '{}', price_paid_minor integer not null, payment_id uuid references billing_payments(id), starts_at timestamptz not null, expires_at timestamptz not null);
create table if not exists xid_services(id uuid primary key default gen_random_uuid(), user_id uuid not null, organization_id uuid references organizations(id) on delete set null,
 service_type text not null check (service_type in ('professional','digital_card','business','company')), price_paid_minor integer not null, payment_id uuid references billing_payments(id), purchased_at timestamptz not null default now(), expires_at timestamptz not null, status text not null default 'active' check (status in ('active','expired','cancelled')));
alter table membership_plans enable row level security; alter table founding_slots enable row level security; alter table billing_customers enable row level security; alter table subscriptions enable row level security;
alter table billing_payments enable row level security; alter table billing_webhook_events enable row level security; alter table service_catalog enable row level security; alter table verification_requests enable row level security;
alter table boosts enable row level security; alter table marketplace_promotions enable row level security; alter table xid_services enable row level security;

-- Pricing seed (spec source of truth). (role, tier, std monthly, std annual, founding monthly, founding annual) in whole cedis.
do $$
declare r record; cap jsonb:='{"org_members":250,"active_projects":100,"job_postings_per_month":250,"org_admins":10,"collaborators_per_project":250}'; t jsonb; c jsonb;
begin
 for r in select * from (values
  ('worker','pro',30,288,20,192),('worker','premium',60,576,40,384),
  ('individual-employer','pro',100,960,70,672),('individual-employer','premium',200,1920,140,1344),('individual-employer','enterprise',450,4320,300,2880),
  ('business','pro',100,960,70,672),('business','premium',200,1920,140,1344),
  ('project-manager','pro',75,720,50,480),('project-manager','premium',150,1440,100,960),('project-manager','enterprise',350,3360,250,2400),
  ('company','pro',300,2880,220,2112),('company','premium',500,4800,350,3360),('company','enterprise',1000,9600,700,6720)
 ) v(role,tier,sm,sa,fm,fa) loop
  c := case when r.tier='enterprise' then cap else '{}'::jsonb end; t := case when r.tier='pro' then '{"trial_days":30}'::jsonb else '{}'::jsonb end;
  insert into membership_plans(role,tier,billing_interval,price_minor,is_founding,capacity_limits,metadata) values
   (r.role,r.tier,'monthly',r.sm*100,false,c,t),(r.role,r.tier,'annual',r.sa*100,false,c,t),(r.role,r.tier,'monthly',r.fm*100,true,c,t),(r.role,r.tier,'annual',r.fa*100,true,c,t) on conflict do nothing;
 end loop;
 insert into founding_slots(role,total_slots) values ('worker',1000),('individual-employer',250),('business',150),('project-manager',250),('company',50) on conflict do nothing;
 -- service_catalog seed: verification (worker 10/20/35, employer 10/20/35, business 25/50), profile boosts 2/5/10/15/25 (24h/3d/7d/14d/30d),
 -- job boosts 3/7/15/25 (durations 24h/3d/7d/14d ASSUMED, spec gave prices only), listing boosts 2/5/10/18/30, project boosts 15 (7d)/25 (14d),
 -- promotions 15/30/50/100, XID professional 20, digital card 10, business 30, company 50 per year. See the production table for the exact rows.
end $$;

-- Functions: see production. Key ones, in order of importance:
--   billing_apply_charge(reference, amount_minor, currency, tx_id, customer_code, auth_code, dedupe_key, payload)  -- service role only
--   billing_apply_event(type, dedupe_key, subscription_code, reference, amount_minor, payload)                     -- service role only
--   billing_sweep()                                                                                                -- service role, scheduled
--   billing_start_checkout(plan, org), billing_start_service(kind, code, target, org), billing_summary(org), my_payments(org),
--   cancel_subscription(org), schedule_downgrade(plan, org), effective_plan(user, org), founding_open(role)         -- signed-in users
