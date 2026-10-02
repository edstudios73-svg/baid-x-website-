-- RUN ONLY WHEN THE OLD APP (baid-x.vercel.app) IS RETIRED.
-- Stops signed-in members from reading other people's private profile columns
-- (Ghana Card, contact, payout details). The new site reads its own full row with my_profile().
-- The old app reads whole rows with select('*'), so running this earlier would break it.
do $$ declare t text; cols text; begin
 foreach t in array array['worker_profiles','company_profiles','project_manager_profiles','business_profiles'] loop
  select string_agg(quote_ident(column_name),',') into cols from information_schema.column_privileges
   where table_schema='public' and table_name=t and grantee='anon' and privilege_type='SELECT';
  if cols is null then raise exception 'no anon columns for %', t; end if;
  execute format('revoke select on public.%I from authenticated', t);
  execute format('grant select (%s) on public.%I to authenticated', cols, t);
 end loop; end $$;
