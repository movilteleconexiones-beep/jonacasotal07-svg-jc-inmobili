-- Licensing model v2: SaaS vs dedicated control, legal responsibility and mandatory acceptance.
-- No destructive data operations. Existing organizations without a license are backfilled as SAAS.

update public.license_terms_versions
set active = false
where active = true;

insert into public.license_terms_versions(
  version,title,summary,terms_markdown,effective_date,active
)
values (
  '2.0',
  'Términos de Licencia y Responsabilidad — INMOJCO',
  'Define las modalidades SaaS y dedicada, mantiene la propiedad intelectual en INMOJCO y asigna a cada inmobiliaria la responsabilidad por su operación, legalidad, seguros, contratos y servicios profesionales.',
  $$# Términos de Licencia y Responsabilidad — INMOJCO

## 1. Naturaleza del software
INMOJCO proporciona una plataforma tecnológica para apoyar la gestión inmobiliaria. El software es una herramienta de información, organización, automatización y seguimiento y, por sí mismo, no constituye una inmobiliaria, aseguradora, corredor de seguros, firma de abogados, notaría, fiduciaria, entidad financiera, avaluador ni prestador profesional de los negocios gestionados por cada organización usuaria.

## 2. Modalidades de licencia
### SaaS mensual o anual
La organización recibe un derecho de uso durante la vigencia de su suscripción y conforme al plan contratado. INMOJCO conserva la identidad principal del software y puede aplicar límites de usuarios, propiedades, almacenamiento, módulos, automatizaciones, inteligencia artificial u otras capacidades según el plan.

### Licencia dedicada, perpetua o personalizada
La organización puede recibir control operativo ampliado o total sobre su instalación, usuarios, roles, configuraciones, identidad visual, dominio, datos e integraciones, según el contrato comercial. Cuando la licencia lo permita, podrá utilizar marca blanca dentro de su propia operación.

El control operativo total no equivale a transferencia de derechos de autor ni de propiedad intelectual.

## 3. Propiedad intelectual
Salvo acuerdo escrito expreso en contrario, los derechos de autor, código fuente, arquitectura, diseño funcional, estructura de base de datos, documentación, actualizaciones y demás propiedad intelectual del software continúan perteneciendo a INMOJCO o a su titular/licenciante.

## 4. Prohibición de reventa y redistribución
Ninguna modalidad autoriza por sí sola a vender, revender, sublicenciar, alquilar, clonar, publicar, distribuir, franquiciar o comercializar el software a terceros. Cualquier derecho de distribución requerirá un acuerdo escrito independiente.

## 5. Responsabilidad de la organización usuaria
Cada inmobiliaria, empresa o profesional que utilice el software es exclusivamente responsable de su actividad empresarial y profesional, incluyendo:
- cumplimiento de la legislación inmobiliaria, comercial, tributaria, laboral, de consumo y de protección de datos aplicable;
- licencias, matrículas, registros profesionales, autorizaciones y permisos requeridos;
- veracidad, legalidad y actualización de la información de propiedades, propietarios, compradores, arrendatarios, proveedores y demás terceros;
- contratos de compraventa, arrendamiento, administración, corretaje, consignación y documentos utilizados en su operación;
- avalúos, estudios, conceptos, dictámenes y asesorías profesionales;
- pólizas, seguros, garantías, fianzas, coberturas y productos ofrecidos, contratados o gestionados;
- recepción, custodia, transferencia o administración de dinero, cánones, depósitos, anticipos, comisiones y demás recursos;
- actos y omisiones de sus propietarios, administradores, empleados, contratistas, agentes, asesores y proveedores;
- obligaciones frente a sus clientes, propietarios, compradores, arrendatarios, autoridades y terceros.

## 6. Proveedores externos
Cuando la plataforma permita registrar o gestionar servicios jurídicos, notariales, financieros, aseguradores, técnicos, de mantenimiento, avalúo u otros, la responsabilidad por su prestación corresponde a la organización usuaria y/o al proveedor efectivamente contratado. La presencia de una función, campo, plantilla o referencia dentro del software no implica que INMOJCO preste, garantice, certifique o respalde dicho servicio.

## 7. Sin asesoría profesional de INMOJCO
El uso del software no constituye asesoría jurídica, tributaria, financiera, aseguradora, notarial ni inmobiliaria por parte de INMOJCO. Las decisiones empresariales y profesionales deben ser adoptadas por la organización usuaria y, cuando corresponda, con sus asesores o proveedores autorizados.

## 8. Datos del cliente
Los datos introducidos por cada organización corresponden a dicha organización o a sus legítimos titulares. La organización usuaria es responsable de contar con bases legales, autorizaciones y medidas necesarias para su tratamiento conforme a la normativa aplicable.

## 9. Marca blanca
La autorización de personalizar nombre, logotipo, colores, dominio o apariencia no transfiere la autoría ni la propiedad intelectual del software.

## 10. Aceptación y trazabilidad
El propietario de la organización debe aceptar la versión vigente de estos términos para utilizar los módulos operativos del sistema. La plataforma registra la versión aceptada, usuario y fecha de aceptación.

Estos términos tecnológicos no sustituyen el contrato comercial específico ni la revisión jurídica que corresponda en cada país.$$,
  current_date,
  true
)
on conflict (version) do update set
  title = excluded.title,
  summary = excluded.summary,
  terms_markdown = excluded.terms_markdown,
  effective_date = excluded.effective_date,
  active = true;

