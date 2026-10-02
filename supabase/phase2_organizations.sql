-- BAID X Phase 2: organizations, credential profiles, permissions, invitations, audit.
-- Already applied to the production project. Kept here so the database can be rebuilt.
-- Deny by default: no table below has a write policy; every change goes through a function.

create table if not exists organizations(
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 2 and 120),
 org_type text not null default 'company',
 owner_id uuid not null,
 status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','CLOSED')),
 public_code text unique not null default ('BXD-ORG-'||upper(substr(md5(random()::text),1,5))),
 created_at timestamptz not null default now());
create table if not exists org_roles(
 key text primary key, label text not null, tier text not null check (tier in ('platform','organization')),
 privileged boolean not null default false, description text not null default '', sort int not null default 0, rank int not null default 9);
create table if not exists role_permissions(
 role_key text not null references org_roles(key) on delete cascade,
 resource text not null, action text not null check (action in ('VIEW','CREATE','EDIT','ASSIGN','APPROVE','DELETE','EXPORT','ADMINISTER')),
 scope text not null check (scope in ('SELF','TEAM','DEPARTMENT','PROJECT','ORGANIZATION','GLOBAL_PLATFORM')),
 primary key(role_key,resource,action));
create table if not exists departments(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade, name text not null, unique(org_id,name));
create table if not exists org_teams(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id) on delete cascade, department_id uuid references departments(id) on delete set null, name text not null, unique(org_id,name));
create table if not exists org_members(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references organizations(id) on delete cascade,
 user_id uuid not null,
 role_key text not null references org_roles(key),
 status text not null default 'ACTIVE' check (status in ('INVITED','PENDING_VERIFICATION','ACTIVE','SUSPENDED','DISABLED','REVOKED')),
 department_id uuid references departments(id) on delete set null,
 team_id uuid references org_teams(id) on delete set null,
 invited_by uuid, status_reason text, created_at timestamptz not null default now(), status_changed_at timestamptz,
 unique(org_id,user_id));
create table if not exists org_invitations(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references organizations(id) on delete cascade,
 invitee_email text, invitee_phone text, invitee_user uuid,
 role_key text not null references org_roles(key),
 token_hash text not null unique,
 status text not null default 'INVITED' check (status in ('INVITED','ACCEPTED','REVOKED','EXPIRED')),
 expires_at timestamptz not null default now()+interval '7 days',
 invited_by uuid not null, accepted_by uuid, created_at timestamptz not null default now(),
 check (invitee_email is not null or invitee_phone is not null or invitee_user is not null));
create index if not exists org_members_user on org_members(user_id);
create table if not exists bx_settings(key text primary key, value text not null);
insert into bx_settings values ('enforce_mfa','false') on conflict do nothing;
alter table projects add column if not exists org_id uuid references organizations(id) on delete set null;
alter table organizations enable row level security; alter table org_roles enable row level security; alter table role_permissions enable row level security;
alter table departments enable row level security; alter table org_teams enable row level security; alter table org_members enable row level security;
alter table org_invitations enable row level security; alter table bx_settings enable row level security;

-- 23 credential profiles (8 platform, 15 organization). rank: a person can only grant roles ranked below their own.
insert into org_roles(key,label,tier,privileged,description,sort,rank) values
('super_admin','Super Admin','platform',true,'Full platform control',1,0),
('platform_admin','Platform Admin','platform',true,'Runs platform operations and staff',2,1),
('ops_admin','Operations Admin','platform',true,'Day-to-day operations and disputes',3,2),
('finance_admin','Platform Finance','platform',true,'Platform payments and payouts oversight',4,2),
('verification_officer','Verification Officer','platform',false,'Reviews identity and business documents',5,3),
('moderator','Moderator','platform',false,'Moderates content and reports',6,3),
('support_agent','Support Agent','platform',false,'Helps users, read-mostly',7,4),
('platform_auditor','Platform Auditor','platform',false,'Read-only audit access',8,4),
('org_owner','Organization Owner','organization',true,'Owns the organization and everything in it',10,0),
('org_admin','Organization Admin','organization',true,'Manages people, roles and settings',11,1),
('hr_manager','HR Manager','organization',false,'Manages members and invitations',12,3),
('finance_manager','Finance Manager','organization',true,'Approves requests and payments',13,2),
('accountant','Accountant','organization',false,'Records payments, exports finance',14,4),
('operations_manager','Operations Manager','organization',false,'Oversees all projects',15,2),
('project_director','Project Director','organization',false,'Directs projects and approves completion',16,2),
('project_manager','Project Manager','organization',false,'Runs assigned projects',17,4),
('team_lead','Team Lead','organization',false,'Leads a team on a project',18,5),
('supervisor','Supervisor','organization',false,'Supervises workers on site',19,5),
('procurement_officer','Procurement Officer','organization',false,'Raises material and equipment requests',20,4),
('site_engineer','Site Engineer','organization',false,'Technical reports and tasks',21,5),
('worker','Worker','organization',false,'Does assigned work',22,6),
('client_viewer','Client Viewer','organization',false,'Read-only view of projects and reports',23,6),
('external_auditor','External Auditor','organization',false,'Read-only finance and audit, can export',24,6)
on conflict do nothing;

