-- Phase 19: blank contact and ID fields are stored as NULL, and a phone number is optional on every profile.
-- Why: these columns are UNIQUE. Sign-ups without a phone (Google or email) and Edit profile saves with an emptied field
-- stored '' — the second person to do so hit "duplicate key value violates unique constraint" and their profile was not
-- created. NULLs never collide under UNIQUE, so a blank field now means "not given". Non-destructive: no rows or
-- constraints are removed; only '' values become NULL.

alter table public.worker_profiles alter column phone_number drop not null;
alter table public.company_profiles alter column contact_phone drop not null;
alter table public.project_manager_profiles alter column phone_number drop not null;
alter table public.business_profiles alter column contact_phone drop not null;
alter table public.individual_employer_profiles alter column phone_number drop not null;

create or replace function public._blank_to_null() returns trigger language plpgsql set search_path = '' as $$
declare r jsonb := to_jsonb(new); k text; changed boolean := false;
begin
  foreach k in array tg_argv loop
    if r ->> k is not null and btrim(r ->> k) = '' then
      r := jsonb_set(r, array[k], 'null'::jsonb); changed := true;
    end if;
  end loop;
  if changed then new := jsonb_populate_record(new, r); end if;
  return new;
end $$;

drop trigger if exists blank_to_null on public.worker_profiles;
create trigger blank_to_null before insert or update on public.worker_profiles
  for each row execute function public._blank_to_null('phone_number', 'email');
drop trigger if exists blank_to_null on public.company_profiles;
create trigger blank_to_null before insert or update on public.company_profiles
  for each row execute function public._blank_to_null('contact_phone', 'contact_email', 'tin_number', 'rgd_registration_number');
drop trigger if exists blank_to_null on public.project_manager_profiles;
create trigger blank_to_null before insert or update on public.project_manager_profiles
  for each row execute function public._blank_to_null('phone_number', 'email', 'ghana_card_number');
drop trigger if exists blank_to_null on public.business_profiles;
create trigger blank_to_null before insert or update on public.business_profiles
  for each row execute function public._blank_to_null('contact_phone', 'contact_email', 'tin_number', 'rgd_registration_number');
drop trigger if exists blank_to_null on public.individual_employer_profiles;
create trigger blank_to_null before insert or update on public.individual_employer_profiles
  for each row execute function public._blank_to_null('phone_number', 'email');

-- existing blanks
update public.worker_profiles set phone_number = null where btrim(phone_number) = '';
update public.worker_profiles set email = null where btrim(email) = '';
update public.company_profiles set contact_phone = null where btrim(contact_phone) = '';
update public.company_profiles set contact_email = null where btrim(contact_email) = '';
update public.project_manager_profiles set phone_number = null where btrim(phone_number) = '';
update public.project_manager_profiles set email = null where btrim(email) = '';
update public.business_profiles set contact_phone = null where btrim(contact_phone) = '';
update public.business_profiles set contact_email = null where btrim(contact_email) = '';
update public.individual_employer_profiles set phone_number = null where btrim(phone_number) = '';
update public.individual_employer_profiles set email = null where btrim(email) = '';
