-- Tenant-owned PUBLIC brand assets only. Inventory photos remain private.
-- Domain registration is pending-only: NEVER grants routing, TLS or auth rights.
BEGIN;
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('jco-agency-logos','jco-agency-logos',true,2097152,
        ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET
 public=true,file_size_limit=2097152,
 allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp'];

DROP POLICY IF EXISTS jco_agency_logos_upload ON storage.objects;
CREATE POLICY jco_agency_logos_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='jco-agency-logos'
 AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\\.(png|jpg|webp)$'
 AND EXISTS (
  SELECT 1 FROM public.organizations o WHERE o.id::text=split_part(name,'/',1)
  AND o.status='ACTIVE'
  AND jco_private.is_internal_staff(o.id)
  AND public.has_org_permission(o.id,'settings.edit')
 )
);
DROP POLICY IF EXISTS jco_agency_logos_delete ON storage.objects;
CREATE POLICY jco_agency_logos_delete ON storage.objects FOR DELETE TO authenticated
USING (
 bucket_id='jco-agency-logos'
 AND EXISTS (
  SELECT 1 FROM public.organizations o WHERE o.id::text=split_part(name,'/',1)
  AND jco_private.is_internal_staff(o.id)
  AND public.has_org_permission(o.id,'settings.edit')
 )
);

-- A URL in organization_branding.website is only an outbound commercial link.
-- This separate table holds HOSTNAME requests, not active routing.
CREATE TABLE IF NOT EXISTS public.agency_custom_domains (
 hostname text PRIMARY KEY,
 organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
 challenge_token uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'PENDING_DNS'
   CHECK(status IN ('PENDING_DNS','DNS_VERIFIED','TLS_READY','ACTIVE','REJECTED')),
 requested_by uuid NOT NULL REFERENCES auth.users(id),
 requested_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz,
 activated_at timestamptz,
 CHECK (hostname=lower(hostname) AND length(hostname) BETWEEN 4 AND 253),
 CHECK (status <> 'ACTIVE' OR (verified_at IS NOT NULL AND activated_at IS NOT NULL))
);
ALTER TABLE public.agency_custom_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_custom_domains FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.agency_custom_domains TO authenticated;
GRANT ALL ON public.agency_custom_domains TO service_role;
DROP POLICY IF EXISTS agency_domain_staff_read ON public.agency_custom_domains;
CREATE POLICY agency_domain_staff_read ON public.agency_custom_domains
 FOR SELECT TO authenticated USING (
   jco_private.is_internal_staff(organization_id)
   AND public.has_org_permission(organization_id,'settings.view')
 );

CREATE OR REPLACE FUNCTION public.request_agency_custom_domain(
 p_organization_id uuid,p_hostname text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $jco$
DECLARE host text; rec public.agency_custom_domains%ROWTYPE;
BEGIN
 host:=lower(btrim(coalesce(p_hostname,'')));
 IF p_organization_id IS NULL
  OR (SELECT auth.uid()) IS NULL
  OR NOT jco_private.is_internal_staff(p_organization_id)
  OR NOT public.has_org_permission(p_organization_id,'settings.edit')
  OR NOT EXISTS (SELECT 1 FROM public.organizations
                 WHERE id=p_organization_id AND status='ACTIVE')
 THEN RAISE EXCEPTION 'Not authorized to register an agency hostname'
      USING ERRCODE='42501'; END IF;
 IF length(host) NOT BETWEEN 4 AND 253
    OR host !~ '^[a-z0-9][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)+$'
    OR host ~ '(^|\\.)(localhost|local|internal|test|invalid)$'
    OR host ~ '(^|\\.)(inmojco\\.com|railway\\.app|supabase\\.co)$'
    OR host ~ '[0-9]\\.[0-9]\\.[0-9]\\.[0-9]$'
    OR EXISTS (SELECT 1 FROM unnest(string_to_array(host,'.')) label
               WHERE char_length(label)>63 OR right(label,1)='-')
 THEN RAISE EXCEPTION 'Invalid or reserved hostname' USING ERRCODE='22023'; END IF;
 -- Can only edit a pending request. Activation requires DNS ownership proof
 -- and verified TLS/domain mapping by the SaaS platform administrator.
 IF EXISTS (SELECT 1 FROM public.agency_custom_domains
            WHERE organization_id=p_organization_id
              AND status NOT IN ('PENDING_DNS','REJECTED'))
 THEN RAISE EXCEPTION 'Domain already under verification or active'
      USING ERRCODE='23514'; END IF;
 INSERT INTO public.agency_custom_domains(
  organization_id,hostname,requested_by,status,challenge_token,
  requested_at,verified_at,activated_at
 ) VALUES(p_organization_id,host,(SELECT auth.uid()),'PENDING_DNS',gen_random_uuid(),now(),NULL,NULL)
 ON CONFLICT (organization_id) DO UPDATE SET
  hostname=excluded.hostname,status='PENDING_DNS',
  requested_by=excluded.requested_by,
  challenge_token=excluded.challenge_token,requested_at=now(),
  verified_at=NULL,activated_at=NULL
 RETURNING * INTO rec;
 RETURN jsonb_build_object(
  'hostname',rec.hostname,'status',rec.status,
  'dns_record','_inmojco-verification.'||rec.hostname,
  'dns_value','inmojco-domain-verification='||rec.challenge_token::text);
END $jco$;
REVOKE ALL ON FUNCTION public.request_agency_custom_domain(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_agency_custom_domain(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_agency_custom_domain(p_organization_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $jco$
 SELECT jsonb_build_object('hostname',d.hostname,'status',d.status,
    'dns_record','_inmojco-verification.'||d.hostname,
    'dns_value','inmojco-domain-verification='||d.challenge_token::text)
 FROM public.agency_custom_domains d
 WHERE d.organization_id=p_organization_id
  AND jco_private.is_internal_staff(p_organization_id)
  AND public.has_org_permission(p_organization_id,'settings.view');
$jco$;
REVOKE ALL ON FUNCTION public.get_my_agency_custom_domain(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_agency_custom_domain(uuid) TO authenticated;
COMMIT;