with g(role_key,resources,actions,scope) as (values
 ('super_admin',array['platform','users','organizations','verification','finance','audit','support','projects','roles'],array['VIEW','CREATE','EDIT','ASSIGN','APPROVE','DELETE','EXPORT','ADMINISTER'],'GLOBAL_PLATFORM'),
 ('platform_admin',array['platform','users','organizations','verification','finance','audit','support','projects'],array['VIEW','CREATE','EDIT','ASSIGN','APPROVE','EXPORT'],'GLOBAL_PLATFORM'),
 ('ops_admin',array['users','organizations','projects','support'],array['VIEW','EDIT','ASSIGN','APPROVE'],'GLOBAL_PLATFORM'),
 ('finance_admin',array['finance','organizations'],array['VIEW','APPROVE','EXPORT'],'GLOBAL_PLATFORM'),
 ('verification_officer',array['verification','users'],array['VIEW','EDIT','APPROVE'],'GLOBAL_PLATFORM'),
 ('moderator',array['users','projects','support'],array['VIEW','EDIT'],'GLOBAL_PLATFORM'),
 ('support_agent',array['users','organizations','projects','support'],array['VIEW'],'GLOBAL_PLATFORM'),
 ('platform_auditor',array['users','organizations','projects','finance','audit'],array['VIEW','EXPORT'],'GLOBAL_PLATFORM'),
 ('org_owner',array['organization','members','invitations','roles','projects','tasks','reports','finance','payments','documents','audit'],array['VIEW','CREATE','EDIT','ASSIGN','APPROVE','DELETE','EXPORT','ADMINISTER'],'ORGANIZATION'),
 ('org_admin',array['organization','members','invitations','roles','projects','tasks','reports','documents','audit'],array['VIEW','CREATE','EDIT','ASSIGN','EXPORT'],'ORGANIZATION'),
 ('hr_manager',array['members','invitations'],array['VIEW','CREATE','EDIT','ASSIGN'],'ORGANIZATION'),
 ('finance_manager',array['finance','payments','projects','reports'],array['VIEW','CREATE','EDIT','APPROVE','EXPORT'],'ORGANIZATION'),
 ('accountant',array['finance','payments'],array['VIEW','CREATE','EXPORT'],'ORGANIZATION'),
 ('operations_manager',array['projects','tasks','reports','members'],array['VIEW','CREATE','EDIT','ASSIGN'],'ORGANIZATION'),
 ('project_director',array['projects','tasks','reports','finance','members'],array['VIEW','CREATE','EDIT','ASSIGN','APPROVE'],'ORGANIZATION'),
 ('project_manager',array['projects','tasks','reports'],array['VIEW','CREATE','EDIT','ASSIGN'],'PROJECT'),
 ('team_lead',array['tasks','reports'],array['VIEW','CREATE','EDIT','ASSIGN'],'TEAM'),
 ('supervisor',array['tasks','reports'],array['VIEW','CREATE','EDIT'],'TEAM'),
 ('procurement_officer',array['projects','finance'],array['VIEW','CREATE'],'DEPARTMENT'),
 ('site_engineer',array['tasks','reports','projects'],array['VIEW','CREATE','EDIT'],'PROJECT'),
 ('worker',array['tasks','reports'],array['VIEW','CREATE','EDIT'],'SELF'),
 ('client_viewer',array['projects','reports'],array['VIEW'],'PROJECT'),
 ('external_auditor',array['finance','payments','audit','projects'],array['VIEW','EXPORT'],'ORGANIZATION'))
