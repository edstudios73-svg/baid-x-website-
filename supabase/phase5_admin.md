# Phase 5: Super Admin (applied to production)

Staff-only server functions (each starts with `_adm()`, which requires an active row in `admin_users`):
admin_dashboard, admin_users, admin_set_account_status, admin_jobs, admin_set_job_status, admin_projects,
admin_set_project_status, admin_applications, admin_reports, admin_resolve_report, admin_analytics,
admin_save_category, admin_audit, admin_finance, admin_release_escrow (85/15, rate from platform_settings.commission_rate),
admin_resolve_dispute, admin_update_provider*, admin_broadcast, admin_broadcasts, admin_health, admin_settings,
admin_set_setting*, admin_set_mfa*, admin_plans, admin_set_plan_price*, admin_start_founding*, admin_reconciliation,
admin_verification_queue, admin_decide_verification, admin_money_queue, admin_decide_deposit, admin_decide_withdrawal,
platform_whoami, platform_orgs, platform_overview, platform_set_org_status.
(* = Super Admin only, checked with platform_role() = 'super_admin'.)

The production database is the source of truth for the function bodies.
Staff sign in at /admin.html. Credentials are never stored in the repository.
