-- Applicant profiles and reviews for the owner of a job (company or client).
-- Reviews are private to the people in each job (job_reviews_read, reviews_read), so the job owner
-- reads them only through this function, and only for workers who applied to a job they own.
-- Returns public profile fields only: never phone, ID numbers, documents or payout details.
create or replace function public.applicant_details(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select j.id from jobs j where j.id = p_job and (j.company_id = auth.uid() or j.employer_id = auth.uid())
  ),
  apps as (
    select distinct a.worker_id from job_applications a join mine on mine.id = a.job_id where a.status <> 'withdrawn'
  ),
  revs as (
    select r.worker_id, r.rating::numeric rating, r.comment, r.created_at,
           coalesce(c.company_name, e.full_name, 'A client') reviewer
      from job_reviews r join apps on apps.worker_id = r.worker_id
      left join company_profiles c on c.id = coalesce(r.company_id, r.employer_id)
      left join individual_employer_profiles e on e.id = r.employer_id
    union all
    select pr.reviewee_id, pr.rating::numeric, pr.comment, pr.created_at,
           coalesce(c.company_name, pm.full_name, 'A project team')
      from project_reviews pr join apps on apps.worker_id = pr.reviewee_id
      left join company_profiles c on c.id = pr.reviewer_id
      left join project_manager_profiles pm on pm.id = pr.reviewer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'worker_id', w.id,
    'bio', coalesce(nullif(w.short_bio, ''), nullif(w.personal_statement, '')),
    'city_town', w.city_town, 'region', w.region,
    'daily_rate', w.daily_rate_ghs, 'years', w.years_of_experience::text,
    'available', w.available_for_work, 'badge', w.badge_tier, 'rank', w.rank_tier, 'xp', w.xp_total,
    'portfolio', coalesce(to_jsonb(w.portfolio_photo_urls), '[]'::jsonb),
    'rating', (select round(avg(rating), 1) from revs where revs.worker_id = w.id),
    'review_count', (select count(*) from revs where revs.worker_id = w.id),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('rating', rating, 'comment', comment, 'by', reviewer, 'at', created_at) order by created_at desc)
                          from (select * from revs where revs.worker_id = w.id order by created_at desc limit 5) x), '[]'::jsonb)
  )), '[]'::jsonb)
  from worker_profiles w join apps on apps.worker_id = w.id;
$$;
revoke all on function public.applicant_details(uuid) from public, anon;
grant execute on function public.applicant_details(uuid) to authenticated;