-- Backfill a conservative SaaS license for organizations that predate licensing.
insert into public.organization_licenses(
  organization_id,license_type,status,operational_control_full,
  copyright_transferred,resale_allowed,sublicensing_allowed,
  redistribution_allowed,white_label_allowed,terms_version_id
)
select
  o.id,'SAAS','ACTIVE',false,false,false,false,false,false,t.id
from public.organizations o
cross join lateral (
  select id from public.license_terms_versions
  where active = true
  order by effective_date desc, created_at desc
  limit 1
) t
where not exists (
  select 1 from public.organization_licenses l where l.organization_id = o.id
);

-- Point all current licenses at the current terms version without changing their commercial rights.
update public.organization_licenses l
set terms_version_id = t.id,
    updated_at = now()
from (
  select id from public.license_terms_versions
  where active = true
  order by effective_date desc, created_at desc
  limit 1
) t
where l.terms_version_id is distinct from t.id;

-- Every newly created organization starts in SaaS mode.
-- Dedicated/lifetime rights are granted only through the platform commercial control.
create or replace function public.create_organization_with_owner(
  org_name text,
  org_slug text,
  org_country_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cp public.country_profiles%rowtype;
  new_org_id uuid;
  new_member_id uuid;
  owner_role_id uuid;
  admin_role_id uuid;
  manager_role_id uuid;
  agent_role_id uuid;
  client_role_id uuid;
  active_pack_id uuid;
  active_terms_id uuid;
  basic_plan_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(org_name)) < 2 then raise exception 'Organization name is required'; end if;
  if org_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid organization slug'; end if;

  select * into cp from public.country_profiles
  where country_code = upper(org_country_code) and active = true;
  if cp.country_code is null then raise exception 'Unsupported country'; end if;

  select id into active_terms_id
  from public.license_terms_versions
  where active = true
  order by effective_date desc, created_at desc
  limit 1;

  select id into basic_plan_id
  from public.plans
  where code = 'BASIC' and active = true
  limit 1;

  insert into public.organizations(name,slug,status,plan_id)
  values(trim(org_name),lower(trim(org_slug)),'ACTIVE',basic_plan_id)
  returning id into new_org_id;

  insert into public.organization_members(organization_id,user_id,status,joined_at)
  values(new_org_id,auth.uid(),'ACTIVE',now())
  returning id into new_member_id;

  -- SaaS keeps INMOJCO/JCO as software brand while the customer company name is independent.
  insert into public.organization_branding(organization_id,company_name,software_name)
  values(new_org_id,trim(org_name),'Sistema Inmobiliario JCO');

  insert into public.organization_settings(
    organization_id,default_currency,country,timezone,language,locale
  ) values(
    new_org_id,cp.currency_code,cp.country_code,cp.timezone,cp.language,cp.locale
  );

  insert into public.organization_licenses(
    organization_id,license_type,status,operational_control_full,
    copyright_transferred,resale_allowed,sublicensing_allowed,
    redistribution_allowed,white_label_allowed,terms_version_id
  ) values(
    new_org_id,'SAAS','ACTIVE',false,false,false,false,false,false,active_terms_id
  );

  if basic_plan_id is not null then
    insert into public.subscriptions(
      organization_id,plan_id,status,billing_mode,
      started_at,current_period_start,current_period_end,trial_ends_at
    ) values(
      new_org_id,basic_plan_id,'TRIAL','SAAS_MONTHLY',
      now(),now(),now()+interval '14 days',now()+interval '14 days'
    )
    on conflict (organization_id) do nothing;
  end if;

  select id into active_pack_id from public.compliance_packs
  where country_code = cp.country_code and status = 'ACTIVE'
  order by effective_date desc nulls last, created_at desc
  limit 1;

  insert into public.organization_compliance(organization_id,compliance_pack_id,status)
  values(
    new_org_id,
    active_pack_id,
    case when active_pack_id is null then 'REVIEW_REQUIRED' else 'ACTIVE' end
  );

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'ORGANIZATION_OWNER','Propietario','Control de la operación de la organización según la modalidad de licencia.',true,true)
  returning id into owner_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'ADMIN','Administrador','Administración operativa de la inmobiliaria.',true,true)
  returning id into admin_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'MANAGER','Coordinador','Coordina asesores, clientes y operación comercial.',true,true)
  returning id into manager_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'AGENT','Asesor','Gestiona propiedades, leads, clientes, visitas y negocios asignados.',true,true)
  returning id into agent_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'CLIENT','Cliente','Acceso privado únicamente a información vinculada mediante el portal.',true,true)
  returning id into client_role_id;

  insert into public.member_roles(organization_member_id,role_id)
  values(new_member_id,owner_role_id);

  insert into public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    new_org_id,auth.uid(),'organization.created','organization',new_org_id,
    jsonb_build_object(
      'name',trim(org_name),
      'slug',lower(trim(org_slug)),
      'country',cp.country_code,
      'license_type','SAAS',
      'terms_acceptance_required',true
    )
  );

  return new_org_id;
