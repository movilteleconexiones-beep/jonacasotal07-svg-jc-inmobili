-- Isolated PostgreSQL assertions: no production access.
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select public.platform_set_subscription('11111111-1111-4111-8111-111111111111','BASIC','SAAS_MONTHLY','SUSPENDED');
do $$
begin
 if (select count(*) from public.subscriptions) <> 1 then
   raise exception 'Expected exactly one subscription';
 end if;
 if exists (select 1 from public.subscriptions where current_period_start is not null or current_period_end is not null) then
   raise exception 'Draft subscription must not start a billing period';
 end if;
 if (select status from public.organizations where id='11111111-1111-4111-8111-111111111111') <> 'ACTIVE' then
   raise exception 'Administrative status changed';
 end if;
end;
$$;
update public.subscriptions set updated_at='2020-01-01'::timestamptz;
select public.platform_set_subscription('11111111-1111-4111-8111-111111111111','BASIC','SAAS_MONTHLY','SUSPENDED');
do $$
begin
 if (select updated_at from public.subscriptions) <> '2020-01-01'::timestamptz then
   raise exception 'Idempotent call modified existing subscription';
 end if;
end;
$$;
select 'PASS: draft contract and idempotency checks' as result;

-- Negative cases: assert that rejected requests leave the subscription unchanged.
create function pg_temp.must_reject(label text, statement text, expected_state text)
returns void language plpgsql as $check$
declare
  got_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics got_state = returned_sqlstate;
    if got_state = expected_state then return; end if;
    raise exception 'Unexpected error in %: %', label, got_state;
  end;
  raise exception 'Request unexpectedly accepted: %', label;
end;
$check$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
select pg_temp.must_reject('unauthorized user',
  'select public.platform_set_subscription(''11111111-1111-4111-8111-111111111111'',''BASIC'',''SAAS_MONTHLY'',''SUSPENDED'')','42501');
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select pg_temp.must_reject('inactive plan',
  'select public.platform_set_subscription(''11111111-1111-4111-8111-111111111111'',''INACTIVE_PLAN'',''SAAS_MONTHLY'',''SUSPENDED'')','22023');
select pg_temp.must_reject('unverified activation',
  'select public.platform_set_subscription(''11111111-1111-4111-8111-111111111111'',''BASIC'',''SAAS_MONTHLY'',''ACTIVE'')','22023');
select pg_temp.must_reject('unaudited status transition',
  'select public.platform_set_subscription(''11111111-1111-4111-8111-111111111111'',''BASIC'',''SAAS_MONTHLY'',''CANCELLED'')','22023');
select pg_temp.must_reject('unaudited plan conversion',
  'select public.platform_set_subscription(''11111111-1111-4111-8111-111111111111'',''ENTERPRISE'',''SAAS_MONTHLY'',''SUSPENDED'')','22023');
select pg_temp.must_reject('inactive organization',
  'select public.platform_set_subscription(''22222222-2222-4222-8222-222222222222'',''BASIC'',''SAAS_MONTHLY'',''SUSPENDED'')','22023');
select pg_temp.must_reject('invalid billing pairing',
  'select public.platform_set_subscription(''11111111-1111-4111-8111-111111111111'',''BASIC'',''CUSTOM'',''SUSPENDED'')','22023');
do $check$
begin
  if (select count(*) from public.subscriptions) <> 1 then
    raise exception 'Rejected requests changed subscription count';
  end if;
end;
$check$;


-- Audit is atomic with the draft and idempotent retries do not duplicate events.
do $audit$
begin
 if (select count(*) from public.platform_subscription_audit) <> 1 then
   raise exception 'Expected exactly one audit event for a created draft';
 end if;
 if not exists (
   select 1 from public.platform_subscription_audit a
   join public.subscriptions s on s.id = a.subscription_id
   where a.organization_id = s.organization_id
     and a.actor_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and a.action = 'CREATE_NON_ENTITLED_DRAFT'
     and a.subscription_status = 'SUSPENDED'
 ) then raise exception 'Audit event missing actor or contract linkage';
 end if;
end;
$audit$;


-- Atomicity: a failed audit insert must roll back the subscription insert.
insert into public.organizations(id,status)
values ('77777777-7777-4777-8777-777777777777','ACTIVE');
create function pg_temp.reject_audit_insert() returns trigger
language plpgsql as $atomic$
begin
 if new.organization_id = '77777777-7777-4777-8777-777777777777'::uuid then
   raise exception 'Simulated audit storage failure' using errcode = 'P0001';
 end if;
 return new;
end;
$atomic$;
create trigger audit_failure_test before insert on public.platform_subscription_audit
for each row execute function pg_temp.reject_audit_insert();
select pg_temp.must_reject('audit insert failure rolls back contract',
 'select public.platform_set_subscription(''77777777-7777-4777-8777-777777777777'',''BASIC'',''SAAS_MONTHLY'',''SUSPENDED'')','P0001');
