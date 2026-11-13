\set ON_ERROR_STOP on
-- Isolated PostgreSQL 17 test of correction RPC exposure (not the production implementations).
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA IF NOT EXISTS jco_private;
CREATE FUNCTION public.admin_cancel_lease_draft(target_org uuid,target_lease uuid,reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN NULL; END $$;
CREATE FUNCTION public.admin_correct_lease_draft(target_org uuid,target_lease uuid,target_property uuid,target_tenant uuid,target_owner uuid,target_monthly_rent numeric,target_start date,target_end date,target_contract_number text,reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN NULL; END $$;
CREATE FUNCTION public.admin_rectify_active_lease(target_org uuid,target_lease uuid,corrected_rent numeric,corrected_end_date date,corrected_contract_number text,supporting_signed_document uuid,correction_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN NULL; END $$;
REVOKE ALL ON FUNCTION public.admin_cancel_lease_draft(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_correct_lease_draft(uuid,uuid,uuid,uuid,uuid,numeric,date,date,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_rectify_active_lease(uuid,uuid,numeric,date,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_lease_draft(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_correct_lease_draft(uuid,uuid,uuid,uuid,uuid,numeric,date,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rectify_active_lease(uuid,uuid,numeric,date,text,uuid,text) TO authenticated;
DO $tests$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('admin_cancel_lease_draft','admin_correct_lease_draft','admin_rectify_active_lease') LOOP
   IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=r.oid) THEN RAISE EXCEPTION '% must be security definer',r.proname; END IF;
   IF has_function_privilege('anon',r.oid,'EXECUTE') THEN RAISE EXCEPTION '% exposed to anon',r.proname; END IF;
   IF NOT has_function_privilege('authenticated',r.oid,'EXECUTE') THEN RAISE EXCEPTION '% unavailable to authenticated',r.proname; END IF;
 END LOOP;
END $tests$;
SELECT 'lease correction RPC ACL shape passed';