end;
$$;

create or replace function public.create_organization_with_owner(
  org_name text,
  org_slug text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.create_organization_with_owner(org_name,org_slug,'CO');
$$;

revoke all on function public.create_organization_with_owner(text,text,text) from public,anon;
revoke all on function public.create_organization_with_owner(text,text) from public,anon;
grant execute on function public.create_organization_with_owner(text,text,text) to authenticated;
grant execute on function public.create_organization_with_owner(text,text) to authenticated;

-- Commercial changes also synchronize the effective license rights.
create or replace function public.platform_set_subscription(
  target_org uuid,
  target_plan_code text,
  target_billing_mode text,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_id uuid;
  active_terms_id uuid;
  effective_license_type text;
  full_control boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Permission denied';
  end if;

  select id into target_plan_id from public.plans
  where code = target_plan_code
  limit 1;

  if target_plan_id is null then raise exception 'Unknown plan'; end if;

  select id into active_terms_id
  from public.license_terms_versions
  where active = true
  order by effective_date desc, created_at desc
  limit 1;

  effective_license_type :=
    case
      when target_billing_mode = 'DEDICATED' then 'DEDICATED'
      when target_billing_mode = 'LIFETIME' then 'LIFETIME'
      when target_billing_mode = 'CUSTOM' then 'CUSTOM'
      else 'SAAS'
    end;

  full_control := target_billing_mode in ('DEDICATED','LIFETIME','CUSTOM');

  insert into public.subscriptions(
    organization_id,plan_id,status,billing_mode,
    current_period_start,current_period_end,updated_at
  )
  values(
    target_org,target_plan_id,target_status,target_billing_mode,
    now(),
    case
      when target_billing_mode = 'SAAS_MONTHLY' then now() + interval '1 month'
      when target_billing_mode = 'SAAS_ANNUAL' then now() + interval '1 year'
      else null
    end,
    now()
  )
  on conflict (organization_id) do update set
    plan_id = excluded.plan_id,
    status = excluded.status,
    billing_mode = excluded.billing_mode,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    updated_at = now();

  insert into public.organization_licenses(
    organization_id,license_type,status,operational_control_full,
    copyright_transferred,resale_allowed,sublicensing_allowed,
    redistribution_allowed,white_label_allowed,terms_version_id,updated_at
  ) values(
    target_org,effective_license_type,
    case when target_status in ('SUSPENDED','CANCELLED') then 'SUSPENDED' else 'ACTIVE' end,
    full_control,
    false,false,false,false,
    full_control,
    active_terms_id,
    now()
  )
  on conflict (organization_id) do update set
    license_type = excluded.license_type,
    status = excluded.status,
    operational_control_full = excluded.operational_control_full,
    copyright_transferred = false,
    resale_allowed = false,
    sublicensing_allowed = false,
    redistribution_allowed = false,
    white_label_allowed = excluded.white_label_allowed,
    terms_version_id = excluded.terms_version_id,
    updated_at = now();

  update public.organizations
  set
    plan_id = target_plan_id,
    status = case
      when target_status = 'SUSPENDED' then 'SUSPENDED'
      when target_status in ('ACTIVE','LIFETIME','TRIAL') then 'ACTIVE'
      else status
    end,
    updated_at = now()
  where id = target_org;
end;
$$;

revoke all on function public.platform_set_subscription(uuid,text,text,text) from public,anon;
grant execute on function public.platform_set_subscription(uuid,text,text,text) to authenticated;