do $atomic$
begin
 if exists (select 1 from public.subscriptions
            where organization_id = '77777777-7777-4777-8777-777777777777') then
   raise exception 'Orphaned subscription after failed audit';
 end if;
 if exists (select 1 from public.platform_subscription_audit
            where organization_id = '77777777-7777-4777-8777-777777777777') then
   raise exception 'Unexpected audit record after failed transaction';
 end if;
end;
$atomic$;
drop trigger audit_failure_test on public.platform_subscription_audit;

-- Production parity: started_at is a record timestamp, not entitlement activation.
do $dates$
begin
 if exists (select 1 from public.subscriptions
            where started_at is null or current_period_start is not null or current_period_end is not null) then
   raise exception 'Draft must have a record timestamp but no billable period';
 end if;
end;
$dates$;


-- Audit retention: FK restrictions block accidental deletion of audited records.
select pg_temp.must_reject('delete audited subscription',
  'delete from public.subscriptions where organization_id = ''11111111-1111-4111-8111-111111111111''','23503');
select pg_temp.must_reject('delete audited organization',
  'delete from public.organizations where id = ''11111111-1111-4111-8111-111111111111''','23503');
do $retention$
begin
 if (select count(*) from public.subscriptions) <> 1
    or (select count(*) from public.platform_subscription_audit) <> 1 then
   raise exception 'Retention guard altered audited records';
 end if;
end;
$retention$;


-- PostgreSQL roles are cluster-wide; earlier CI suites may have created them.
do $roles$
begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then
   create role authenticated nologin;
 end if;
 if not exists(select 1 from pg_roles where rolname='anon') then
   create role anon nologin;
 end if;
end;
$roles$;

-- No direct API role privileges on audit evidence.
do $acl$
begin
 if has_table_privilege('authenticated','public.platform_subscription_audit','SELECT')
 or has_table_privilege('authenticated','public.platform_subscription_audit','INSERT')
 or has_table_privilege('authenticated','public.platform_subscription_audit','UPDATE')
 or has_table_privilege('authenticated','public.platform_subscription_audit','DELETE')
 or has_table_privilege('anon','public.platform_subscription_audit','SELECT')
 or has_table_privilege('anon','public.platform_subscription_audit','INSERT')
 or has_table_privilege('anon','public.platform_subscription_audit','UPDATE')
 or has_table_privilege('anon','public.platform_subscription_audit','DELETE') then
  raise exception 'Audit table exposed to an API role';
 end if;
 if not (select relrowsecurity from pg_class where oid='public.platform_subscription_audit'::regclass) then
  raise exception 'Audit RLS disabled';
 end if;
end;
$acl$;

-- Exercise actual API roles, not only ACL inspection. Schema access is explicit
-- so failures must come from table privileges or the RPC authorization guard.
grant usage on schema public to anon, authenticated;
set role anon;
do $api$
declare
  statement text;
  denied boolean;
begin
  foreach statement in array array[
    'select 1 from public.platform_subscription_audit limit 1',
    'insert into public.platform_subscription_audit default values',
    'update public.platform_subscription_audit set action = action where false',
    'delete from public.platform_subscription_audit where false'
  ] loop
    denied := false;
    begin
      execute statement;
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then raise exception 'Anonymous audit access accepted: %', statement; end if;
  end loop;
end;
$api$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $api$
declare
  statement text;
  denied boolean;
begin
  foreach statement in array array[
    'select 1 from public.platform_subscription_audit limit 1',
    'insert into public.platform_subscription_audit default values',
    'update public.platform_subscription_audit set action = action where false',
    'delete from public.platform_subscription_audit where false',
    'select public.platform_set_subscription(''77777777-7777-4777-8777-777777777777'',''BASIC'',''SAAS_MONTHLY'',''SUSPENDED'')'
  ] loop
    denied := false;
    begin
      execute statement;
    exception when insufficient_privilege then
      denied := true;
    end;
    if not denied then raise exception 'Unauthorized authenticated operation accepted: %', statement; end if;
  end loop;
end;
$api$;
-- An authorized caller can still retry through the SECURITY DEFINER RPC.
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select public.platform_set_subscription('11111111-1111-4111-8111-111111111111','BASIC','SAAS_MONTHLY','SUSPENDED');
reset role;
do $unchanged$
begin
  if (select count(*) from public.subscriptions) <> 1
     or (select count(*) from public.platform_subscription_audit) <> 1
     or (select updated_at from public.subscriptions) <> '2020-01-01'::timestamptz then
    raise exception 'API role checks changed subscription or audit evidence';
  end if;
