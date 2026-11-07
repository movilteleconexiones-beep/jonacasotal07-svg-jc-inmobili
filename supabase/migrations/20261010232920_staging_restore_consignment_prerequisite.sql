-- Public intake writes only to a private review queue. Inventory and CRM writes
-- require an authenticated reviewer with the existing tenant permissions.
begin;

create schema if not exists private;

create table private.property_intake_sites (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  hourly_limit integer not null default 60 check (hourly_limit between 1 and 1000),
  daily_limit integer not null default 500 check (daily_limit between 1 and 10000)
);
alter table private.property_intake_sites enable row level security;
revoke all on private.property_intake_sites from public, anon, authenticated;

create table public.property_consignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  reference text generated always as ('CON-' || upper(id::text)) stored unique,
  contact_name text not null check (char_length(contact_name) between 3 and 120),
  contact_phone text not null check (contact_phone ~ '^[0-9]{7,15}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'NEW' check (status in ('NEW','ACCEPTED','REJECTED')),
  property_id uuid references public.properties(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_notes text check (char_length(review_notes) <= 1000),
  unique (organization_id, request_id),
  check ((status = 'NEW' and reviewed_at is null and reviewed_by is null)
    or (status <> 'NEW' and reviewed_at is not null and reviewed_by is not null)),
  check ((status = 'ACCEPTED' and property_id is not null and contact_id is not null and lead_id is not null)
    or (status <> 'ACCEPTED' and property_id is null and contact_id is null and lead_id is null))
);
create index property_consignments_org_created on public.property_consignments(organization_id, created_at desc);
create index property_consignments_org_phone_created on public.property_consignments(organization_id, contact_phone, created_at desc);
create index property_consignments_reviewed_by on public.property_consignments(reviewed_by) where reviewed_by is not null;
create index property_consignments_property on public.property_consignments(property_id) where property_id is not null;
create index property_consignments_contact on public.property_consignments(contact_id) where contact_id is not null;
create index property_consignments_lead on public.property_consignments(lead_id) where lead_id is not null;
alter table public.property_consignments enable row level security;
revoke all on public.property_consignments from public, anon, authenticated;
grant select on public.property_consignments to authenticated;
grant all on public.property_consignments to service_role;
create policy property_consignments_read on public.property_consignments for select to authenticated
using (public.has_org_permission(organization_id, 'properties.view')
  and public.has_org_permission(organization_id, 'clients.view'));

-- This old policy exposed every tenant's inventory, including DRAFT records.
-- The public catalog currently uses sample data and needs no direct table grant.
drop policy if exists "Permitir lectura publica de propiedades" on public.properties;

-- Intentional public projection: no tenant IDs, contact details, or private settings.
create function public.get_public_property_intake_site(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug', s.slug, 'company_name', o.name,
    'country', coalesce(os.country, 'CO'), 'currency', coalesce(os.default_currency, 'COP'))
  from private.property_intake_sites s
  join public.organizations o on o.id = s.organization_id and o.status = 'ACTIVE'
  left join public.organization_settings os on os.organization_id = o.id
  where s.slug = p_slug and s.enabled
    and coalesce(os.enable_public_website, true);
$$;
revoke all on function public.get_public_property_intake_site(text) from public, anon, authenticated;
grant execute on function public.get_public_property_intake_site(text) to anon, authenticated;

-- Intentional anonymous endpoint. It cannot read submissions, change the tenant,
-- publish inventory, modify roles, or accept caller-controlled review fields.
create function public.submit_property_consignment(p_site_slug text, p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_site private.property_intake_sites%rowtype;
  v_existing public.property_consignments%rowtype;
  v_payload jsonb;
  v_name text;
  v_phone text;
  v_field text;
  v_value numeric;
  v_country text;
  v_currency text;
  v_reference text;
begin
  if p_request_id is null or p_site_slug is null or char_length(p_site_slug) > 80
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 12000 then
    raise exception using errcode = '22023', message = 'invalid_consignment';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) k where k not in
    ('title','operation_type','property_type','price','lot_area','built_area','bedrooms','bathrooms',
     'parking_spaces','administration_fee','construction_year','state','city','neighborhood',
     'description','owner_name','owner_phone','contact_consent')) then
    raise exception using errcode = '22023', message = 'invalid_consignment';
  end if;
  if (p_payload -> 'contact_consent') is distinct from 'true'::jsonb then
    raise exception using errcode = '22023', message = 'contact_consent_required';
  end if;
  foreach v_field in array array['title','state','city','neighborhood','description','owner_name','owner_phone'] loop
    if jsonb_typeof(p_payload -> v_field) is distinct from 'string' then
      raise exception using errcode = '22023', message = 'invalid_consignment';
    end if;
  end loop;
  v_name := btrim(p_payload ->> 'owner_name');
  v_phone := regexp_replace(p_payload ->> 'owner_phone', '[^0-9]', '', 'g');
  if char_length(v_name) not between 3 and 120 or v_phone !~ '^[0-9]{7,15}$'
    or char_length(p_payload ->> 'owner_phone') > 40
    or (p_payload ->> 'owner_phone') !~ '^[+0-9 ()-]+$'
    or char_length(btrim(p_payload ->> 'title')) not between 5 and 160
    or char_length(btrim(p_payload ->> 'state')) not between 1 and 120
    or char_length(btrim(p_payload ->> 'city')) not between 1 and 120
    or char_length(btrim(p_payload ->> 'neighborhood')) > 160
    or char_length(btrim(p_payload ->> 'description')) > 2000
    or coalesce(p_payload ->> 'operation_type','') not in ('SALE','RENT','ADMINISTRATION')
    or coalesce(p_payload ->> 'property_type','') not in ('HOUSE','APARTMENT','COMMERCIAL') then
    raise exception using errcode = '22023', message = 'invalid_consignment';
  end if;
  foreach v_field in array array['price','lot_area','built_area','bedrooms','bathrooms','parking_spaces','administration_fee'] loop
    if jsonb_typeof(p_payload -> v_field) is distinct from 'number' then
      raise exception using errcode = '22023', message = 'invalid_consignment';
    end if;
    v_value := (p_payload ->> v_field)::numeric;
    if v_value < 0 or v_value > 10000000000000 or trunc(v_value, 2) <> v_value
      or (v_field in ('price','lot_area','built_area') and v_value <= 0)
      or (v_field in ('lot_area','built_area') and v_value > 100000000)
      or (v_field in ('bedrooms','bathrooms') and v_value > 500)
      or (v_field = 'parking_spaces' and v_value > 5000)
      or (v_field in ('bedrooms','parking_spaces') and trunc(v_value) <> v_value)
      or (v_field = 'bathrooms' and trunc(v_value * 2) <> v_value * 2) then
      raise exception using errcode = '22023', message = 'invalid_consignment';
    end if;
  end loop;
  if p_payload -> 'construction_year' is not null and p_payload -> 'construction_year' <> 'null'::jsonb then
    if jsonb_typeof(p_payload -> 'construction_year') <> 'number' then
      raise exception using errcode = '22023', message = 'invalid_consignment';
    end if;
    v_value := (p_payload ->> 'construction_year')::numeric;
    if trunc(v_value) <> v_value or v_value < 1800 or v_value > extract(year from current_date) then
      raise exception using errcode = '22023', message = 'invalid_consignment';
    end if;
  end if;

  select s.* into v_site from private.property_intake_sites s
    join public.organizations o on o.id = s.organization_id and o.status = 'ACTIVE'
    left join public.organization_settings os on os.organization_id = o.id
    where s.slug = p_site_slug and s.enabled and coalesce(os.enable_public_website, true);
  if not found then
    raise exception using errcode = 'P0002', message = 'intake_unavailable';
  end if;
  select coalesce(os.country,'CO'), coalesce(os.default_currency,'COP') into v_country, v_currency
    from (select 1) defaults left join public.organization_settings os on os.organization_id = v_site.organization_id;
  v_payload := (p_payload - 'owner_name' - 'owner_phone' - 'contact_consent')
    || jsonb_build_object('title', btrim(p_payload ->> 'title'), 'state', btrim(p_payload ->> 'state'),
      'city', btrim(p_payload ->> 'city'), 'neighborhood', btrim(p_payload ->> 'neighborhood'),
      'description', btrim(p_payload ->> 'description'), 'country', v_country, 'currency', v_currency);

  -- Serialize retries and quota checks per tenant to prevent concurrent bypass.
  perform pg_advisory_xact_lock(hashtextextended('property-intake:' || v_site.organization_id::text, 0));
  select * into v_existing from public.property_consignments
    where organization_id = v_site.organization_id and request_id = p_request_id;
  if found then
    if v_existing.payload <> v_payload or v_existing.contact_name <> v_name or v_existing.contact_phone <> v_phone then
      raise exception using errcode = '22023', message = 'consignment_request_conflict';
    end if;
    return jsonb_build_object('reference', v_existing.reference);
  end if;
  if (select count(*) from public.property_consignments where organization_id = v_site.organization_id
      and contact_phone = v_phone and created_at > now() - interval '24 hours') >= 3
    or (select count(*) from public.property_consignments where organization_id = v_site.organization_id
      and created_at > now() - interval '1 hour') >= v_site.hourly_limit
    or (select count(*) from public.property_consignments where organization_id = v_site.organization_id
      and created_at > now() - interval '24 hours') >= v_site.daily_limit then
    raise exception using errcode = 'P0001', message = 'intake_rate_limited';
  end if;
  insert into public.property_consignments(organization_id, request_id, contact_name, contact_phone, payload)
    values(v_site.organization_id, p_request_id, v_name, v_phone, v_payload)
    returning reference into v_reference;
  return jsonb_build_object('reference', v_reference);
