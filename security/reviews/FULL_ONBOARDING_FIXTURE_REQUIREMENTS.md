# Phase 104 — Full onboarding integration fixture prerequisites

The existing `onboarding_execute_probe` fixture only checks role EXECUTE and JWT presence. It is not a substitute for the real `create_organization_with_owner` transaction.

## Required production-equivalent objects
- `auth.uid()` and authenticated/anon roles.
- `country_profiles`, `organizations`, `organization_members`.
- `organization_branding`, `organization_settings`.
- `compliance_packs`, `organization_compliance`.
- `roles`, `permissions`, `role_permissions`, `member_roles`.
- `audit_log`.
- `apply_default_role_permissions` trigger, matching production.
- Real three-argument `create_organization_with_owner` body and its EXECUTE grants.

## Required test sequence
1. Load production-equivalent schema and function in disposable database.
2. Verify anon cannot execute and authenticated without JWT fails.
3. With a valid JWT, create a tenant, confirm organization, owner membership, five scoped system roles, role grants, branding, settings, compliance and audit.
4. Assert invalid slug/country and duplicate slug leave no partial records.
5. Check direct system-role assignment is denied for ordinary authenticated callers.
6. Compare fixture object definitions with production before accepting the result.

## Current evidence
CI run 37883051571 passed the limited EXECUTE probe. The follow-up run for the missing-JWT negative case was still in progress at the last inspection.

**Release gate: BLOCKED** until these production-equivalent integration tests pass and the SECURITY DEFINER abuse controls are reviewed.
