-- BAID X · Phase 7: wallet rails (Paystack deposits, role-gated deposit/withdraw, authorised withdrawals). Applied to project igfmmprlrybxsdzehwid.
-- Who can do what: worker, supplier(business), project-manager = receive (withdraw). client(individual-employer) = pay (deposit). company = both.
alter table public.billing_payments drop constraint billing_payments_purpose_check;
alter table public.billing_payments add constraint billing_payments_purpose_check check (purpose = any (array['subscription','verification','boost','promotion','xid','protected_payment_fee','wallet_deposit']));
alter table public.wallet_transactions drop constraint wallet_transactions_owner_role_check;
alter table public.wallet_transactions add constraint wallet_transactions_owner_role_check check (owner_role = any (array['worker','company','project_manager','business','platform','individual_employer']));
insert into public.platform_settings(key, value) values ('paystack_fee_rate', '0.0195'::jsonb), ('wallet_deposit_min_ghs', '5'::jsonb), ('wallet_deposit_max_ghs', '20000'::jsonb), ('wallet_withdraw_min_ghs', '10'::jsonb) on conflict (key) do nothing;

create or replace function public.wallet_caps() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', a.role, 'wallet_role', replace(a.role, '-', '_'),
    'can_deposit', a.role in ('company', 'individual-employer'),
    'can_withdraw', a.role in ('worker', 'company', 'project-manager', 'business'))
  from account_roles a where a.user_id = auth.uid() and a.role in ('worker','company','project-manager','business','individual-employer') limit 1 $$;

create or replace function public.wallet_deposit_quote(p_amount numeric) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := wallet_caps(); rate numeric; mn numeric; mx numeric; fee numeric; a numeric;
begin
  if auth.uid() is null or r is null or not (r->>'can_deposit')::boolean then raise exception 'adding money is not available for this account type'; end if;
  select coalesce((value #>> '{}')::numeric, 0.0195) into rate from platform_settings where key = 'paystack_fee_rate';
  select coalesce((value #>> '{}')::numeric, 5) into mn from platform_settings where key = 'wallet_deposit_min_ghs';
  select coalesce((value #>> '{}')::numeric, 20000) into mx from platform_settings where key = 'wallet_deposit_max_ghs';
  rate := coalesce(rate, 0.0195); mn := coalesce(mn, 5); mx := coalesce(mx, 20000);
  if p_amount is null or p_amount < mn or p_amount > mx then raise exception 'enter an amount between GH₵% and GH₵%', mn, mx; end if;
  a := round(p_amount, 2); fee := ceil(a * rate * 100) / 100;
  return jsonb_build_object('amount', a, 'fee', fee, 'total', a + fee, 'rate', rate, 'min', mn, 'max', mx);
end $$;

create or replace function public.wallet_start_deposit(p_amount numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare q jsonb; ref text; pid uuid; em text; total_minor int; credit_minor int; fee_minor int;
begin
  q := wallet_deposit_quote(p_amount);
  if (select count(*) from billing_payments where user_id = auth.uid() and purpose = 'wallet_deposit' and status = 'pending' and created_at > now() - interval '1 hour') >= 10 then raise exception 'too many unfinished payments; try again later'; end if;
  credit_minor := round((q->>'amount')::numeric * 100); fee_minor := round((q->>'fee')::numeric * 100); total_minor := credit_minor + fee_minor;
  select lower(email) into em from auth.users where id = auth.uid();
  ref := 'BXP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into billing_payments(user_id, amount_minor, expected_amount_minor, currency, provider_reference, purpose, target, status)
    values (auth.uid(), 0, total_minor, 'GHS', ref, 'wallet_deposit', jsonb_build_object('credit_minor', credit_minor, 'fee_minor', fee_minor), 'pending') returning id into pid;
  perform _billing_audit('payment.initiated', auth.uid(), null, 'billing_payment', pid::text, ref, jsonb_build_object('purpose', 'wallet_deposit', 'amount_minor', total_minor));
  return jsonb_build_object('payment_id', pid, 'reference', ref, 'amount_minor', total_minor, 'credit_minor', credit_minor, 'fee_minor', fee_minor, 'currency', 'GHS', 'email', em);
end $$;

create or replace function public._wallet_credit_deposit(pay public.billing_payments) returns void language plpgsql security definer set search_path = public as $$
declare v_role text; amt numeric := (pay.target->>'credit_minor')::numeric / 100;
begin
  select replace(role, '-', '_') into v_role from account_roles where user_id = pay.user_id and role in ('company', 'individual-employer') limit 1;
  if v_role is null or amt is null or amt <= 0 then raise exception 'wallet credit refused for payment %', pay.provider_reference; end if;
  insert into wallet_accounts(owner_role, owner_id, available_ghs) values (v_role, pay.user_id, amt)
    on conflict (owner_role, owner_id) do update set available_ghs = wallet_accounts.available_ghs + amt, updated_at = now();
  insert into wallet_transactions(public_id, owner_role, owner_id, type, amount_ghs, net_ghs, status, description, payment_ref, idempotency_key)
    values ('BXD-TX-' || upper(substr(md5(random()::text || pay.id::text), 1, 8)), v_role, pay.user_id, 'deposit', amt, amt, 'completed', 'Added with Paystack', pay.provider_reference, 'paystack:' || pay.id::text);
  perform notify_user(pay.user_id, 'wallet', 'Money added', 'GH₵ ' || to_char(amt, 'FM999,990.00') || ' is in your wallet', '#/wallet', '{}');
  perform _billing_audit('wallet.credited', pay.user_id, null, 'billing_payment', pay.id::text, pay.provider_reference, jsonb_build_object('amount_ghs', amt));
end $$;
-- _billing_fulfil gained one line at the top:  if pay.purpose='wallet_deposit' then perform _wallet_credit_deposit(pay); return; end if;
-- request_withdrawal now enforces: minimum (platform_settings.wallet_withdraw_min_ghs), a valid network, a 9-12 digit number, an account name.
grant execute on function public.wallet_caps() to authenticated; grant execute on function public.wallet_deposit_quote(numeric) to authenticated; grant execute on function public.wallet_start_deposit(numeric) to authenticated;
revoke execute on function public.wallet_caps() from anon, public; revoke execute on function public.wallet_deposit_quote(numeric) from anon, public; revoke execute on function public.wallet_start_deposit(numeric) from anon, public;
revoke execute on function public._wallet_credit_deposit(public.billing_payments) from public, anon, authenticated;
revoke execute on function public.request_deposit(numeric, text, text) from public, anon, authenticated;  -- manual MoMo deposits are retired; deposits go through Paystack
