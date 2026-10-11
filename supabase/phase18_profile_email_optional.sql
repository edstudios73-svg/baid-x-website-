-- BAID X · Phase 18: the profile email is optional at sign-up. Applied to project igfmmprlrybxsdzehwid.
-- Sign-up no longer assigns an email (members add their own in Edit profile), but four profile tables
-- still required one, so creating a Company, Project manager, Supplier or Client account failed with
-- 'null value in column "contact_email" ... violates not-null constraint'. Unique constraints stay:
-- they still stop two accounts sharing an email once one is added, and allow any number of empty ones.
alter table public.company_profiles alter column contact_email drop not null;
alter table public.business_profiles alter column contact_email drop not null;
alter table public.project_manager_profiles alter column email drop not null;
alter table public.individual_employer_profiles alter column email drop not null;
