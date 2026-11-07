-- Repair missing production features from placeholder migrations 0010, 0013, 0017 and 0018.
-- Intentionally does NOT enable RLS on organization_invitations/invitation_roles.
-- Policies are prepared first; RLS activation requires explicit approval.

create table if not exists public.license_terms_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  summary text,
  terms_markdown text not null,
  effective_date date not null default current_date,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  license_type text not null default 'SAAS'
    check (license_type in ('SAAS','LIFETIME','DEDICATED','WHITE_LABEL','CUSTOM')),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','SUSPENDED','EXPIRED','CANCELLED')),
  operational_control_full boolean not null default false,
  copyright_transferred boolean not null default false,
  resale_allowed boolean not null default false,
  sublicensing_allowed boolean not null default false,
  redistribution_allowed boolean not null default false,
  white_label_allowed boolean not null default false,
  terms_version_id uuid references public.license_terms_versions(id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.license_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_license_id uuid not null references public.organization_licenses(id) on delete cascade,
  terms_version_id uuid not null references public.license_terms_versions(id) on delete restrict,
  accepted_by uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  user_agent text,
  unique (organization_license_id, terms_version_id, accepted_by)
);

insert into public.license_terms_versions(version,title,summary,terms_markdown,effective_date,active)
values (
  '1.0',
  'Términos de Licencia — SISTEMA INMOBILIARIO JCO',
  'La licencia concede derechos de uso y operación; no transfiere derechos de autor ni permite reventa, sublicenciamiento o redistribución salvo acuerdo escrito.',
  $$# Términos de Licencia — SISTEMA INMOBILIARIO JCO

La compra de una licencia, incluso perpetua o con control operativo total, no transfiere los derechos de autor ni concede derecho de reventa, sublicenciamiento o redistribución del software.

## Control operativo
La modalidad contratada puede permitir administrar usuarios, roles, permisos, datos, configuraciones, identidad visual, dominio e integraciones.

## Propiedad intelectual
Los derechos de autor, arquitectura, diseño funcional, código fuente, estructura de base de datos y documentación continúan perteneciendo al titular o licenciante salvo acuerdo escrito expreso.

## Reventa y distribución
No se autoriza vender, revender, sublicenciar, alquilar, distribuir, clonar o comercializar el software para terceros sin autorización escrita independiente.

## Marca blanca
La personalización de nombre, logotipo, colores y dominio no transfiere autoría ni propiedad intelectual.

## Datos del cliente
Los datos comerciales, clientes, propiedades y documentos introducidos por cada inmobiliaria corresponden a dicha inmobiliaria o a sus titulares conforme a la legislación aplicable.

## Aceptación
La aceptación electrónica, contractual o el uso del software podrá constituir aceptación cuando así se establezca en el proceso comercial.$$,
  current_date,
  true
)
on conflict (version) do update set
  title=excluded.title,
  summary=excluded.summary,
  terms_markdown=excluded.terms_markdown,
  active=true;

create index if not exists idx_license_acceptances_accepted_by on public.license_acceptances(accepted_by);
create index if not exists idx_license_acceptances_license on public.license_acceptances(organization_license_id);

alter table public.license_terms_versions enable row level security;
alter table public.organization_licenses enable row level security;
alter table public.license_acceptances enable row level security;

drop policy if exists license_terms_authenticated_read on public.license_terms_versions;
create policy license_terms_authenticated_read
on public.license_terms_versions for select to authenticated
using (active = true or public.is_platform_admin());

drop policy if exists license_terms_platform_manage on public.license_terms_versions;
create policy license_terms_platform_manage
on public.license_terms_versions for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists org_license_read on public.organization_licenses;
create policy org_license_read
on public.organization_licenses for select to authenticated
using (public.is_platform_admin() or public.is_org_member(organization_id));

drop policy if exists org_license_platform_manage on public.organization_licenses;
create policy org_license_platform_manage
on public.organization_licenses for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists license_acceptance_read on public.license_acceptances;
create policy license_acceptance_read
on public.license_acceptances for select to authenticated
using (
  accepted_by = (select auth.uid())
  or public.is_platform_admin()
  or exists (
    select 1 from public.organization_licenses l
    where l.id = organization_license_id and public.is_org_member(l.organization_id)
  )
);

drop policy if exists license_acceptance_insert on public.license_acceptances;
create policy license_acceptance_insert
on public.license_acceptances for insert to authenticated
with check (
  accepted_by = (select auth.uid())
  and exists (
    select 1 from public.organization_licenses l
    where l.id = organization_license_id and public.is_org_member(l.organization_id)
  )
);