insert into role_permissions(role_key,resource,action,scope)
select role_key,r,a,scope from g, unnest(resources) r, unnest(actions) a on conflict do nothing;

-- ---------- authorization helpers (live checks, so revocation is immediate) ----------
create or replace function platform_role(p_uid uuid default auth.uid()) returns text language sql stable security definer set search_path=public as $$
 select case admin_role when 'super' then 'super_admin' when 'ops' then 'ops_admin' else null end from admin_users where id=p_uid and is_active $$;

create or replace function _mfa_ok(p_role text) returns boolean language plpgsql stable security definer set search_path=public as $$
declare priv boolean; begin
 select privileged into priv from org_roles where key=p_role;
 if not coalesce(priv,false) then return true; end if;
 if coalesce((select value from bx_settings where key='enforce_mfa'),'false')<>'true' then return true; end if;
 return coalesce(current_setting('request.jwt.claims',true)::jsonb->>'aal','aal1')='aal2';
end $$;

create or replace function member_role(p_org uuid, p_uid uuid default auth.uid()) returns text language sql stable security definer set search_path=public as $$
 select m.role_key from org_members m join organizations o on o.id=m.org_id
 where m.org_id=p_org and m.user_id=p_uid and m.status='ACTIVE' and o.status='ACTIVE' $$;

create or replace function org_perm(p_org uuid, p_resource text, p_action text, p_uid uuid default auth.uid()) returns text language plpgsql stable security definer set search_path=public as $$
declare r text; s text; begin
 if p_uid is null then return null; end if;
 r:=member_role(p_org,p_uid);
 if r is not null and _mfa_ok(r) then
   select scope into s from role_permissions where role_key=r and resource=p_resource and action=p_action;
   if s is not null then return s; end if;
 end if;
 return null; end $$;

create or replace function platform_perm(p_resource text, p_action text, p_uid uuid default auth.uid()) returns boolean language plpgsql stable security definer set search_path=public as $$
declare r text; begin
 r:=platform_role(p_uid); if r is null or not _mfa_ok(r) then return false; end if;
 return exists(select 1 from role_permissions where role_key=r and resource=p_resource and action=p_action); end $$;

create or replace function _audit(p_action text,p_type text,p_id text,p_before jsonb,p_after jsonb,p_meta jsonb default '{}') returns void language sql security definer set search_path=public as $$
 insert into audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,meta) values (auth.uid(),p_action,p_type,p_id,p_before,p_after,p_meta) $$;
revoke execute on function _audit from public, anon, authenticated;

create or replace function _can_grant(p_org uuid,p_role text) returns boolean language plpgsql stable security definer set search_path=public as $$
declare ar text; arank int; trank int; begin
 select rank into trank from org_roles where key=p_role and tier='organization';
 if trank is null then return false; end if;
 ar:=member_role(p_org); if ar is null then return false; end if;
 if ar='org_owner' then return true; end if;
 select rank into arank from org_roles where key=ar;
 return trank>arank; end $$;

-- ---------- actions ----------
create or replace function create_org(p_name text, p_type text default 'company') returns uuid language plpgsql security definer set search_path=public as $$
declare o uuid; begin
 if auth.uid() is null then raise exception 'sign in required'; end if;
 insert into organizations(name,org_type,owner_id) values (trim(p_name),p_type,auth.uid()) returning id into o;
 insert into org_members(org_id,user_id,role_key,status,invited_by) values (o,auth.uid(),'org_owner','ACTIVE',auth.uid());
 perform _audit('org.create','organization',o::text,null,jsonb_build_object('name',p_name));
 return o; end $$;

create or replace function org_invite(p_org uuid, p_contact text, p_role text) returns text language plpgsql security definer set search_path=public as $$
declare tok text; c text:=lower(trim(p_contact)); inv uuid; begin
 if org_perm(p_org,'invitations','CREATE') is null then raise exception 'not allowed'; end if;
 if not _can_grant(p_org,p_role) then raise exception 'you cannot grant this role'; end if;
 if c is null or length(c)<5 then raise exception 'email or phone required'; end if;
 tok:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into org_invitations(org_id,invitee_email,invitee_phone,role_key,token_hash,invited_by)
 values (p_org, case when c like '%@%' then c end, case when c not like '%@%' then c end, p_role, encode(sha256(convert_to(tok,'utf8')),'hex'), auth.uid()) returning org_invitations.id into inv;
 perform _audit('invitation.create','org_invitation',inv::text,null,jsonb_build_object('role',p_role,'contact',c),jsonb_build_object('org',p_org));
 return tok; end $$;