end;
$$;
revoke all on function public.submit_property_consignment(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.submit_property_consignment(text,uuid,jsonb) to anon, authenticated;

create function public.review_property_consignment(p_id uuid, p_decision text, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_row public.property_consignments%rowtype;
  v_actor uuid := auth.uid();
  v_property uuid;
  v_contact uuid;
  v_lead uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'consignment_permission_denied';
  end if;
  if p_decision is null or p_decision not in ('ACCEPTED','REJECTED') or char_length(coalesce(p_notes,'')) > 1000 then
    raise exception using errcode = '22023', message = 'invalid_consignment_review';
  end if;
  select * into v_row from public.property_consignments where id = p_id for update;
  if not found or not public.has_org_permission(v_row.organization_id, 'properties.view')
    or not public.has_org_permission(v_row.organization_id, 'clients.view')
    or not public.has_org_permission(v_row.organization_id, 'properties.edit') then
    raise exception using errcode = '42501', message = 'consignment_permission_denied';
  end if;
  if not exists(select 1 from public.organizations where id = v_row.organization_id and status = 'ACTIVE') then
    raise exception using errcode = '42501', message = 'consignment_permission_denied';
  end if;
  if v_row.status = p_decision then
    return jsonb_build_object('status', v_row.status, 'property_id', v_row.property_id);
  elsif v_row.status <> 'NEW' then
    raise exception using errcode = '22023', message = 'consignment_already_reviewed';
  end if;
  if p_decision = 'ACCEPTED' then
    if not public.has_org_permission(v_row.organization_id, 'properties.create')
      or not public.has_org_permission(v_row.organization_id, 'clients.create')
      or not public.has_org_permission(v_row.organization_id, 'leads.edit') then
      raise exception using errcode = '42501', message = 'consignment_permission_denied';
    end if;
    insert into public.properties(organization_id, code, title, description, operation_type, property_type,
      status, price, currency, country, state, city, neighborhood, bedrooms, bathrooms,
      parking_spaces, built_area, lot_area, administration_fee, created_by)
    values(v_row.organization_id, v_row.reference, v_row.payload ->> 'title', v_row.payload ->> 'description',
      v_row.payload ->> 'operation_type', v_row.payload ->> 'property_type', 'DRAFT',
      (v_row.payload ->> 'price')::numeric, v_row.payload ->> 'currency', v_row.payload ->> 'country',
      v_row.payload ->> 'state', v_row.payload ->> 'city', v_row.payload ->> 'neighborhood',
      (v_row.payload ->> 'bedrooms')::numeric, (v_row.payload ->> 'bathrooms')::numeric,
      (v_row.payload ->> 'parking_spaces')::integer, (v_row.payload ->> 'built_area')::numeric,
      (v_row.payload ->> 'lot_area')::numeric, (v_row.payload ->> 'administration_fee')::numeric, v_actor)
    returning id into v_property;
    insert into public.contacts(organization_id, first_name, phone, source, notes, created_by)
      values(v_row.organization_id, v_row.contact_name, v_row.contact_phone, 'WEBSITE',
        'Contacto de consignación ' || v_row.reference || '; titularidad pendiente de verificación.', v_actor)
      returning id into v_contact;
    insert into public.leads(organization_id, contact_id, property_id, status, priority, desired_operation, notes, created_by)
      values(v_row.organization_id, v_contact, v_property, 'NEW', 'MEDIUM', v_row.payload ->> 'operation_type',
        'Consignación ' || v_row.reference || '. ' || coalesce(nullif(btrim(p_notes),''),'Revisión documental pendiente.'), v_actor)
      returning id into v_lead;
  end if;
  update public.property_consignments set status = p_decision, property_id = v_property,
    contact_id = v_contact, lead_id = v_lead, reviewed_by = v_actor, reviewed_at = now(),
    review_notes = nullif(btrim(p_notes),'') where id = v_row.id;
  return jsonb_build_object('status', p_decision, 'property_id', v_property);
end;
$$;
revoke all on function public.review_property_consignment(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_property_consignment(uuid,text,text) to authenticated;

commit;
