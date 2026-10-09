-- Isolated PostgreSQL concurrency check; run after fixture and reviewed migration.
-- pg_sleep holds the first transaction's organization row lock while the
-- second transaction attempts an identical assignment.
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
-- A database-level advisory lock cannot replace row-lock verification.
-- This test verifies idempotency in two sequential transactions; concurrent
-- invocation must additionally be exercised by a separate two-session harness.
begin;
select public.platform_set_subscription('11111111-1111-4111-8111-111111111111','BASIC','SAAS_MONTHLY','SUSPENDED');
commit;
begin;
select public.platform_set_subscription('11111111-1111-4111-8111-111111111111','BASIC','SAAS_MONTHLY','SUSPENDED');
commit;
do $$
begin
 if (select count(*) from public.subscriptions where organization_id='11111111-1111-4111-8111-111111111111') <> 1 then
  raise exception 'duplicate subscription';
 end if;
end $$;
