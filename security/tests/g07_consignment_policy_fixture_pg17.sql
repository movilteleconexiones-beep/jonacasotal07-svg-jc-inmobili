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