create table if not exists public.portal_access_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  owner_id uuid references public.property_owners(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((contact_id is not null and owner_id is null) or (contact_id is null and owner_id is not null))
);

create unique index if not exists ux_portal_user_contact
on public.portal_access_links(organization_id,user_id,contact_id)
where contact_id is not null;

create unique index if not exists ux_portal_user_owner
on public.portal_access_links(organization_id,user_id,owner_id)
where owner_id is not null;

create index if not exists idx_portal_links_created_by on public.portal_access_links(created_by);
create index if not exists idx_portal_links_user on public.portal_access_links(user_id);

alter table public.portal_access_links enable row level security;

drop policy if exists portal_links_select on public.portal_access_links;
create policy portal_links_select
on public.portal_access_links for select to authenticated
using (
  user_id = (select auth.uid())
  or public.has_org_permission(organization_id,'users.view')
  or public.has_org_permission(organization_id,'users.edit')
);

drop policy if exists portal_links_insert on public.portal_access_links;
create policy portal_links_insert
on public.portal_access_links for insert to authenticated
with check (
  public.has_org_permission(organization_id,'users.edit')
  and created_by = (select auth.uid())
);

drop policy if exists portal_links_delete on public.portal_access_links;
create policy portal_links_delete
on public.portal_access_links for delete to authenticated
using (public.has_org_permission(organization_id,'users.edit'));

create or replace function public.has_portal_contact(target_contact uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.portal_access_links l
    where l.user_id=(select auth.uid()) and l.contact_id=target_contact
  );
$$;

create or replace function public.has_portal_owner(target_owner uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.portal_access_links l
    where l.user_id=(select auth.uid()) and l.owner_id=target_owner
  );
$$;

create or replace function public.has_portal_property(target_property uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1
    from public.portal_access_links l
    where l.user_id=(select auth.uid())
      and (
        exists (
          select 1 from public.property_ownerships po
          where po.property_id=target_property and po.owner_id=l.owner_id
        )
        or exists (
          select 1 from public.appointments a
          where a.property_id=target_property and a.contact_id=l.contact_id
        )
        or exists (
          select 1 from public.deals d
          where d.property_id=target_property and d.contact_id=l.contact_id
        )
        or exists (
          select 1 from public.leads le
          where le.property_id=target_property and le.contact_id=l.contact_id
        )
      )
  );
$$;

revoke all on function public.has_portal_contact(uuid) from public,anon;
revoke all on function public.has_portal_owner(uuid) from public,anon;
revoke all on function public.has_portal_property(uuid) from public,anon;
grant execute on function public.has_portal_contact(uuid) to authenticated;
grant execute on function public.has_portal_owner(uuid) to authenticated;
grant execute on function public.has_portal_property(uuid) to authenticated;

drop policy if exists properties_portal_select on public.properties;
create policy properties_portal_select on public.properties for select to authenticated
using (public.has_portal_property(id));

drop policy if exists appointments_portal_select on public.appointments;
create policy appointments_portal_select on public.appointments for select to authenticated
using (public.has_portal_contact(contact_id) or public.has_portal_property(property_id));

drop policy if exists deals_portal_select on public.deals;
create policy deals_portal_select on public.deals for select to authenticated
using (public.has_portal_contact(contact_id) or public.has_portal_property(property_id));

drop policy if exists leads_portal_select on public.leads;
create policy leads_portal_select on public.leads for select to authenticated
using (public.has_portal_contact(contact_id) or public.has_portal_property(property_id));

drop policy if exists activities_portal_select on public.activities;
create policy activities_portal_select on public.activities for select to authenticated
using (
  public.has_portal_contact(contact_id)
  or public.has_portal_property(property_id)
  or exists (
    select 1 from public.deals d
    where d.id=deal_id and (public.has_portal_contact(d.contact_id) or public.has_portal_property(d.property_id))
  )
);

drop policy if exists documents_portal_select on public.documents;
create policy documents_portal_select on public.documents for select to authenticated
using (
  (entity_type='CONTACT' and public.has_portal_contact(entity_id))
  or (entity_type='OWNER' and public.has_portal_owner(entity_id))
  or (entity_type='PROPERTY' and public.has_portal_property(entity_id))
  or (entity_type='USER' and entity_id=(select auth.uid()))
  or (entity_type='DEAL' and exists (
    select 1 from public.deals d
    where d.id=entity_id and (public.has_portal_contact(d.contact_id) or public.has_portal_property(d.property_id))
  ))
  or (entity_type='LEAD' and exists (
    select 1 from public.leads l
    where l.id=entity_id and (public.has_portal_contact(l.contact_id) or public.has_portal_property(l.property_id))
  ))
);