create or replace function accept_org_invitation(p_token text) returns uuid language plpgsql security definer set search_path=public as $$
declare i org_invitations; em text; begin
 if auth.uid() is null then raise exception 'sign in required'; end if;
 select * into i from org_invitations where token_hash=encode(sha256(convert_to(p_token,'utf8')),'hex') for update;
 if not found or i.status<>'INVITED' or i.expires_at<now() then raise exception 'invitation invalid or expired'; end if;
 select lower(email) into em from auth.users where id=auth.uid();
 if i.invitee_email is not null and i.invitee_email<>em then raise exception 'this invitation was sent to a different account'; end if;
 if i.invitee_phone is not null and not exists(select 1 from auth.users where id=auth.uid() and regexp_replace(coalesce(phone,''),'\D','','g') like '%'||right(regexp_replace(i.invitee_phone,'\D','','g'),9)) then raise exception 'this invitation was sent to a different account'; end if;
 insert into org_members(org_id,user_id,role_key,status,invited_by) values (i.org_id,auth.uid(),i.role_key,'ACTIVE',i.invited_by)
 on conflict (org_id,user_id) do update set role_key=excluded.role_key,status='ACTIVE',status_reason=null,status_changed_at=now();
 update org_invitations set status='ACCEPTED',accepted_by=auth.uid() where id=i.id;
 perform _audit('invitation.accept','org_invitation',i.id::text,null,jsonb_build_object('role',i.role_key),jsonb_build_object('org',i.org_id));
 return i.org_id; end $$;

create or replace function org_revoke_invitation(p_invitation uuid) returns void language plpgsql security definer set search_path=public as $$
declare i org_invitations; begin
 select * into i from org_invitations where id=p_invitation;
 if not found or org_perm(i.org_id,'invitations','EDIT') is null then raise exception 'not allowed'; end if;
 update org_invitations set status='REVOKED' where id=p_invitation and status='INVITED';
 perform _audit('invitation.revoke','org_invitation',p_invitation::text,null,null,jsonb_build_object('org',i.org_id)); end $$;

create or replace function org_set_member_role(p_member uuid,p_role text) returns void language plpgsql security definer set search_path=public as $$
declare m org_members; begin
 select * into m from org_members where id=p_member for update;
 if not found or org_perm(m.org_id,'roles','ASSIGN') is null then raise exception 'not allowed'; end if;
 if not _can_grant(m.org_id,p_role) or not _can_grant(m.org_id,m.role_key) then raise exception 'you cannot change to or from this role'; end if;
 if m.role_key='org_owner' and (select count(*) from org_members where org_id=m.org_id and role_key='org_owner' and status='ACTIVE')<2 then raise exception 'organization needs at least one owner'; end if;
 update org_members set role_key=p_role,status_changed_at=now() where id=p_member;
 perform _audit('member.role_change','org_member',p_member::text,jsonb_build_object('role',m.role_key),jsonb_build_object('role',p_role),jsonb_build_object('org',m.org_id)); end $$;

