-- Phase 22: service prices in step with the plans (owner asked on 12 October 2026: the old ones,
-- GH₵2 boosts and GH₵10 checks, looked like a joke next to GH₵200 to GH₵6,000 plans), and only
-- services that deliver something stay on sale. Non-destructive: rows are switched off, never deleted.
--
-- Verification (one-off review, pays for the check, not the result):
--   worker / client: Identity 50, Professional 120, Advanced or Enhanced 250; business: 250 / 500.
-- Boosts (Featured, shown first in Discover or the job list for the time bought):
--   worker profile 15 / 40 / 80 / 140 / 250 (1, 3, 7, 14, 30 days)
--   project manager profile 25 / 60 / 120 / 200 / 350
--   supplier profile 30 / 80 / 160 / 280 / 500 (was "listing boost"; listings have no ranking yet, the profile does)
--   job (companies and clients) 30 / 75 / 150 / 250 (1, 3, 7, 14 days)
-- Off sale until the feature behind them exists: project boosts, marketplace promotions, XID cards.

update public.service_catalog set price_minor = v.p * 100 from (values
  ('verification', 'identity', 'worker', 50), ('verification', 'professional', 'worker', 120), ('verification', 'advanced', 'worker', 250),
  ('verification', 'identity', 'individual-employer', 50), ('verification', 'professional', 'individual-employer', 120), ('verification', 'enhanced', 'individual-employer', 250),
  ('verification', 'standard', 'business', 250), ('verification', 'enhanced', 'business', 500),
  ('boost', 'profile_24h', 'worker', 15), ('boost', 'profile_3d', 'worker', 40), ('boost', 'profile_7d', 'worker', 80), ('boost', 'profile_14d', 'worker', 140), ('boost', 'profile_30d', 'worker', 250),
  ('boost', 'profile_24h', 'project-manager', 25), ('boost', 'profile_3d', 'project-manager', 60), ('boost', 'profile_7d', 'project-manager', 120), ('boost', 'profile_14d', 'project-manager', 200), ('boost', 'profile_30d', 'project-manager', 350),
  ('boost', 'listing_24h', 'business', 30), ('boost', 'listing_3d', 'business', 80), ('boost', 'listing_7d', 'business', 160), ('boost', 'listing_14d', 'business', 280), ('boost', 'listing_30d', 'business', 500),
  ('boost', 'job_24h', null, 30), ('boost', 'job_3d', null, 75), ('boost', 'job_7d', null, 150), ('boost', 'job_14d', null, 250)
) as v(kind, code, role, p)
where service_catalog.kind = v.kind and service_catalog.code = v.code and service_catalog.role is not distinct from v.role;

-- a supplier boost lifts the supplier's profile (what Discover ranks)
update public.service_catalog set metadata = metadata || '{"target":"business_profile"}'::jsonb,
  label = replace(label, 'Listing boost', 'Profile boost')
where kind = 'boost' and role = 'business';

update public.service_catalog set is_active = false
where kind in ('promotion', 'xid') or (kind = 'boost' and metadata->>'target' = 'project');

-- What each plan includes: only what BAID X does today (limits by trigger, plan mark and Discover order by promoted()).
update public.membership_plans set metadata = metadata || jsonb_build_object('benefits', case
  when tier = 'pro' and role = 'worker' then '[{"t":"Unlimited job applications","d":"Apply to as many jobs as you want. Access includes 5 a month."},{"t":"Pro mark on your profile","d":"Shown beside your name on your card and profile."},{"t":"Listed before free members","d":"You come ahead of Access members in Discover."},{"t":"Priority support","d":"Faster answers from the BAID X team on WhatsApp and email."}]'::jsonb
  when tier = 'pro' and role in ('company', 'individual-employer') then '[{"t":"Unlimited open job posts","d":"Post as many jobs as you need at once. Access includes 1."},{"t":"Pro mark on your profile","d":"Shown beside your name on your card and profile."},{"t":"Listed before free members","d":"You come ahead of Access members in Discover."},{"t":"Priority support","d":"Faster answers from the BAID X team on WhatsApp and email."}]'::jsonb
  when tier = 'pro' then '[{"t":"Pro mark on your profile","d":"Shown beside your name on your card and profile."},{"t":"Listed before free members","d":"You come ahead of Access members in Discover."},{"t":"Priority support","d":"Faster answers from the BAID X team on WhatsApp and email."}]'::jsonb
  when tier = 'premium' then '[{"t":"Everything in Pro","d":"No limits, Pro placement and priority support."},{"t":"Premium mark on your profile","d":"Shown beside your name on your card and profile."},{"t":"Listed above Pro members","d":"Only boosted profiles and Enterprise come before you in Discover."},{"t":"First in line for help","d":"Your questions and disputes are handled first."}]'::jsonb
  else '[{"t":"Everything in Premium","d":"No limits, first in line for help."},{"t":"Enterprise mark and top placement","d":"Listed first among paid members in Discover."},{"t":"Your team on one account","d":"Bring admins and members into one organization with the limits below."},{"t":"A named contact at BAID X","d":"One person on our team who knows your account."}]'::jsonb
end)
where is_active;