drop policy if exists portal_docs_storage_select on storage.objects;
create policy portal_docs_storage_select
on storage.objects for select to authenticated
using (
  bucket_id='organization-documents'
  and exists (
    select 1 from public.documents d
    where d.storage_bucket=bucket_id and d.storage_path=name
  )
);

create or replace function public.claim_my_invitations()
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt()->>'email',''));
  invitation record;
  member_id uuid;
begin
  if current_user_id is null or current_email='' then return; end if;

  for invitation in
    select i.*
    from public.organization_invitations i
    where lower(i.email)=current_email
      and i.status='PENDING'
      and i.expires_at > now()
  loop
    insert into public.organization_members(organization_id,user_id,status,joined_at)
    values(invitation.organization_id,current_user_id,'ACTIVE',now())
    on conflict (organization_id,user_id) do update
      set status='ACTIVE',
          joined_at=coalesce(public.organization_members.joined_at,excluded.joined_at)
    returning id into member_id;

    insert into public.member_roles(organization_member_id,role_id)
    select member_id,ir.role_id
    from public.invitation_roles ir
    join public.roles r on r.id=ir.role_id
    where ir.invitation_id=invitation.id
      and r.organization_id=invitation.organization_id
    on conflict do nothing;

    update public.organization_invitations
    set status='ACCEPTED',accepted_by=current_user_id,accepted_at=now()
    where id=invitation.id;
  end loop;
end;
$$;

revoke all on function public.claim_my_invitations() from public,anon;
grant execute on function public.claim_my_invitations() to authenticated;

create or replace function public.create_custom_role(
  target_org uuid,
  role_name text,
  role_description text,
  permission_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  new_role_id uuid;
begin
  if not public.has_org_permission(target_org,'roles.create') then
    raise exception 'Permission denied';
  end if;

  insert into public.roles(organization_id,name,description,is_system_role,active)
  values(target_org,trim(role_name),nullif(trim(role_description),''),false,true)
  returning id into new_role_id;

  insert into public.role_permissions(role_id,permission_id)
  select new_role_id,p.id
  from public.permissions p
  where p.key=any(permission_keys)
  on conflict do nothing;

  return new_role_id;
end;
$$;

revoke all on function public.create_custom_role(uuid,text,text,text[]) from public,anon;
grant execute on function public.create_custom_role(uuid,text,text,text[]) to authenticated;

-- Prepare invitation policies before RLS is enabled.
drop policy if exists invitations_select_admin on public.organization_invitations;
create policy invitations_select_admin
on public.organization_invitations for select to authenticated
using (
  public.has_org_permission(organization_id,'users.view')
  or public.has_org_permission(organization_id,'users.create')
);

drop policy if exists invitations_update_admin on public.organization_invitations;
create policy invitations_update_admin
on public.organization_invitations for update to authenticated
using (public.has_org_permission(organization_id,'users.edit'))
with check (public.has_org_permission(organization_id,'users.edit'));

drop policy if exists invitations_delete_admin on public.organization_invitations;
create policy invitations_delete_admin
on public.organization_invitations for delete to authenticated
using (public.has_org_permission(organization_id,'users.edit'));

drop policy if exists invitation_roles_select_admin on public.invitation_roles;
create policy invitation_roles_select_admin
on public.invitation_roles for select to authenticated
using (
  exists (
    select 1 from public.organization_invitations i
    where i.id=invitation_id
      and (
        public.has_org_permission(i.organization_id,'users.view')
        or public.has_org_permission(i.organization_id,'users.create')
      )
  )
);

drop policy if exists invitation_roles_insert_admin on public.invitation_roles;
create policy invitation_roles_insert_admin
on public.invitation_roles for insert to authenticated
with check (
  exists (
    select 1 from public.organization_invitations i
    join public.roles r on r.id=role_id
    where i.id=invitation_id
      and r.organization_id=i.organization_id
      and public.has_org_permission(i.organization_id,'users.create')
  )
);

drop policy if exists invitation_roles_delete_admin on public.invitation_roles;
create policy invitation_roles_delete_admin
on public.invitation_roles for delete to authenticated
using (
  exists (
    select 1 from public.organization_invitations i
    where i.id=invitation_id
      and public.has_org_permission(i.organization_id,'users.edit')
  )
);
