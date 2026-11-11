-- G07 #370 | REVIEW ONLY | 2026-11-11
-- NEVER push the frozen Supabase migration directory (#104).
-- No changes to production until fresh restore evidence + isolated PG17/HTTP
-- and approval of each agency's legally valid policy.
-- This script is a single transaction; a published URL alone does not
-- establish approval. Operator signs and records a verified SHA-256.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Expected postgres migration executor'; END IF;
  IF to_regclass('private.consignment_policy_approvals') IS NOT NULL
    OR to_regclass('private.consignment_policy_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Consignment legal gate already exists; verify provenance before applying';
  END IF;
  IF to_regprocedure('public.submit_property_consignment(text,uuid,jsonb)') IS NULL
    OR to_regprocedure('public.get_public_property_intake_site(text)') IS NULL
    OR to_regclass('public.organization_branding') IS NULL THEN
    RAISE EXCEPTION 'Required consignment and branding baseline missing';
  END IF;
END $preflight$;

CREATE FUNCTION private.consignment_policy_url_valid(raw_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $validator$
  SELECT raw_url IS NOT NULL AND length(raw_url) BETWEEN 12 AND 1500
    AND raw_url = lower(btrim(raw_url))
    AND raw_url ~ '^https://[a-z0-9.-]+(:443)?/[^/?#[:space:]][^?#[:space:]]*$'
    AND (
      raw_url !~ '^https://(www\.)?inmojco\.com(:443)?/'
      OR raw_url ~ '^https://(www\.)?inmojco\.com(:443)?/(politicas/[^/?#[:space:]]+|politica-de-datos|politica-de-privacidad|privacidad)(/[^?#[:space:]]*)?$'
    );
$validator$;

REVOKE ALL ON FUNCTION private.consignment_policy_url_valid(text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.consignment_policy_approvals(
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_url text NOT NULL CHECK(private.consignment_policy_url_valid(policy_url)),
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 80),
  approved_document_sha256 text NOT NULL CHECK(approved_document_sha256 ~ '^[0-9a-f]{64}$'),
  approval_reference text NOT NULL CHECK(length(btrim(approval_reference)) BETWEEN 8 AND 200),
  approved_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK(revoked_at IS NULL OR revoked_at >= approved_at)
);
ALTER TABLE private.consignment_policy_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.consignment_policy_approvals
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.consignment_policy_receipts(
  consignment_id uuid PRIMARY KEY REFERENCES public.property_consignments(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL,
  policy_url text NOT NULL CHECK(private.consignment_policy_url_valid(policy_url)),
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 80),
  approved_document_sha256 text NOT NULL CHECK(approved_document_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 bytea NOT NULL CHECK(octet_length(payload_sha256)=32),
  consented_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,request_id)
    REFERENCES public.property_consignments(organization_id,request_id) ON DELETE CASCADE,
  UNIQUE(organization_id,request_id)
);
ALTER TABLE private.consignment_policy_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.consignment_policy_receipts
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_public_property_intake_site(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('slug', s.slug, 'company_name', o.name,
    'country', coalesce(os.country, 'CO'), 'currency', coalesce(os.default_currency, 'COP'),
    'policy_url', a.policy_url, 'policy_version', a.policy_version)
  from private.property_intake_sites s
  join public.organizations o on o.id = s.organization_id and o.status = 'ACTIVE'
  left join public.organization_settings os on os.organization_id = o.id
  join public.organization_branding b on b.organization_id = o.id
  join private.consignment_policy_approvals a on a.organization_id = o.id
    and a.revoked_at is null
    and a.policy_url = b.public_page_content->>'privacyPolicyUrl'
    and private.consignment_policy_url_valid(a.policy_url)
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
  v_consignment_id uuid;
  v_policy_url text;
  v_policy_version text;
  v_document_sha256 text;
  v_submission_sha256 bytea;
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
      and jco_private.operational_access(o.id)
    for share of s;
  if not found then
    raise exception using errcode = 'P0002', message = 'intake_unavailable';
  end if;
  -- This approval record is operator-controlled and cannot be created by
  -- the anonymous form or by an ordinary agency account. Lock it and the
  -- currently published URL against changes until the consent is persisted.
  select a.policy_url,a.policy_version,a.approved_document_sha256
    into v_policy_url,v_policy_version,v_document_sha256
    from private.consignment_policy_approvals a
    join public.organization_branding b on b.organization_id=a.organization_id
    where a.organization_id=v_site.organization_id
      and a.revoked_at is null
      and private.consignment_policy_url_valid(a.policy_url)
      and b.public_page_content->>'privacyPolicyUrl'=a.policy_url
    for share of a,b;
  if not found then
    raise exception using errcode = 'P0002', message = 'intake_unavailable';
  end if;
  select coalesce(os.country,'CO'), coalesce(os.default_currency,'COP') into v_country, v_currency
    from (select 1) defaults left join public.organization_settings os on os.organization_id = v_site.organization_id;
  v_payload := (p_payload - 'owner_name' - 'owner_phone' - 'contact_consent')
    || jsonb_build_object('title', btrim(p_payload ->> 'title'), 'state', btrim(p_payload ->> 'state'),
      'city', btrim(p_payload ->> 'city'), 'neighborhood', btrim(p_payload ->> 'neighborhood'),
      'description', btrim(p_payload ->> 'description'), 'country', v_country, 'currency', v_currency);

  v_submission_sha256 := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(v_name,v_phone,v_payload)::text,'UTF8'));
  -- Serialize retries and quota checks per tenant to prevent concurrent bypass.
  perform pg_advisory_xact_lock(hashtextextended('property-intake:' || v_site.organization_id::text, 0));
  select * into v_existing from public.property_consignments
    where organization_id = v_site.organization_id and request_id = p_request_id;
  if found then
    if v_existing.payload <> v_payload or v_existing.contact_name <> v_name or v_existing.contact_phone <> v_phone
      or not exists (
        select 1 from private.consignment_policy_receipts receipt
        where receipt.consignment_id=v_existing.id
          and receipt.organization_id=v_site.organization_id
          and receipt.request_id=p_request_id
          and receipt.payload_sha256=v_submission_sha256
      ) then
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
    returning id,reference into v_consignment_id,v_reference;
  -- Same transaction: any receipt failure aborts the PII insert as well.
  insert into private.consignment_policy_receipts(
    consignment_id,organization_id,request_id,policy_url,policy_version,
    approved_document_sha256,payload_sha256
  ) values(
    v_consignment_id,v_site.organization_id,p_request_id,v_policy_url,
    v_policy_version,v_document_sha256,v_submission_sha256
  );
  return jsonb_build_object('reference', v_reference);
end;
$function$;



DO $postflight$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.consignment_policy_approvals'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.consignment_policy_receipts'::regclass)
    OR has_table_privilege('anon','private.consignment_policy_receipts','SELECT')
    OR has_table_privilege('authenticated','private.consignment_policy_approvals','INSERT')
    OR NOT has_function_privilege('anon','public.get_public_property_intake_site(text)','EXECUTE')
    OR NOT has_function_privilege('anon','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'G07 postflight ACL or RLS failed'; END IF;
END $postflight$;
COMMIT;
