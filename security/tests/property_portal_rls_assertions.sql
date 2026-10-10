\set ON_ERROR_STOP on
begin;
insert into auth.users values('dddddddd-dddd-dddd-dddd-dddddddddddd');
insert into public.properties(id,organization_id,code,title,status) values
 ('50000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','PORTAL-OWNER','Owner property','DRAFT'),
 ('50000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','PORTAL-LEAD','Lead property','DRAFT'),
 ('50000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','PORTAL-DEAL','Deal property','DRAFT'),
 ('50000000-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','PORTAL-APPOINTMENT','Appointment property','DRAFT'),
 ('50000000-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','PORTAL-UNRELATED','Unrelated property','DRAFT'),
 ('50000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','PORTAL-CROSS-OWNER','Cross-tenant owner link','DRAFT'),
 ('50000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','PORTAL-CROSS-CONTACT','Cross-tenant contact link','DRAFT');
insert into public.property_owners values('51000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
insert into public.property_ownerships values
 ('50000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000006','51000000-0000-0000-0000-000000000001');
insert into public.contacts(id,organization_id,first_name) values
 ('52000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Portal contact');
insert into public.portal_access_links(organization_id,user_id,owner_id) values
 ('22222222-2222-2222-2222-222222222222','dddddddd-dddd-dddd-dddd-dddddddddddd','51000000-0000-0000-0000-000000000001'),
 ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','51000000-0000-0000-0000-000000000001');
insert into public.portal_access_links(organization_id,user_id,contact_id) values
 ('22222222-2222-2222-2222-222222222222','dddddddd-dddd-dddd-dddd-dddddddddddd','52000000-0000-0000-0000-000000000001'),
 ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','52000000-0000-0000-0000-000000000001');
insert into public.leads(organization_id,property_id,contact_id) values
 ('22222222-2222-2222-2222-222222222222','50000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000001'),
 ('11111111-1111-1111-1111-111111111111','50000000-0000-0000-0000-000000000007','52000000-0000-0000-0000-000000000001');
insert into public.deals(organization_id,property_id,contact_id) values
 ('22222222-2222-2222-2222-222222222222','50000000-0000-0000-0000-000000000003','52000000-0000-0000-0000-000000000001');
insert into public.appointments(organization_id,property_id,contact_id) values
 ('22222222-2222-2222-2222-222222222222','50000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000001');
select public.consignment_test_assert(not has_function_privilege('anon','private.can_read_portal_property(uuid,uuid)','EXECUTE'),'anonymous helper execution denied');
select public.consignment_test_assert(not has_table_privilege('authenticated','private.property_intake_sites','SELECT'),'private site table remains inaccessible');
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
set local role authenticated;
select public.consignment_test_assert(exists(select 1 from public.properties where organization_id='11111111-1111-1111-1111-111111111111'),'staff inventory reads without recursion');
reset role;
select set_config('request.jwt.claim.sub','dddddddd-dddd-dddd-dddd-dddddddddddd',true);
set local role authenticated;
select public.consignment_test_assert((select count(*)=4 from public.properties),'portal sees four explicitly related properties');
select public.consignment_test_assert(not exists(select 1 from public.properties where organization_id='11111111-1111-1111-1111-111111111111'),'malformed cross-tenant links do not expose properties');
select public.consignment_test_assert(not exists(select 1 from public.properties where code='PORTAL-UNRELATED'),'unrelated property stays hidden');
select public.consignment_test_assert((select count(*)=1 from public.property_ownerships),'ownership reads no longer recurse');
reset role;
delete from public.portal_access_links where user_id='dddddddd-dddd-dddd-dddd-dddddddddddd';
set local role authenticated;
select public.consignment_test_assert((select count(*)=0 from public.properties),'link revocation takes effect immediately');
reset role;
rollback;
select 'Property portal RLS recursion and tenant isolation checks passed' as result;
