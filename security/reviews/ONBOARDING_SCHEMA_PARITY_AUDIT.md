# Phase 124 — Production onboarding constraints vs disposable fixture

Source: read-only PostgreSQL catalog query against official project `nqzopzhmhqdssgpljypu` on 2026-10-08. No DDL was executed in production.

| Table | Production constraint | Disposable fixture | Gap |
| --- | --- | --- | --- |
| organizations | UNIQUE(slug), PRIMARY KEY(id), status CHECK ACTIVE/SUSPENDED/TRIAL/INACTIVE | UNIQUE(slug), PRIMARY KEY(id) | Status CHECK missing |
| organization_members | UNIQUE(organization_id,user_id), FK organization_id ON DELETE CASCADE, FK user_id to auth.users ON DELETE CASCADE, status CHECK | FK organization_id (default NO ACTION) | Unique pair, auth.users FK, CHECK, cascade missing |
| roles | UNIQUE(organization_id,name), FK organization_id ON DELETE CASCADE | FK organization_id (default NO ACTION) | Unique name and cascade missing |
| member_roles | composite PK, both FKs ON DELETE CASCADE | composite PK, FKs default NO ACTION | Cascade semantics missing |

## Security interpretation

The isolated captured-RPC smoke test passed but is not a production-schema-equivalent integration test. Duplicate slug is protected in both environments. The missing `organization_members.user_id -> auth.users` FK means the fixture cannot test actual user identity referential integrity. Different ON DELETE behavior can hide cascade effects and authorization races.

## Next steps

- Bring disposable constraints into closer parity without weakening official schema.
- Test duplicate slug, invalid country, missing identity and transactional rollback using the captured RPC.
- Include default-role trigger, RLS, and function EXECUTE privilege checks separately.
- Keep production EXECUTE grant blocked.

**No production changes or payment activation.**
