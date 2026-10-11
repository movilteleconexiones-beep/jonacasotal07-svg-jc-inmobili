-- Explicit commercial permission ceiling for BASIC and PRO monthly plans.
-- Does not change role membership, active access, subscriptions or payment settings.
begin;
do $$
declare
 basic_keys text[] := array[
  'properties.view','properties.create','properties.edit',
  'clients.view','clients.create','clients.edit',
  'leads.view','leads.edit',
  'appointments.view','appointments.create','appointments.edit',
  'deals.view','deals.create','deals.edit',
  'documents.view','documents.upload',
  'owners.view','owners.create',
  'commissions.view','reports.view','settings.view'
 ];
 missing_count integer;
begin
 if (select count(*) from public.plans where code in ('BASIC','PRO') and billing_cycle='MONTHLY' and active)=2
    and (select count(*) from public.permissions)=47
    and (select count(*) from public.plan_features where feature_key like 'permission:%')=0
 then
   select count(*) into missing_count from unnest(basic_keys) as k
     where not exists(select 1 from public.permissions per where per.key=k);
   if missing_count>0 then raise exception 'Required BASIC permission catalog missing'; end if;
   insert into public.plan_features(plan_id,feature_key,enabled)
      select p.id,'permission:'||per.key,true
      from public.plans p cross join public.permissions per
      where p.code='PRO' and p.billing_cycle='MONTHLY' and p.active
      on conflict(plan_id,feature_key) do nothing;
   insert into public.plan_features(plan_id,feature_key,enabled)
      select p.id,'permission:'||k,true
      from public.plans p cross join unnest(basic_keys) as k
      where p.code='BASIC' and p.billing_cycle='MONTHLY' and p.active
      on conflict(plan_id,feature_key) do nothing;
 else
   raise exception 'Unexpected plan catalog state: manual review required';
 end if;
end $$;
commit;