-- A job boost must name one of the buyer's own open jobs; a profile boost is always the buyer's own profile.
create or replace function public.billing_start_service(p_kind text, p_code text, p_target jsonb default '{}'::jsonb, p_org uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare urole text; sc service_catalog; em text; ref text; pid uuid; purpose text; detail jsonb := coalesce(p_target, '{}'::jsonb); begin
 if auth.uid() is null then raise exception 'sign in required'; end if;
 select role into urole from account_roles where user_id=auth.uid() limit 1;
 select * into sc from service_catalog where kind=p_kind and code=p_code and is_active and (role is null or role=urole) order by (role is null) limit 1;
 if not found then raise exception 'service not available for your account'; end if;
 if p_kind = 'boost' and sc.metadata->>'target' = 'job' then
   if urole not in ('company', 'individual-employer') then raise exception 'Only companies and clients can boost a job.'; end if;
   if not exists (select 1 from jobs j where j.id = nullif(detail->>'target_id','')::uuid and coalesce(j.company_id, j.employer_id) = auth.uid() and j.status = 'open') then
     raise exception 'Choose one of your open jobs to boost.'; end if;
   detail := jsonb_build_object('target_id', detail->>'target_id');
 elsif p_kind = 'boost' then
   detail := '{}'::jsonb;
 end if;
 purpose:=case p_kind when 'verification' then 'verification' when 'boost' then 'boost' when 'promotion' then 'promotion' else 'xid' end;
 select lower(email) into em from auth.users where id=auth.uid();
 ref:='BXP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
 insert into billing_payments(user_id,organization_id,amount_minor,expected_amount_minor,currency,provider_reference,purpose,target,status)
  values (auth.uid(),p_org,0,sc.price_minor,sc.currency,ref,purpose,jsonb_build_object('catalog_id',sc.id,'detail',detail),'pending') returning id into pid;
 perform _billing_audit('payment.initiated',auth.uid(),p_org,'billing_payment',pid::text,ref,jsonb_build_object('service',p_kind||':'||p_code,'amount_minor',sc.price_minor));
 return jsonb_build_object('payment_id',pid,'reference',ref,'amount_minor',sc.price_minor,'currency',sc.currency,'email',em,'label',sc.label); end $$;

-- The member's own receipts with what each payment was for (Plans & billing → Payments).
create or replace function public.my_receipts() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'reference', p.provider_reference, 'purpose', p.purpose, 'status', p.status, 'currency', p.currency, 'created_at', p.created_at,
      'amount_minor', case when coalesce(p.amount_minor, 0) > 0 then p.amount_minor else p.expected_amount_minor end,
      'what', case p.purpose
        when 'subscription' then (select initcap(pl.tier) || ' plan, ' || case pl.billing_interval when 'annual' then 'yearly' else 'monthly' end from membership_plans pl where pl.id = (p.target->>'plan_id')::uuid)
        when 'wallet_deposit' then 'Wallet top-up'
        else (select c.label from service_catalog c where c.id = (p.target->>'catalog_id')::uuid) end,
      'about', case when p.purpose = 'boost' then (select j.title from jobs j where j.id = (p.target->'detail'->>'target_id')::uuid) end)
    order by p.created_at desc), '[]'::jsonb)
  from (select * from billing_payments where user_id = auth.uid() and organization_id is null order by created_at desc limit 100) p;
$$;
revoke all on function public.my_receipts() from public, anon;
grant execute on function public.my_receipts() to authenticated;
