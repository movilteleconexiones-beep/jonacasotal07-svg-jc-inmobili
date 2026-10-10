\set ON_ERROR_STOP on

insert into private.property_intake_sites(slug,organization_id,enabled) values
 ('tenant-a','11111111-1111-1111-1111-111111111111',true),
 ('tenant-b','22222222-2222-2222-2222-222222222222',true),
 ('disabled','33333333-3333-3333-3333-333333333333',true);

set role anon;
do $$ declare first_receipt jsonb; repeat_receipt jsonb; bad jsonb; begin
  perform public.consignment_test_assert(public.get_public_property_intake_site('tenant-a')->>'company_name'='Tenant A','public site');
  perform public.consignment_test_assert(public.get_public_property_intake_site('disabled') is null,'inactive site blocked');
  first_receipt := public.submit_property_consignment('tenant-a','10000000-0000-0000-0000-000000000001',public.consignment_test_payload());
  repeat_receipt := public.submit_property_consignment('tenant-a','10000000-0000-0000-0000-000000000001',public.consignment_test_payload());
  perform public.consignment_test_assert(first_receipt=repeat_receipt,'retry is idempotent');
  perform public.consignment_test_assert((select count(*)=1 from jsonb_object_keys(first_receipt)) and first_receipt ? 'reference','receipt exposes no personal data');
  begin
    perform public.submit_property_consignment('tenant-a','10000000-0000-0000-0000-000000000001',public.consignment_test_payload()||'{"price":100}'::jsonb);
    raise exception 'changed retry accepted';
  exception when invalid_parameter_value then null; end;
  foreach bad in array array[
    '{"price":0}'::jsonb,'{"price":1e30}'::jsonb,'{"price":"250000000"}'::jsonb,
    '{"bathrooms":1.3}'::jsonb,'{"construction_year":2999}'::jsonb,'{"owner_phone":"abcd1234567"}'::jsonb,
    '{"contact_consent":false}'::jsonb,'{"organization_id":"22222222-2222-2222-2222-222222222222"}'::jsonb,
    '{"status":"ACCEPTED"}'::jsonb,'{"property_type":"INVALID"}'::jsonb
  ] loop
    begin
      perform public.submit_property_consignment('tenant-a',gen_random_uuid(),public.consignment_test_payload()||bad);
      raise exception 'invalid input accepted: %',bad;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.submit_property_consignment('disabled',gen_random_uuid(),public.consignment_test_payload());
    raise exception 'inactive site accepted';
  exception when no_data_found then null; end;
  begin perform 1 from public.property_consignments; raise exception 'anonymous could read inbox';
    exception when insufficient_privilege then null; end;
  begin insert into public.property_consignments(organization_id,request_id,contact_name,contact_phone,payload)
    values('11111111-1111-1111-1111-111111111111',gen_random_uuid(),'Injected','1234567','{}');
    raise exception 'direct insert accepted'; exception when insufficient_privilege then null; end;
  begin perform public.review_property_consignment(gen_random_uuid(),'ACCEPTED','');
    raise exception 'anonymous could review'; exception when insufficient_privilege then null; end;
  perform public.consignment_test_assert((select count(*)=0 from public.properties),'anonymous inventory hidden');
end $$;
reset role;
select public.consignment_test_assert((select count(*)=1 from public.property_consignments),'single persisted receipt');

select set_config('consignment.test_target',(select id::text from public.property_consignments limit 1),false);
set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
select public.consignment_test_assert((select count(*)=0 from public.property_consignments),'cross-tenant inbox hidden');
do $$ begin
  begin perform public.review_property_consignment(current_setting('consignment.test_target')::uuid,'ACCEPTED','');
    raise exception 'cross-tenant review accepted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','cccccccc-cccc-cccc-cccc-cccccccccccc',false);
select public.consignment_test_assert((select count(*)=0 from public.property_consignments),'contact permission required');
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  begin perform public.review_property_consignment(gen_random_uuid(),'ACCEPTED','');
    raise exception 'missing actor could review'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- A failure during CRM creation must roll back the property and contact too.
