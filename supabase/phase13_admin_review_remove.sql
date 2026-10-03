-- Phase 13: full member review for admins, account removal, and the BAID X Admin identity in chats.

-- Staff accounts appear in member chats as "BAID X Admin" with the BAID X mark.
create or replace function public._is_staff(uid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from admin_users where id = uid) $$;

create or replace function public._chat_name(uid uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select case when public._is_staff(uid) then 'BAID X Admin' else coalesce(public._person_name(uid), 'BAID X member') end $$;

create or replace function public._chat_photo(uid uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select case when public._is_staff(uid) then '/assets/favicon.png' else public._person_photo(uid) end $$;

create or replace function public.my_conversations() returns jsonb
language sql stable security definer set search_path to 'public' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'subject',c.subject,'last_message_at',c.last_message_at,'preview',c.last_message_preview,'unread',cp.unread_count,
   'peer_id',pe.user_id,'peer_name',public._chat_name(pe.user_id),'peer_role',case when public._is_staff(pe.user_id) then 'BAID X support' else pe.participant_role end,
   'peer_photo',public._chat_photo(pe.user_id),'peer_admin',public._is_staff(pe.user_id)) order by c.last_message_at desc nulls last),'[]')
 from conversation_participants cp join conversations c on c.id=cp.conversation_id
 left join lateral (select user_id,participant_role from conversation_participants x where x.conversation_id=c.id and x.user_id<>auth.uid() order by x.user_id limit 1) pe on true
 where cp.user_id=auth.uid() and cp.deleted_at is null $$;

create or replace function public.chat_thread(p_conv uuid, p_before timestamptz default null, p_limit integer default 60) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
 if not exists(select 1 from conversation_participants where conversation_id=p_conv and user_id=auth.uid() and deleted_at is null) then raise exception 'not allowed'; end if;
 return jsonb_build_object(
  'peer',(select jsonb_build_object('id',x.user_id,'name',public._chat_name(x.user_id),'role',case when public._is_staff(x.user_id) then 'BAID X support' else x.participant_role end,
     'photo',public._chat_photo(x.user_id),'admin',public._is_staff(x.user_id),'last_read_at',x.last_read_at) from conversation_participants x where x.conversation_id=p_conv and x.user_id<>auth.uid() limit 1),
  'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sender',m.sender_id,'mine',m.sender_id=auth.uid(),'body',m.body,'type',m.message_type,'v',coalesce(m.encryption_version,0),'at',m.created_at,'client',m.client_id,
     'att',(select coalesce(jsonb_agg(jsonb_build_object('path',a.storage_path,'name',a.file_name,'mime',a.mime_type,'size',a.size_bytes,'dur',a.duration_ms)),'[]') from message_attachments a where a.message_id=m.id)) order by m.created_at),'[]')
   from (select * from messages where conversation_id=p_conv and deleted_at is null and (p_before is null or created_at<p_before) order by created_at desc limit least(p_limit,200)) m)); end $$;

