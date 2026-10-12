-- Phase 20: new plan prices (approved by the owner on 12 October 2026), no free trial, and
-- the free Access plan's limits. No subscriber existed when this ran, so nobody's price changed.
--
-- Monthly (GH₵): worker Pro 200 / Premium 350; project manager 300 / 500 / Enterprise 900;
-- client 250 / 450 / Enterprise 900; supplier 600 / 1,200; company 1,500 / 3,000 / Enterprise 6,000.
-- Founding = 70% of the price for the first 12 months. Annual = 10 x monthly (2 months free).
-- paystack_plan_code is cleared so Admin -> "Create Paystack plans" makes plans at the new
-- amounts (paystack-initialize only attaches a plan code whose amount matches the checkout).

with price(role, tier, monthly_ghs) as (values
  ('worker', 'pro', 200), ('worker', 'premium', 350),
  ('project-manager', 'pro', 300), ('project-manager', 'premium', 500), ('project-manager', 'enterprise', 900),
  ('individual-employer', 'pro', 250), ('individual-employer', 'premium', 450), ('individual-employer', 'enterprise', 900),
  ('business', 'pro', 600), ('business', 'premium', 1200),
  ('company', 'pro', 1500), ('company', 'premium', 3000), ('company', 'enterprise', 6000)
)
update public.membership_plans m set
  price_minor = (p.monthly_ghs * 100 * (case when m.is_founding then 0.7 else 1 end) * (case when m.billing_interval = 'annual' then 10 else 1 end))::int,
  metadata = (coalesce(m.metadata, '{}'::jsonb) - 'trial_days'),
  paystack_plan_code = null,
  updated_at = now()
from price p where p.role = m.role and p.tier = m.tier;

-- What each plan includes (shown in "See what you get"). Only things BAID X does today.
update public.membership_plans set metadata = metadata || jsonb_build_object(
  'best_for', case tier when 'pro' then 'Members who use BAID X every week and want no limits.' when 'premium' then 'Busy members running several jobs or projects at once.' else 'Firms and teams that work on BAID X together.' end,
  'benefits', case
    when role = 'worker' and tier = 'pro' then '[{"t":"Unlimited job applications","d":"Apply to as many jobs as you want each month. Access includes 5."},{"t":"Priority support","d":"Faster answers from the BAID X team on WhatsApp and email."}]'::jsonb
    when role = 'worker' then '[{"t":"Everything in Pro","d":"Unlimited job applications and priority support."},{"t":"First in line for help","d":"Your questions and disputes are handled first."}]'::jsonb
    when role in ('company', 'individual-employer') and tier = 'pro' then '[{"t":"Unlimited open job posts","d":"Post as many jobs as you need at the same time. Access includes 1."},{"t":"Priority support","d":"Faster answers from the BAID X team on WhatsApp and email."}]'::jsonb
    when role in ('company', 'individual-employer') and tier = 'premium' then '[{"t":"Everything in Pro","d":"Unlimited open job posts and priority support."},{"t":"First in line for help","d":"Your questions and disputes are handled first."}]'::jsonb
    when tier = 'enterprise' then '[{"t":"Everything in Premium","d":"No limits on job posts, first in line for help."},{"t":"Your team on one account","d":"Bring admins and members into one organization with the limits below."},{"t":"A named contact at BAID X","d":"One person on our team who knows your account."}]'::jsonb
    when tier = 'pro' then '[{"t":"Priority support","d":"Faster answers from the BAID X team on WhatsApp and email."}]'::jsonb
    else '[{"t":"Everything in Pro","d":"Priority support."},{"t":"First in line for help","d":"Your questions and disputes are handled first."}]'::jsonb
  end)
where is_active;

-- Free Access plan limits, checked in the database so the website and the app can't differ.
create or replace function public._has_paid_plan(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user and s.organization_id is null
      and (s.status in ('trialing', 'active', 'past_due')
           or (s.status = 'grace_period' and coalesce(s.grace_until, now()) > now())
           or (s.status = 'cancel_at_period_end' and s.current_period_end > now())));
$$;
revoke all on function public._has_paid_plan(uuid) from public, anon, authenticated;

-- Access: 5 job applications per calendar month (Ghana time).
create or replace function public._access_application_limit() returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if public._has_paid_plan(new.worker_id) then return new; end if;
  select count(*) into n from public.job_applications a
   where a.worker_id = new.worker_id and a.created_at >= date_trunc('month', now() at time zone 'Africa/Accra') at time zone 'Africa/Accra';
  if n >= 5 then
    raise exception 'The free plan includes 5 job applications a month. Upgrade to Pro in Plans & billing to apply to more jobs.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Access: 1 open job post at a time (for the account that owns the post).
create or replace function public._access_open_job_limit() returns trigger language plpgsql security definer set search_path = '' as $$
declare owner uuid := coalesce(new.employer_id, new.company_id); n int;
begin
  if new.status is distinct from 'open' or owner is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'open' then return new; end if; -- editing an already open post
  if public._has_paid_plan(owner) then return new; end if;
  select count(*) into n from public.jobs j where coalesce(j.employer_id, j.company_id) = owner and j.status = 'open' and j.id is distinct from new.id;
  if n >= 1 then
    raise exception 'The free plan includes 1 open job post. Close your open job or upgrade to Pro in Plans & billing to post more.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public._access_application_limit() from public, anon, authenticated;
revoke all on function public._access_open_job_limit() from public, anon, authenticated;

drop trigger if exists access_application_limit on public.job_applications;
create trigger access_application_limit before insert on public.job_applications for each row execute function public._access_application_limit();
drop trigger if exists access_open_job_limit on public.jobs;
create trigger access_open_job_limit before insert or update of status on public.jobs for each row execute function public._access_open_job_limit();
