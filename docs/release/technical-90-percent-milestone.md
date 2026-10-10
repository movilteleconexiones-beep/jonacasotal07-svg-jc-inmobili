# INMOJCO: technical 90% milestone

**Target:** advance technical readiness toward 90%; this is a planning milestone, not a measured certification or authorization to sell.

## Gate 1 — Secure contract management
- [x] Isolated PostgreSQL integration tests for non-entitled subscription drafts and atomic audit
- [x] Explicit Supabase API role audit-table revocation and simulated default-grant regression test (CI #224)
- [x] Source-tree scanner for direct legacy RPC references (CI #223)
- [x] Read-only SuperAdmin compatibility review
- [ ] External and dynamic RPC callers inventory, including SQL dependencies
- [ ] Production-like disposable clone validation, rollback rehearsal and audit retention decision
- [ ] Independent security approval; no production migration yet

## Gate 2 — SuperAdmin functional workflow
- [ ] Specify permitted contract states, roles, and separation of administrative vs paid entitlement state
- [ ] Implement server-authorized non-entitled draft workflow only after requirements and tests
- [ ] Add explicit audit read workflow with least privilege and approved retention
- [ ] Test end-to-end against a disposable environment

## Gate 3 — Payments (sandbox only)
- [ ] Verify server-side Wompi authorization, integrity signatures, webhook idempotency and replay defense end-to-end
- [ ] Exercise sandbox payment success, failure, expiry, duplicate event and revoked permission
- [ ] Confirm reconciliation and no unverified entitlement grants
- [ ] Keep production credentials and live charging disabled

## Gate 4 — Inmobiliaria product acceptance
- [ ] Test organization onboarding, membership, roles, RLS, property listing, lead capture, appointments and deals
- [ ] Validate tenant isolation and role access with two test organizations
- [ ] Validate frontend loading, errors, responsive layout, and accessible navigation
- [ ] Document operator training, incident response, backup and restoration

## Release gate
- [ ] CI green at final candidate SHA
- [ ] Staging or disposable production-like environment approved
- [ ] Backup, rollback, monitoring and release owner approved
- [ ] Explicit separate authorization for production deployment and for any real payment activation

## Current evidence
- CI #224 succeeded at commit eeab9f3b24965813ec1662e2d15cf24acd3af123.
- Draft PR #61 remains unmerged; production Supabase and live payment settings unchanged by this work.
- The previously quoted 75% is a qualitative estimate. Progress to 90% must be assessed against the acceptance gates above rather than by counting commits.