-- Everything an admin needs to judge a member before deciding.
create or replace function public.admin_user_detail(p_role text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare t text:=_role_table(p_role); prof jsonb; begin perform _adm();
 if t is null then raise exception 'invalid role'; end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1',t) into prof using p_id;
 if prof is null then raise exception 'profile not found'; end if;
 return jsonb_build_object(
  'role',p_role,'profile',prof,
  'auth',(select jsonb_build_object('email',case when u.email ~ '\.invalid$' then null else u.email end,'email_confirmed',u.email_confirmed_at is not null,'phone',u.phone,'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at) from auth.users u where u.id=p_id),
  'wallet',(select jsonb_build_object('available',coalesce(sum(available_ghs),0),'pending',coalesce(sum(pending_ghs),0),'earned',coalesce(sum(lifetime_earned_ghs),0),'spent',coalesce(sum(lifetime_spent_ghs),0)) from wallet_accounts where owner_id=p_id),
  'escrow_held',(select coalesce(sum(amount_ghs),0) from escrow_holds where (payer_id=p_id or receiver_id=p_id) and status in ('locked','disputed')),
  'plan',(select jsonb_build_object('tier',p.tier,'status',s.status,'until',s.current_period_end) from subscriptions s join membership_plans p on p.id=s.membership_plan_id where s.user_id=p_id order by s.created_at desc limit 1),
  'counts',jsonb_build_object(
    'jobs_posted',(select count(*) from jobs where company_id=p_id or employer_id=p_id),
    'applications',(select count(*) from job_applications where worker_id=p_id),
    'engagements',(select count(*) from job_engagements where worker_id=p_id or payer_id=p_id),
    'orders',(select count(*) from orders where buyer_id=p_id or business_id=p_id),
    'projects',(select count(*) from projects where company_id=p_id or pm_id=p_id),
    'messages',(select count(*) from messages where sender_id=p_id),
    'reports_against',(select count(*) from reports where target_id=p_id::text),
    'reports_made',(select count(*) from reports where reporter_id=p_id)),
  'reviews',(select coalesce(jsonb_agg(jsonb_build_object('decision',r.decision,'reason',r.reason,'at',r.created_at,'by',(select full_name from admin_users where id=r.reviewer_id)) order by r.created_at desc),'[]') from (select * from verification_reviews where profile_id=p_id order by created_at desc limit 10) r),
  'requests',(select coalesce(jsonb_agg(jsonb_build_object('type',v.verification_type,'status',v.status,'at',v.requested_at,'paid',v.price_paid_minor) order by v.requested_at desc),'[]') from (select * from verification_requests where user_id=p_id order by requested_at desc limit 10) v),
  'logins',(select coalesce(jsonb_agg(jsonb_build_object('type',l.event_type,'at',l.created_at) order by l.created_at desc),'[]') from (select * from login_events where user_id=p_id order by created_at desc limit 5) l));
end $$;

-- Account removal, step 1 (runs as the calling admin): super admins only, refuses while the member still has
-- wallet money or escrow, keeps a company's projects when a project manager is removed, and writes the audit entry.
-- Step 2 lives in api/admin-users.js: with the service key it clears the rows that reference the member without
-- cascading (project invitations, task updates, reports, requests, payments, completion requests, reviews,
-- company_pm_links.requested_by) and deletes the auth user, which cascades to the profile and everything it owns.
create or replace function public.admin_remove_prepare(p_role text, p_id uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare t text:=_role_table(p_role); nm text; ph text; bal numeric; held numeric; begin perform _adm();
 if platform_role() is distinct from 'super_admin' then raise exception 'Only a super admin can remove accounts.'; end if;
 if t is null then raise exception 'invalid role'; end if;
 if p_id = auth.uid() or exists(select 1 from admin_users where id=p_id) then raise exception 'Staff accounts can''t be removed here.'; end if;
 if coalesce(p_confirm,'') <> 'REMOVE' then raise exception 'Type REMOVE to confirm.'; end if;
 if not exists(select 1 from auth.users where id=p_id) then raise exception 'This account no longer exists.'; end if;
 select coalesce(sum(available_ghs+pending_ghs),0) into bal from wallet_accounts where owner_id=p_id;
 if bal > 0 then raise exception 'This member still has GH₵% in their wallet. Pay it out before removing the account.', to_char(bal,'FM999999990.00'); end if;
 select coalesce(sum(amount_ghs),0) into held from escrow_holds where (payer_id=p_id or receiver_id=p_id) and status in ('locked','disputed');
 if held > 0 then raise exception 'GH₵% is held in escrow on this member''s jobs or orders. Release or refund it first.', to_char(held,'FM999999990.00'); end if;
 nm := public._person_name(p_id); select phone into ph from auth.users where id=p_id;
 update projects set pm_id=null where pm_id=p_id;
 perform _audit('account.removed','profile',p_id::text,jsonb_build_object('name',nm,'role',p_role,'phone',ph),null,jsonb_build_object('role',p_role));
 return jsonb_build_object('ok',true,'name',nm);
end $$;

revoke all on function public.admin_user_detail(text,uuid) from public, anon;
revoke all on function public.admin_remove_prepare(text,uuid,text) from public, anon;
grant execute on function public.admin_user_detail(text,uuid) to authenticated;
grant execute on function public.admin_remove_prepare(text,uuid,text) to authenticated;
