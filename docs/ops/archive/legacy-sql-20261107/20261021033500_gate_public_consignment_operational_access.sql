-- Do not accept website consignments for agencies without operational access.
-- Use the same billing/trial entitlement predicate as the public catalog and CRM lead RPC.
-- Replace definitions without changing signatures, grants or private receipt behavior.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_property_intake_site(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('slug', s.slug, 'company_name', o.name,
    'country', coalesce(os.country, 'CO'), 'currency', coalesce(os.default_currency, 'COP'))
  from private.property_intake_sites s
  join public.organizations o on o.id = s.organization_id and o.status = 'ACTIVE'
  left join public.organization_settings os on os.organization_id = o.id
  where s.slug = p_slug and s.enabled
    and coalesce(os.enable_public_website, true)
    and jco_private.operational_access(o.id);
$function$;


CREATE OR REPLACE FUNCTION public.submit_property_consignment(p_site_slug text, p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
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
    where s.slug = p_site_slug and s.enabled and coalesce(os.enable_public_website, true)
      and jco_private.operational_access(o.id);
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
$function$;

COMMIT;
