\set ON_ERROR_STOP on
-- Synthetic isolated PG17 fixtures: no Supabase connections or real PII.
CREATE TABLE public.organization_branding(
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  public_page_content jsonb NOT NULL DEFAULT '{}'::jsonb
);
-- The production organizations table has a unique public slug; the legacy
-- consignment test baseline intentionally models only id/name/status.
ALTER TABLE public.organizations ADD COLUMN slug text;
UPDATE public.organizations SET slug=CASE id
  WHEN '11111111-1111-1111-1111-111111111111'::uuid THEN 'agency-a'
  WHEN '22222222-2222-2222-2222-222222222222'::uuid THEN 'agency-b'
  ELSE 'disabled-agency' END;
ALTER TABLE public.organizations ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_slug_unique UNIQUE(slug);

INSERT INTO public.organization_branding(organization_id,public_page_content)
VALUES
('11111111-1111-1111-1111-111111111111','{"privacyPolicyUrl":"https://www.inmojco.com"}'),
('22222222-2222-2222-2222-222222222222','{"privacyPolicyUrl":"https://www.inmojco.com"}');

INSERT INTO private.property_intake_sites(slug,organization_id,enabled)
VALUES
 ('tenant-a','11111111-1111-1111-1111-111111111111',true),
 ('tenant-b','22222222-2222-2222-2222-222222222222',true);

-- Make tenant B operational in the isolated test so missing approval, not
-- trial/licensing state, is responsible for its fail-closed result.
UPDATE public.consignment_test_operational_access
   SET allowed=true
 WHERE organization_id='22222222-2222-2222-2222-222222222222';

-- Mirror the deployed photo resolver signature and grants. This PG17 fixture
-- does not open Storage or accept any real photos.
CREATE OR REPLACE FUNCTION public.resolve_consignment_photo_submission(
  p_slug text,p_request_id uuid,p_reference text
) RETURNS TABLE(
  consignment_id uuid,organization_id uuid,created_at timestamptz,status text
) LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $photo$
 SELECT c.id,c.organization_id,c.created_at,c.status
 FROM private.property_intake_sites s
 JOIN public.property_consignments c ON c.organization_id=s.organization_id
 WHERE s.slug=p_slug AND s.enabled AND c.request_id=p_request_id
   AND c.reference=p_reference AND c.status='NEW'
   AND c.created_at>now()-interval '1 hour'
   AND EXISTS(SELECT 1 FROM public.organizations o
              WHERE o.id=s.organization_id AND o.status='ACTIVE')
 LIMIT 1;
$photo$;
REVOKE ALL ON FUNCTION public.resolve_consignment_photo_submission(text,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_consignment_photo_submission(text,uuid,text)
  TO service_role;
