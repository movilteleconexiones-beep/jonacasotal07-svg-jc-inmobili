-- Private attachments for already-submitted public consignments.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('jco-consignment-photos','jco-consignment-photos',false,5242880,
array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,
allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create table if not exists public.property_consignment_photos (
 id uuid primary key default gen_random_uuid(),
 consignment_id uuid not null references public.property_consignments(id) on delete cascade,
 position integer not null check(position between 0 and 9),
 storage_path text not null unique,
 mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size between 1 and 5242880),
 created_at timestamptz not null default now(),
 unique(consignment_id,position)
);
create index if not exists property_consignment_photos_consignment_idx on public.property_consignment_photos(consignment_id);
alter table public.property_consignment_photos enable row level security;
revoke all on public.property_consignment_photos from public,anon,authenticated;
grant select on public.property_consignment_photos to authenticated;
grant all on public.property_consignment_photos to service_role;
create policy property_consignment_photos_reviewer_read on public.property_consignment_photos
 for select to authenticated using(exists (
 select 1 from public.property_consignments c where c.id=consignment_id
 and public.has_org_permission(c.organization_id,'properties.view')
 and public.has_org_permission(c.organization_id,'clients.view')));
-- Objects have no anonymous storage policies. Service role uploads only after the
-- Edge handler has verified the unguessable request id and tenant submission.
-- Service-role-only resolver avoids exposing the private tenant mapping through PostgREST.
create or replace function public.resolve_consignment_photo_submission(
 p_slug text,p_request_id uuid,p_reference text
) returns table(consignment_id uuid,organization_id uuid,created_at timestamptz,status text)
language sql security definer set search_path='' as $jco_photo$
 select c.id,c.organization_id,c.created_at,c.status
 from private.property_intake_sites s
 join public.property_consignments c on c.organization_id=s.organization_id
 where s.slug=p_slug and s.enabled and c.request_id=p_request_id
   and c.reference=p_reference and c.status='NEW'
   and c.created_at > now()-interval '1 hour'
   and exists(select 1 from public.organizations o where o.id=s.organization_id and o.status='ACTIVE')
 limit 1;
$jco_photo$;
revoke all on function public.resolve_consignment_photo_submission(text,uuid,text)
 from public,anon,authenticated;
grant execute on function public.resolve_consignment_photo_submission(text,uuid,text) to service_role;
commit;