create function public.consignment_test_fail_lead() returns trigger language plpgsql as $$
begin raise check_violation using message='test_lead_failure'; end $$;
create trigger consignment_test_fail before insert on public.leads for each row execute function public.consignment_test_fail_lead();
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
do $$ declare target uuid; begin
  select id into target from public.property_consignments limit 1;
  perform public.consignment_test_assert(target is not null,'authorized reviewer sees inbox');
  begin perform public.review_property_consignment(target,'ACCEPTED','Test');
    raise exception 'CRM failure not propagated'; exception when check_violation then null; end;
  begin update public.property_consignments set status='REJECTED' where id=target;
    raise exception 'direct update accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select public.consignment_test_assert((select count(*)=0 from public.properties),'property rollback');
select public.consignment_test_assert((select count(*)=0 from public.contacts),'contact rollback');
select public.consignment_test_assert((select bool_and(status='NEW') from public.property_consignments),'review rollback');
drop trigger consignment_test_fail on public.leads;

-- No permission escalation through the reviewer RPC.
delete from public.consignment_test_permissions where permission_key='clients.create';
set role authenticated;
do $$ declare target uuid; begin
  select id into target from public.property_consignments limit 1;
  begin perform public.review_property_consignment(target,'ACCEPTED','');
    raise exception 'acceptance without contact creation permission'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.consignment_test_permissions values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','clients.create');

set role authenticated;
do $$ declare target uuid; result jsonb; begin
  select id into target from public.property_consignments limit 1;
  result:=public.review_property_consignment(target,'ACCEPTED','Revisado');
  perform public.consignment_test_assert(result=public.review_property_consignment(target,'ACCEPTED','Revisado'),'review retry idempotent');
  begin perform public.review_property_consignment(target,'REJECTED','');
    raise exception 'terminal state changed'; exception when invalid_parameter_value then null; end;
  perform public.consignment_test_assert((select count(*)=1 from public.properties),'reviewer sees private draft');
end $$;
reset role;
select public.consignment_test_assert((select count(*)=1 and bool_and(status='DRAFT' and price=250000000 and bedrooms=0 and bathrooms=1.5 and currency='COP') from public.properties),'declared values preserved');
select public.consignment_test_assert((select count(*)=1 from public.contacts),'one contact');
select public.consignment_test_assert((select count(*)=1 from public.leads),'one CRM opportunity');
set role anon;
select public.consignment_test_assert((select count(*)=0 from public.properties),'new draft never public');
select public.submit_property_consignment('tenant-a','10000000-0000-0000-0000-000000000002',public.consignment_test_payload());
select public.submit_property_consignment('tenant-a','10000000-0000-0000-0000-000000000003',public.consignment_test_payload());
do $$ begin
  begin perform public.submit_property_consignment('tenant-a',gen_random_uuid(),public.consignment_test_payload());
    raise exception 'contact quota bypassed'; exception when raise_exception then
      if sqlerrm <> 'intake_rate_limited' then raise; end if; end;
end $$;
reset role;
select public.consignment_test_assert((select count(*)=3 from public.property_consignments),'quota did not insert');
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
do $$ declare target uuid; begin
  select id into target from public.property_consignments where status='NEW' order by created_at limit 1;
  perform public.review_property_consignment(target,'REJECTED','Datos insuficientes');
  perform public.consignment_test_assert((select status='REJECTED' and reviewed_at is not null and reviewed_by=auth.uid() from public.property_consignments where id=target),'rejection audited');
end $$;
reset role;
select public.consignment_test_assert((select count(*)=1 from public.properties),'rejection creates no inventory');
select public.consignment_test_assert((select count(*)=1 from public.contacts),'rejection creates no contact');
select public.consignment_test_assert((select count(*)=1 from public.leads),'rejection creates no opportunity');
select 'Property consignment security and atomicity checks passed' as result;
