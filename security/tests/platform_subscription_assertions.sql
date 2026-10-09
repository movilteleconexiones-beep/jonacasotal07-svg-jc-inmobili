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
