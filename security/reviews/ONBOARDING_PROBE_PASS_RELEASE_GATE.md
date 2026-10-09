# Phase 110 — Onboarding probe release gate

## Confirmed CI evidence
GitHub Actions run **37883414706** completed successfully. The step **Onboarding EXECUTE permissions probe (isolated PostgreSQL)** completed successfully.

This verifies three fixture scenarios:
- authenticated with a JWT user: allowed;
- anonymous role: denied EXECUTE;
- authenticated without a JWT user: function rejects the request.

## Scope limits
The test function is `public.onboarding_execute_probe`, not production `public.create_organization_with_owner`. No production organization, membership, role, compliance, or audit transaction is exercised.

## Release blockers
- Run full production-equivalent onboarding transaction in disposable PostgreSQL.
- Validate role assignment, transaction rollback, and SECURITY DEFINER privileges.
- Review abuse controls before any authenticated EXECUTE grant.
- Resolve tenant role boundary vulnerabilities independently.

**Decision: onboarding production grant remains BLOCKED.**