end;
$unchanged$;
select 'PASS: actual API role denial and authorized RPC retry' as result;

-- Baseline: without audit evidence the production FK really cascades.
-- The audited organization above must fail because of retention protection,
-- rather than because the fixture omitted ON DELETE CASCADE.
begin;
insert into public.organizations(id,status)
values ('88888888-8888-4888-8888-888888888888','ACTIVE');
insert into public.subscriptions(organization_id,plan_id,status,billing_mode)
values ('88888888-8888-4888-8888-888888888888',
        '33333333-3333-4333-8333-333333333333','SUSPENDED','SAAS_MONTHLY');
delete from public.organizations where id='88888888-8888-4888-8888-888888888888';
do $cascade$
begin
  if exists (select 1 from public.subscriptions
             where organization_id='88888888-8888-4888-8888-888888888888') then
    raise exception 'Production subscription cascade was not reproduced';
  end if;
  if (select count(*) from public.subscriptions) <> 1
     or (select count(*) from public.platform_subscription_audit) <> 1 then
    raise exception 'Cascade baseline changed audited records';
  end if;
end;
$cascade$;
rollback;
select 'PASS: unaudited cascade and audited deletion restriction' as result;

-- Cover rejected creation paths on an organization with no subscription.
-- Existing-row transition checks cannot prove that first-time grants are denied.
begin;
insert into public.organizations(id,status)
values ('99999999-9999-4999-8999-999999999999','ACTIVE');
select set_config('request.jwt.claim.sub','',false);
select pg_temp.must_reject('missing authenticated identity',
  'select public.platform_set_subscription(''99999999-9999-4999-8999-999999999999'',''BASIC'',''SAAS_MONTHLY'',''SUSPENDED'')','42501');
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $matrix$
declare
  sample record;
begin
  for sample in
    select * from (values
      ('null organization', null::uuid, 'BASIC', 'SAAS_MONTHLY', 'SUSPENDED'),
      ('null plan', '99999999-9999-4999-8999-999999999999'::uuid, null, 'SAAS_MONTHLY', 'SUSPENDED'),
      ('null billing mode', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', null, 'SUSPENDED'),
      ('null status', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', 'SAAS_MONTHLY', null),
      ('unknown organization', '00000000-0000-4000-8000-000000000000'::uuid, 'BASIC', 'SAAS_MONTHLY', 'SUSPENDED'),
      ('unknown plan', '99999999-9999-4999-8999-999999999999'::uuid, 'UNKNOWN', 'SAAS_MONTHLY', 'SUSPENDED'),
      ('unknown billing mode', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', 'UNKNOWN', 'SUSPENDED'),
      ('unknown status', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', 'SAAS_MONTHLY', 'UNKNOWN'),
      ('first-time trial', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', 'SAAS_MONTHLY', 'TRIAL'),
      ('first-time active', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', 'SAAS_MONTHLY', 'ACTIVE'),
      ('first-time past-due', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', 'SAAS_MONTHLY', 'PAST_DUE'),
      ('first-time lifetime', '99999999-9999-4999-8999-999999999999'::uuid, 'LIFETIME', 'LIFETIME', 'LIFETIME'),
      ('lifetime plan monthly mode', '99999999-9999-4999-8999-999999999999'::uuid, 'LIFETIME', 'SAAS_MONTHLY', 'SUSPENDED'),
      ('lifetime mode active status', '99999999-9999-4999-8999-999999999999'::uuid, 'LIFETIME', 'LIFETIME', 'ACTIVE'),
      ('dedicated basic plan', '99999999-9999-4999-8999-999999999999'::uuid, 'BASIC', 'DEDICATED', 'SUSPENDED')
    ) as cases(label, org_id, plan_code, billing_mode, subscription_status)
  loop
    perform pg_temp.must_reject(sample.label,
      format('select public.platform_set_subscription(%L::uuid,%L,%L,%L)',
        sample.org_id, sample.plan_code, sample.billing_mode, sample.subscription_status),
      '22023');
  end loop;
  if exists (select 1 from public.subscriptions
             where organization_id='99999999-9999-4999-8999-999999999999')
     or exists (select 1 from public.platform_subscription_audit
                where organization_id='99999999-9999-4999-8999-999999999999') then
    raise exception 'Rejected creation left subscription or audit data';
  end if;
  if (select count(*) from public.subscriptions) <> 1
     or (select count(*) from public.platform_subscription_audit) <> 1
     or (select updated_at from public.subscriptions) <> '2020-01-01'::timestamptz then
    raise exception 'Rejected creation changed existing evidence';
  end if;
end;
$matrix$;
rollback;
select 'PASS: missing identity, invalid input and first-time entitlement denial matrix' as result;
