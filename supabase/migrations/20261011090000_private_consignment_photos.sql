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
commit;
