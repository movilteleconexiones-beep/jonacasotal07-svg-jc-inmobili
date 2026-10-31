-- #258: additive capacity gate and narrowly-scoped upgrades of privileged billing RPCs.
-- DO NOT deploy without PostgreSQL 17 integration tests including webhook idempotency.
CREATE OR REPLACE FUNCTION jco_private.plan_capacity_fits(p_org uuid,p_plan uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE v_max_users integer; v_max_properties integer;
        v_used_users bigint; v_used_properties bigint;
BEGIN
  SELECT max_users,max_properties INTO v_max_users,v_max_properties
    FROM public.plans WHERE id=p_plan AND active;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT count(*) INTO v_used_users FROM public.organization_members m
    WHERE m.organization_id=p_org AND m.status='ACTIVE'
      AND NOT jco_private.is_external_only_member(m.id);
  SELECT count(*) INTO v_used_properties FROM public.properties WHERE organization_id=p_org;
  RETURN (v_max_users IS NULL OR v_used_users<=v_max_users)
     AND (v_max_properties IS NULL OR v_used_properties<=v_max_properties);
END
$body$;
REVOKE ALL ON FUNCTION jco_private.plan_capacity_fits(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION jco_private.plan_capacity_fits(uuid,uuid) TO service_role;

DO $patch$
DECLARE v_def text; v_old text; v_new text; v_name text;
BEGIN
  -- This migration explicitly fails on schema drift instead of altering the wrong code.
  v_name:='public.billing_admin_action(uuid,text,text,uuid)';
  v_def:=pg_get_functiondef(v_name::regprocedure);
  v_old:='    SELECT array_agg(substr(feature_key,12)) INTO keys FROM public.plan_features';
  v_new:='    IF NOT jco_private.plan_capacity_fits(target_org,target_plan) THEN RAISE EXCEPTION ''Plan capacity exceeded'' USING ERRCODE=''23514''; END IF;'||chr(10)||v_old;
  IF strpos(v_def,v_old)=0 OR strpos(v_def,'plan_capacity_fits')>0 THEN RAISE EXCEPTION 'Unexpected % definition',v_name; END IF;
  EXECUTE replace(v_def,v_old,v_new);

  v_name:='public.platform_set_subscription(uuid,text,text,text)';
  v_def:=pg_get_functiondef(v_name::regprocedure);
  v_old:='  select id into target_plan_id from public.plans';
  v_new:='  PERFORM 1 FROM public.organizations WHERE id=target_org FOR UPDATE;'||chr(10)||
         '  IF NOT FOUND THEN RAISE EXCEPTION ''Organization not found''; END IF;'||chr(10)||v_old;
  IF strpos(v_def,v_old)=0 OR strpos(v_def,'plan_capacity_fits')>0 THEN RAISE EXCEPTION 'Unexpected % definition',v_name; END IF;
  v_def:=replace(v_def,v_old,v_new);
  v_old:='  select id into active_terms_id'; 
  v_new:='  IF NOT jco_private.plan_capacity_fits(target_org,target_plan_id) THEN RAISE EXCEPTION ''Plan capacity exceeded'' USING ERRCODE=''23514''; END IF;'||chr(10)||chr(10)||v_old;
  IF strpos(v_def,v_old)=0 THEN RAISE EXCEPTION 'Unexpected % definition',v_name; END IF;
  EXECUTE replace(v_def,v_old,v_new);

  v_name:='public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)';
  v_def:=pg_get_functiondef(v_name::regprocedure);
  v_old:='      ELSE NULL END;';
  v_new:='      WHEN NOT jco_private.plan_capacity_fits(org.id,payment.plan_id) THEN ''plan_capacity_review'''||chr(10)||v_old;
  IF strpos(v_def,v_old)=0 OR strpos(v_def,'plan_capacity_fits')>0 THEN RAISE EXCEPTION 'Unexpected % definition',v_name; END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$patch$;
-- Validation: compare FUNCTION EXECUTE privileges and run isolated full webhook tests.
