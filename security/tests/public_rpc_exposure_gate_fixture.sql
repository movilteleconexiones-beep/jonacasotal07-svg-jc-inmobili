-- Disposable PostgreSQL 17 test only: no client, property or financial data.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE FUNCTION public.get_public_property_intake_site(p_slug text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.submit_property_consignment(
  p_site_slug text,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.submit_public_website_lead(
  p_slug text,p_name text,p_email text,p_phone text,p_service text,
  p_message text,p_consent boolean,p_trap text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT true $$;
CREATE FUNCTION public.tenant_public_catalog(tenant_slug text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.admin_cancel_lease_draft(target_org uuid,target_lease uuid,reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT $$;

REVOKE ALL ON FUNCTION public.get_public_property_intake_site(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_property_consignment(text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_public_catalog(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_lease_draft(uuid,uuid,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_property_intake_site(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_property_consignment(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_website_lead(text,text,text,text,text,text,boolean,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_public_catalog(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_lease_draft(uuid,uuid,text) TO authenticated;
