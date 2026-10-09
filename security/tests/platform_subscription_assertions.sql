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