create or replace function org_set_member_status(p_member uuid,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
declare m org_members; begin
 if p_status not in ('ACTIVE','SUSPENDED','DISABLED','REVOKED') then raise exception 'invalid status'; end if;
 select * into m from org_members where id=p_member for update;
 if not found or org_perm(m.org_id,'members','EDIT') is null then raise exception 'not allowed'; end if;
 if m.user_id=auth.uid() then raise exception 'you cannot change your own access'; end if;
 if not _can_grant(m.org_id,m.role_key) then raise exception 'you cannot manage this member'; end if;
 if m.role_key='org_owner' and p_status<>'ACTIVE' and (select count(*) from org_members where org_id=m.org_id and role_key='org_owner' and status='ACTIVE')<2 then raise exception 'organization needs at least one owner'; end if;
 update org_members set status=p_status,status_reason=p_reason,status_changed_at=now() where id=p_member;
 perform _audit('member.status_change','org_member',p_member::text,jsonb_build_object('status',m.status),jsonb_build_object('status',p_status,'reason',p_reason),jsonb_build_object('org',m.org_id)); end $$;

-- ---------- reads ----------
create or replace function my_orgs() returns table(org_id uuid,name text,public_code text,role_key text,role_label text,status text) language sql stable security definer set search_path=public as $$
 select o.id,o.name,o.public_code,m.role_key,r.label,m.status from org_members m join organizations o on o.id=m.org_id join org_roles r on r.key=m.role_key
 where m.user_id=auth.uid() and m.status<>'REVOKED' order by o.name $$;

create or replace function org_members_list(p_org uuid) returns table(member_id uuid,user_id uuid,name text,role_key text,role_label text,status text,created_at timestamptz) language plpgsql stable security definer set search_path=public as $$
begin
 if org_perm(p_org,'members','VIEW') is null then raise exception 'not allowed'; end if;
 return query select m.id,m.user_id,coalesce(public._person_name(m.user_id),'Member'),m.role_key,r.label,m.status,m.created_at
  from org_members m join org_roles r on r.key=m.role_key where m.org_id=p_org order by (m.status='ACTIVE') desc, m.created_at; end $$;

create or replace function org_invitations_list(p_org uuid) returns table(id uuid,contact text,role_key text,role_label text,status text,expires_at timestamptz) language plpgsql stable security definer set search_path=public as $$
begin
 if org_perm(p_org,'invitations','VIEW') is null then raise exception 'not allowed'; end if;
 return query select i.id,coalesce(i.invitee_email,i.invitee_phone),i.role_key,r.label,
  case when i.status='INVITED' and i.expires_at<now() then 'EXPIRED' else i.status end,i.expires_at
  from org_invitations i join org_roles r on r.key=i.role_key where i.org_id=p_org order by i.created_at desc; end $$;

create or replace function org_user_access(p_org uuid,p_user uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m org_members; begin
 if org_perm(p_org,'members','VIEW') is null then raise exception 'not allowed'; end if;
 select * into m from org_members where org_id=p_org and user_id=p_user;
 if not found then raise exception 'not a member'; end if;
 return jsonb_build_object('user_id',p_user,'name',public._person_name(p_user),'role',m.role_key,'status',m.status,'status_reason',m.status_reason,
  'effective', case when m.status='ACTIVE' then (select coalesce(jsonb_agg(jsonb_build_object('resource',resource,'action',action,'scope',scope) order by resource,action),'[]') from role_permissions where role_key=m.role_key) else '[]'::jsonb end,
  'recent', (select coalesce(jsonb_agg(x),'[]') from (select action,created_at from audit_logs where entity_id=m.id::text or (actor_id=p_user and meta->>'org'=p_org::text) order by created_at desc limit 10) x)); end $$;

create or replace function access_matrix() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'roles',(select jsonb_agg(jsonb_build_object('key',key,'label',label,'tier',tier,'privileged',privileged,'description',description,'rank',rank) order by sort) from org_roles),
  'grants',(select jsonb_agg(jsonb_build_object('role',role_key,'resource',resource,'action',action,'scope',scope)) from role_permissions)) $$;

create or replace function org_audit(p_org uuid) returns table(at timestamptz,action text,actor text,detail jsonb) language plpgsql stable security definer set search_path=public as $$
begin
 if org_perm(p_org,'audit','VIEW') is null then raise exception 'not allowed'; end if;
 return query select a.created_at,a.action,coalesce(public._person_name(a.actor_id),'System'),coalesce(a.after_data,'{}'::jsonb) from audit_logs a where a.meta->>'org'=p_org::text or a.entity_id=p_org::text order by a.created_at desc limit 100; end $$;

-- ---------- projects <-> organizations ----------
create or replace function is_project_company(pid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists (select 1 from projects p where p.id = pid and (p.company_id = auth.uid()
   or (p.org_id is not null and org_perm(p.org_id,'projects','APPROVE') is not null))) $$;

create or replace function link_project_org(p_project uuid, p_org uuid) returns void language plpgsql security definer set search_path=public as $$
declare pr projects; begin
 select * into pr from projects where id=p_project for update;
 if not found or pr.company_id is distinct from auth.uid() then raise exception 'only the project owner can link an organization'; end if;
 if p_org is not null and org_perm(p_org,'projects','CREATE') is null then raise exception 'you cannot add projects to this organization'; end if;
 perform set_config('baidx.internal','1',true);
 update projects set org_id=p_org where id=p_project;
 perform _audit('project.link_org','project',p_project::text,jsonb_build_object('org',pr.org_id),jsonb_build_object('org',p_org),jsonb_build_object('org',coalesce(p_org,pr.org_id)));
end $$;
-- Phase 1 functions company_approvals, my_projects, project_finance, project_overview, project_team and
-- complete_structured_project call is_project_company(...) instead of comparing company_id to auth.uid().

-- ---------- policies and grants ----------
create policy org_read on organizations for select to authenticated using (member_role(id) is not null);
create policy member_read_self on org_members for select to authenticated using (user_id=auth.uid());
create policy roles_read on org_roles for select to authenticated using (true);
create policy perms_read on role_permissions for select to authenticated using (true);
revoke all on function create_org,org_invite,accept_org_invitation,org_revoke_invitation,org_set_member_role,org_set_member_status,my_orgs,org_members_list,org_invitations_list,org_user_access,access_matrix,org_audit,platform_role,member_role,org_perm,platform_perm,_can_grant,_mfa_ok,link_project_org from public, anon;
grant execute on function create_org,org_invite,accept_org_invitation,org_revoke_invitation,org_set_member_role,org_set_member_status,my_orgs,org_members_list,org_invitations_list,org_user_access,access_matrix,org_audit,platform_role,member_role,org_perm,platform_perm,link_project_org to authenticated;
revoke insert,update,delete on organizations,org_members,org_invitations,departments,org_teams,org_roles,role_permissions,bx_settings from anon,authenticated;

-- ---------- staff console (admin.html) ----------
create or replace function platform_whoami() returns jsonb language sql stable security definer set search_path=public as $$
 select case when platform_role() is null then null else jsonb_build_object('role',platform_role(),'label',(select label from org_roles where key=platform_role()),
  'name',(select full_name from admin_users where id=auth.uid()),
  'can',(select coalesce(jsonb_agg(resource||':'||action),'[]') from role_permissions where role_key=platform_role())) end $$;
create or replace function platform_overview() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not platform_perm('organizations','VIEW') then raise exception 'not allowed'; end if;
 return jsonb_build_object('orgs',(select count(*) from organizations),'orgs_active',(select count(*) from organizations where status='ACTIVE'),
  'members',(select count(*) from org_members where status='ACTIVE'),'invites_open',(select count(*) from org_invitations where status='INVITED' and expires_at>now()),
  'projects',(select count(*) from projects),'staff',(select count(*) from admin_users where is_active)); end $$;
create or replace function platform_orgs() returns table(org_id uuid,name text,public_code text,org_type text,status text,members bigint,owner text,created_at timestamptz) language plpgsql stable security definer set search_path=public as $$
begin
 if not platform_perm('organizations','VIEW') then raise exception 'not allowed'; end if;
 return query select o.id,o.name,o.public_code,o.org_type,o.status,(select count(*) from org_members m where m.org_id=o.id and m.status='ACTIVE'),coalesce(public._person_name(o.owner_id),'Owner'),o.created_at from organizations o order by o.created_at desc limit 200; end $$;
create or replace function platform_set_org_status(p_org uuid,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
declare o organizations; begin
 if not platform_perm('organizations','EDIT') then raise exception 'not allowed'; end if;
 if p_status not in ('ACTIVE','SUSPENDED') then raise exception 'invalid status'; end if;
 select * into o from organizations where id=p_org for update; if not found then raise exception 'not found'; end if;
 perform set_config('baidx.internal','1',true);
 update organizations set status=p_status where id=p_org;
 perform _audit('platform.org_status','organization',p_org::text,jsonb_build_object('status',o.status),jsonb_build_object('status',p_status,'reason',p_reason),jsonb_build_object('org',p_org)); end $$;
create or replace function platform_audit() returns table(at timestamptz,action text,actor text,entity text,detail jsonb) language plpgsql stable security definer set search_path=public as $$
begin
 if not platform_perm('audit','VIEW') then raise exception 'not allowed'; end if;
 return query select a.created_at,a.action,coalesce(public._person_name(a.actor_id),(select full_name from admin_users u where u.id=a.actor_id),'System'),a.entity_type,coalesce(a.after_data,'{}'::jsonb) from audit_logs a order by a.created_at desc limit 150; end $$;
revoke all on function platform_whoami,platform_overview,platform_orgs,platform_set_org_status,platform_audit from public, anon;
grant execute on function platform_whoami,platform_overview,platform_orgs,platform_set_org_status,platform_audit to authenticated;
