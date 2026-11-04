-- INMOJCO #104: READ-ONLY assertion of six active finance RPC DDL bodies,
-- signatures, SECURITY DEFINER mode, ownership, search_path and EXECUTE ACL.
-- Snapshotted 2026-11-02; rechecked live 2026-11-04. MD5 is a drift
-- fingerprint, NOT a digital signature or evidence of historic chronology.
-- Only pg_catalog and builtin helpers; NEVER read finance/customer rows.
-- This DOES NOT authorize migration repair, db push, merges or deployments.
WITH expected(name,signature,identity_args,body_md5,definition_md5,
              security_definer,settings,anon_execute,auth_execute,service_execute) AS (
 VALUES
  ('create_owner_draft_statement','create_owner_draft_statement(uuid,uuid,date,numeric,numeric)','target_org uuid, target_lease uuid, target_month date, agency_commission numeric, withholding_tax numeric','610c219f26080452e9a0b4d13da27d71','6c6efdd8d41115de3b6446e90e1a905b',true,'search_path=pg_catalog, public, auth',false,true,true),
  ('create_tenant_rent_period','create_tenant_rent_period(uuid,uuid,date)','target_org uuid, target_lease uuid, target_period date','19484f5e7df50025559c5195f8fc205b','cde79b372877a8583357af0c73b5e040',true,'search_path=pg_catalog, public, auth',false,true,true),
  ('guard_owner_statement_deduction_change','guard_owner_statement_deduction_change()','','30f0f84353b1aa1d45e20aa14122cf95','aac398d4397f06d3e1b7ecb2c93b675b',true,'search_path=pg_catalog, public, auth',false,false,true),
  ('normalize_owner_deduction_audit_fields','normalize_owner_deduction_audit_fields()','','40a446e02f95857a5c013bd71fe49913','bcf8f9ecea72157b1ad6991320cb0a83',false,'search_path=pg_catalog',false,false,true),
  ('reconcile_owner_draft_statement','reconcile_owner_draft_statement(uuid,uuid)','target_org uuid, target_statement uuid','a8af9ad02e088039ecb5c381c04717c8','c3e1ce9d703bc89c940db384cfc7d405',true,'search_path=pg_catalog, public, auth',false,true,true),
  ('record_tenant_rent_receipt','record_tenant_rent_receipt(uuid,uuid,numeric,text,text,uuid)','target_org uuid, target_payment uuid, receipt_amount numeric, receipt_method text, receipt_reference text, request_key uuid','72524a27180f43869c30065706fd5251','7907aa26dc85bff0c06936d0d12c03ad',true,'search_path=pg_catalog, public, auth',false,true,true)
), current_rpc AS (
 SELECT e.*, p.oid,pg_get_userbyid(p.proowner) AS actual_owner,
   pg_get_function_identity_arguments(p.oid) AS actual_args,
   md5(p.prosrc) AS actual_body_md5,
   md5(pg_get_functiondef(p.oid)) AS actual_definition_md5,
   p.prosecdef AS actual_definer, array_to_string(p.proconfig,',') AS actual_settings,
   has_function_privilege('anon',p.oid,'EXECUTE') AS actual_anon_execute,
   has_function_privilege('authenticated',p.oid,'EXECUTE') AS actual_auth_execute,
   has_function_privilege('service_role',p.oid,'EXECUTE') AS actual_service_execute,
   (SELECT count(*) FROM pg_proc extra
     WHERE extra.pronamespace='public'::regnamespace
       AND extra.proname=e.name) AS same_name_overload_count
 FROM expected e LEFT JOIN pg_proc p
   ON p.oid=to_regprocedure('public.'||e.signature)
)
SELECT name,
  oid IS NOT NULL AS exists_with_expected_signature,
  same_name_overload_count,
  CASE WHEN oid IS NOT NULL AND same_name_overload_count=1
    AND actual_owner='postgres'
    AND actual_args=identity_args
    AND actual_body_md5=body_md5 AND actual_definition_md5=definition_md5
    AND actual_definer=security_definer AND actual_settings=settings
    AND actual_anon_execute IS NOT DISTINCT FROM anon_execute
    AND actual_auth_execute IS NOT DISTINCT FROM auth_execute
    AND actual_service_execute IS NOT DISTINCT FROM service_execute
    THEN 'BASELINE_MATCH' ELSE 'DRIFT' END AS verdict
FROM current_rpc ORDER BY name;
