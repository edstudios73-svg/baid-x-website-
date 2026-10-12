-- Phase 21: what paying gets you is visible and lapses on time.
--  1. public.promoted(): who has a paid plan (tier only) and what is boosted right now. Public on purpose:
--     the Pro mark and the ranking in Discover and the job list are the point of paying. Nothing else is exposed.
--  2. billing_sweep(): a plan whose paid period ended without a renewal (Mobile Money and bank are one-off
--     payments; a card that failed) moves to the 7-day grace period, then to suspended. Runs every 30 minutes.
--  3. admin_billing_payments(): every Paystack checkout with the member's name, for Admin -> Finance -> Paystack.
-- Non-destructive: no table or row is removed.

create or replace function public.promoted() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', x.uid, 'tier', x.tier)) from (
      select distinct on (s.user_id) s.user_id uid, pl.tier
        from public.subscriptions s join public.membership_plans pl on pl.id = s.membership_plan_id
       where s.organization_id is null
         and (s.status in ('trialing', 'active', 'past_due')
              or (s.status = 'grace_period' and coalesce(s.grace_until, now()) > now())
              or (s.status = 'cancel_at_period_end' and s.current_period_end > now()))
       order by s.user_id, case pl.tier when 'enterprise' then 3 when 'premium' then 2 else 1 end desc) x), '[]'::jsonb),
    'boosts', coalesce((select jsonb_agg(jsonb_build_object('type', b.target_type, 'id', b.target_id, 'until', b.expires_at))
      from public.boosts b where b.starts_at <= now() and b.expires_at > now()), '[]'::jsonb));
$$;
revoke all on function public.promoted() from public;
grant execute on function public.promoted() to anon, authenticated;

create or replace function public.billing_sweep() returns jsonb language plpgsql security definer set search_path = public as $$
declare e int:=0; d int:=0; g int:=0; l int:=0; s subscriptions; begin
 for s in select * from subscriptions where status='cancel_at_period_end' and current_period_end<=now() for update loop
  update subscriptions set status='cancelled',cancelled_at=now(),updated_at=now() where id=s.id; e:=e+1;
  perform _billing_audit('subscription.cancellation_effective',s.user_id,s.organization_id,'subscription',s.id::text,null); end loop;
 for s in select * from subscriptions where status='grace_period' and grace_until<=now() for update loop
  update subscriptions set status='suspended',updated_at=now() where id=s.id; g:=g+1;
  perform _billing_audit('subscription.suspended',s.user_id,s.organization_id,'subscription',s.id::text,null); end loop;
 for s in select * from subscriptions where status='active' and scheduled_plan_id is not null and current_period_end<=now() for update loop
  update subscriptions set membership_plan_id=scheduled_plan_id,scheduled_plan_id=null,current_period_start=current_period_end,
    current_period_end=current_period_end+(select case billing_interval when 'annual' then interval '1 year' else interval '1 month' end from membership_plans where id=s.scheduled_plan_id),updated_at=now() where id=s.id; d:=d+1;
  perform _billing_audit('subscription.downgraded',s.user_id,s.organization_id,'subscription',s.id::text,null,jsonb_build_object('plan',s.scheduled_plan_id)); end loop;
 -- paid period over and no renewal arrived (a card renewal normally lands on the day, so wait one day first)
 for s in select * from subscriptions where status in ('active','past_due') and scheduled_plan_id is null and current_period_end + interval '1 day' <= now() for update loop
  update subscriptions set status='grace_period',grace_until=current_period_end+interval '7 days',updated_at=now() where id=s.id; l:=l+1;
  perform _billing_audit('subscription.lapsed',s.user_id,s.organization_id,'subscription',s.id::text,null); end loop;
 update xid_services set status='expired' where status='active' and expires_at<=now();
 return jsonb_build_object('cancelled',e,'suspended',g,'downgraded',d,'lapsed',l); end $$;
revoke all on function public.billing_sweep() from public, anon, authenticated;

select cron.unschedule('billing-sweep') where exists (select 1 from cron.job where jobname = 'billing-sweep');
select cron.schedule('billing-sweep', '*/30 * * * *', 'select public.billing_sweep()');

create or replace function public.admin_billing_payments(p_limit int default 200) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not platform_perm('finance', 'VIEW', auth.uid()) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'ref', p.provider_reference, 'purpose', p.purpose, 'status', p.status, 'amount', case when coalesce(p.amount_minor, 0) > 0 then p.amount_minor else p.expected_amount_minor end,
      'currency', p.currency, 'member', coalesce(public._person_name(p.user_id), '—'), 'role', (select role from account_roles where user_id = p.user_id limit 1),
      'what', case p.purpose
        when 'subscription' then (select initcap(pl.tier) || ' plan, ' || pl.billing_interval from membership_plans pl where pl.id = (p.target->>'plan_id')::uuid)
        when 'wallet_deposit' then 'Wallet top-up'
        else (select c.label from service_catalog c where c.id = (p.target->>'catalog_id')::uuid) end,
      'about', case when p.purpose = 'boost' then (select j.title from jobs j where j.id = (p.target->'detail'->>'target_id')::uuid) end,
      'created_at', p.created_at, 'confirmed_at', p.confirmed_at) order by p.created_at desc)
    from (select * from billing_payments order by created_at desc limit greatest(1, least(p_limit, 500))) p), '[]'::jsonb);
end $$;
revoke all on function public.admin_billing_payments(int) from public, anon;
grant execute on function public.admin_billing_payments(int) to authenticated;
