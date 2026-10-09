-- Isolated PostgreSQL test only. Requires fixture and 0033 prototype loaded.
-- Two sessions are orchestrated by the CI shell, not by this SQL file.
-- The same tenant lock must block a concurrent transaction until commit.
SELECT public.lock_tenant_billing_authorization('22222222-2222-4222-8222-222222222222');
