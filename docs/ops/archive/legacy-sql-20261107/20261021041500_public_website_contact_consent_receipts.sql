-- Consent receipts are never directly accessible through the public API.
-- Store the agency's published policy URL at the time each visitor opted in.
-- No existing contacts, leads, authorizations, or payment orders are modified.
BEGIN;

CREATE TABLE private.website_contact_consents (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_url text NOT NULL CHECK (char_length(policy_url) BETWEEN 9 AND 1500 AND policy_url ~ '^https://[^[:space:]]+$'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  consent_method text NOT NULL DEFAULT 'PUBLIC_FORM_CHECKBOX'
    CHECK (consent_method = 'PUBLIC_FORM_CHECKBOX')
);
ALTER TABLE private.website_contact_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.website_contact_consents FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private.website_contact_consents IS 'Private website inquiry consent receipts, linked to contact lifecycle; captured policy URL and server timestamp. No direct API access.';

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
  IF (SELECT count(*) FROM public.contacts c
      WHERE c.organization_id = v_org AND c.source='WEBSITE'
        AND c.created_at >= now() - interval '1 hour') >= 40 OR
     (SELECT count(*) FROM public.contacts c
      WHERE c.organization_id = v_org AND c.source='WEBSITE'
        AND lower(c.email) = v_email
        AND c.created_at >= now() - interval '24 hours') >= 4
  THEN
    RAISE EXCEPTION 'Hay demasiadas solicitudes recientes. Intenta más tarde.'
      USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.contacts (
    organization_id, first_name, email, phone, source, notes
  ) VALUES (
    v_org, v_name, v_email, v_phone, 'WEBSITE',
    'Contacto desde la portada pública. Servicio: ' || v_service
  ) RETURNING id INTO v_contact;

  -- Store the precise agency policy accepted, independently of editable CRM notes.
  -- If lead creation fails, the contact and consent record roll back together.
  INSERT INTO private.website_contact_consents (contact_id, organization_id, policy_url)
  VALUES (v_contact, v_org, v_policy_url);

  INSERT INTO public.leads (
    organization_id, contact_id, status, priority, notes
  ) VALUES (
    v_org, v_contact, 'NEW', 'MEDIUM',
    'Consulta de la portada pública. Servicio: ' || v_service ||
    CASE WHEN v_message = '' THEN '' ELSE E'\nMensaje: ' || v_message END
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text) TO anon, authenticated;
COMMENT ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)
 IS 'Rate-limited, consented public CRM intake restricted to an active published operational agency. Returns no private data.';

COMMIT;
