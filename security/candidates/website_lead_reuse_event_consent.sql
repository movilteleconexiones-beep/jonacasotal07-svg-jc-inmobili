-- CANDIDATE ONLY. Do not apply to production; not in supabase/migrations.
-- Assumes existing consent migration 20261021041500 is already present.
-- Review current production function definition, rollout/cutover and backups before promotion.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- New event-level evidence is immutable and inaccessible to anon/authenticated.
-- The legacy per-contact consent table remains untouched for historical records.
CREATE TABLE private.website_lead_consents (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  policy_url text NOT NULL
    CHECK (char_length(policy_url) BETWEEN 9 AND 1500 AND policy_url ~ '^https://[^[:space:]]+$'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  consent_method text NOT NULL DEFAULT 'PUBLIC_FORM_CHECKBOX'
    CHECK (consent_method = 'PUBLIC_FORM_CHECKBOX')
);
CREATE INDEX website_lead_consents_org_created_idx
  ON private.website_lead_consents (organization_id, consented_at DESC);

ALTER TABLE private.website_lead_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.website_lead_consents FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private.website_lead_consents IS
  'Each new CRM public inquiry has independent consent proof, not exposed in the Data API. Legacy receipts remain separately preserved.';

CREATE OR REPLACE FUNCTION public.submit_public_website_lead(
  p_slug text,
  p_name text,
  p_email text,
  p_phone text,
  p_service text,
  p_message text,
  p_consent boolean,
  p_trap text DEFAULT ''
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_org uuid;
  v_contact uuid;
  v_lead uuid;
  v_policy_url text;
  v_name text := btrim(COALESCE(p_name,''));
  v_email text := lower(btrim(COALESCE(p_email,'')));
  v_phone text := btrim(COALESCE(p_phone,''));
  v_service text := btrim(COALESCE(p_service,''));
  v_message text := btrim(COALESCE(p_message,''));
BEGIN
  -- Honeypot; do not tell a bot whether its input was rejected.
  IF btrim(COALESCE(p_trap,'')) <> '' THEN
    RETURN true;
  END IF;

  IF p_consent IS DISTINCT FROM true OR
     char_length(v_name) NOT BETWEEN 3 AND 120 OR
     char_length(v_email) NOT BETWEEN 6 AND 254 OR
     v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR
     char_length(v_phone) NOT BETWEEN 7 AND 32 OR
     char_length(regexp_replace(v_phone,'[^0-9]','','g')) NOT BETWEEN 7 AND 15 OR
     char_length(v_service) NOT BETWEEN 1 AND 90 OR
     char_length(v_message) > 2000 OR
     p_slug IS NULL OR
     length(p_slug) NOT BETWEEN 2 AND 80 OR
     p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  THEN
    RAISE EXCEPTION 'Revisa el consentimiento y los datos del formulario.'
      USING ERRCODE='22023';
  END IF;

  SELECT o.id, b.public_page_content->>'privacyPolicyUrl' INTO v_org, v_policy_url
  FROM public.organizations o
  JOIN public.organization_settings s ON s.organization_id = o.id
  JOIN public.organization_branding b ON b.organization_id = o.id
  WHERE o.slug = p_slug
    AND char_length(COALESCE(b.public_page_content->>'privacyPolicyUrl','')) BETWEEN 9 AND 1500
    AND (b.public_page_content->>'privacyPolicyUrl') ~ '^https://[^[:space:]]+$'
    AND o.status = 'ACTIVE'
    AND s.enable_public_website IS TRUE
    AND jco_private.operational_access(o.id)
  LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El formulario no está disponible actualmente.'
      USING ERRCODE='P0001';
  END IF;

  -- Serialize the two cheap bounds by target tenant; concurrent requests
  -- cannot bypass the check-and-insert window.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('jco-public-contact:' || v_org::text, 0)
  );
  -- Count actual inquiries, not distinct contacts: reuse must never bypass
  -- the original per-tenant and per-email anti-spam limits.
  -- Historic receipts remain intact and continue to count during transition.
  IF (
    (SELECT count(*) FROM private.website_contact_consents old
     WHERE old.organization_id=v_org AND old.consented_at >= now()-interval '1 hour')
    + (SELECT count(*) FROM private.website_lead_consents fresh
       WHERE fresh.organization_id=v_org AND fresh.consented_at >= now()-interval '1 hour')
  ) >= 40 OR (
    (SELECT count(*) FROM private.website_contact_consents old
     JOIN public.contacts historic ON historic.id=old.contact_id
     WHERE old.organization_id=v_org
       AND lower(btrim(historic.email))=v_email
       AND old.consented_at >= now()-interval '24 hours')
    + (SELECT count(*) FROM private.website_lead_consents fresh
       JOIN public.contacts current_contact ON current_contact.id=fresh.contact_id
       WHERE fresh.organization_id=v_org
         AND lower(btrim(current_contact.email))=v_email
         AND fresh.consented_at >= now()-interval '24 hours')
  ) >= 4
  THEN
    RAISE EXCEPTION 'Hay demasiadas solicitudes recientes. Intenta más tarde.'
      USING ERRCODE='P0001';
  END IF;

  -- Match both the normalized email and the full name inside this agency.
  -- A shared mailbox with a different name must not merge distinct people.
  -- Existing CRM data is never overwritten by a public anonymous caller.
  SELECT c.id INTO v_contact
  FROM public.contacts c
  WHERE c.organization_id=v_org
    AND lower(btrim(coalesce(c.email,'')))=v_email
    AND lower(btrim(concat(c.first_name,' ',coalesce(c.last_name,''))))=lower(v_name)
  ORDER BY c.created_at, c.id
  LIMIT 1;

  IF v_contact IS NULL THEN
    INSERT INTO public.contacts (
      organization_id, first_name, email, phone, source, notes
    ) VALUES (
      v_org, v_name, v_email, v_phone, 'WEBSITE',
      'Contacto desde la portada pública. Servicio: ' || v_service
    ) RETURNING id INTO v_contact;
  END IF;

  INSERT INTO public.leads (
    organization_id, contact_id, status, priority, notes
  ) VALUES (
    v_org, v_contact, 'NEW', 'MEDIUM',
    'Consulta de la portada pública. Servicio: ' || v_service ||
    CASE WHEN v_message = '' THEN '' ELSE E'\nMensaje: ' || v_message END
  ) RETURNING id INTO v_lead;

  -- Every successful inquiry has its own immutable consent receipt.
  -- Preserve the legacy per-contact table and all its historical rows.
  INSERT INTO private.website_lead_consents
    (lead_id, organization_id, contact_id, policy_url)
  VALUES (v_lead, v_org, v_contact, v_policy_url);

  RETURN true;
END;
$function$;


REVOKE ALL ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)
  TO anon, authenticated;
COMMENT ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)
 IS 'Candidate: preserve consent by inquiry event and reuse matching tenant contact without exposing CRM data.';

COMMIT;
