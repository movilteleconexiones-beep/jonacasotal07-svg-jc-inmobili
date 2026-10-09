# INMOJCO platform subscription production readiness

**Status: NOT APPROVED FOR PRODUCTION.** The proposed RPC replacement and audit table remain in draft PR #61. PostgreSQL CI passing is necessary but not sufficient.

## Production facts verified read-only (2026-10-09)
- Existing public.platform_set_subscription(uuid,text,text,text) is SECURITY DEFINER, owned by postgres, with search_path public.
- Existing implementation can insert or update subscriptions with current_period_start = now(), change plan/status/billing_mode, and update organizations.plan_id and organizations.status. This is a **live legacy behavior**; the proposed draft has NOT replaced it.
- The proposed replacement rejects activation and plan changes, writes only non-entitled SUSPENDED/CANCELLED drafts, uses search_path '', and appends an audit entry atomically.
- API role grants on the existing function include authenticated, postgres, and service_role (verified read-only). The draft's internal platform-admin check is therefore essential.
- Existing subscriptions.organization_id FK uses ON DELETE CASCADE; proposed audit FKs use ON DELETE RESTRICT and can block deletion of audited organizations. An approved retention/deletion workflow is required.

## Release blockers
1. Identify every frontend/backend caller of platform_set_subscription and assess UI expectations (including organizations.plan_id/status synchronization). Existing code may depend on the old side effects.
2. Confirm all active paid/trial entitlements continue to be managed by a separately authorized, verified payment workflow; never manually grant access from the draft RPC.
3. Review Supabase role grants, RLS, SECURITY DEFINER owner, search_path, and default privileges with a qualified reviewer.
4. Agree on audit retention, authorized read API, and data disposal/legal-hold procedures.
5. Test migration and rollback on a **disposable non-production clone** using sanitized data, including deletion and existing subscriptions. CI fixtures are not a substitute.
6. Require explicit release approval, backups and rollback procedure, and a monitored deployment window. No automatic production migration or payment activation.

## Known compatibility change
The proposed RPC intentionally stops changing organizations.plan_id and organizations.status. If the current administrative UI expects those updates, the workflow must be redesigned before rollout; do not reintroduce implicit activation merely to preserve UI behavior.

## CI scope
GitHub Actions uses isolated PostgreSQL 17 and verifies draft insertion, denial of activation, idempotency, concurrency, atomic audit rollback, role access checks, and audit FK deletion restrictions. It does not test all real Supabase extensions, production triggers, grants, or existing application callers.


## Frontend review (2026-10-09)
- Inspected src/modules/platform/SuperAdminModule.tsx on this PR branch.
- The current panel is read-only and invokes supabase.rpc('platform_list_organizations'), not platform_set_subscription.
- It displays organization_status, plan_name, billing_mode, and subscription_status but provides no activation, suspension, or contract-editing controls.
- This verifies **only this component**. It does not establish that other modules, server handlers, or future clients never call the legacy RPC.
- GitHub code search did not return a complete cross-branch caller inventory; a repository-wide local grep or source index is still a release gate.
