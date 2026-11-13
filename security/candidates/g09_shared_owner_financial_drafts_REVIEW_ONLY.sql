-- G09 / #96: multi-owner lease draft settlement with exact cent allocations.
-- Review, regression-test in isolated Supabase clone before production rollout.
-- Do not change recorded statements, paid receipts, owners or banking information.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $preflight$
BEGIN
 IF current_user<>'postgres'
    OR to_regclass('public.property_ownerships') IS NULL
    OR to_regclass('public.owner_statements') IS NULL
    OR to_regclass('public.owner_statement_payouts') IS NULL
    OR to_regprocedure('public.reconcile_owner_draft_statement(uuid,uuid)') IS NULL
    OR to_regprocedure('public.create_owner_draft_statement(uuid,uuid,date,numeric,numeric)') IS NULL
 THEN RAISE EXCEPTION 'G09 ownership/statement baseline missing or untrusted executor'; END IF;
 IF to_regprocedure('public.create_owner_shared_drafts(uuid,uuid,date,numeric,numeric)') IS NOT NULL
 OR to_regprocedure('jco_private.allocate_owner_amount(uuid,numeric)') IS NOT NULL
 THEN RAISE EXCEPTION 'G09 share settlement already installed: examine schema provenance'; END IF;
END $preflight$;

-- Allocate whole cents using largest remainder, UUID tiebreaker. For valid
-- exact 100% shares the total is always identical to the original amount.
CREATE FUNCTION jco_private.allocate_owner_amount(p_property uuid,p_amount numeric)
RETURNS TABLE(owner_id uuid, allocated numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $alloc$
 WITH fractions AS (
   SELECT po.owner_id,
     pg_catalog.floor(p_amount * 100 * po.ownership_percentage / 100)::bigint AS base_cents,
     (p_amount * 100 * po.ownership_percentage / 100) -
       pg_catalog.floor(p_amount * 100 * po.ownership_percentage / 100) AS residue
   FROM public.property_ownerships po WHERE po.property_id=p_property
 ), ranked AS (
   SELECT f.owner_id,f.base_cents,
     pg_catalog.row_number() OVER (ORDER BY f.residue DESC,f.owner_id) AS allocation_order,
     pg_catalog.sum(f.base_cents) OVER () AS base_total
   FROM fractions f
 )
 SELECT r.owner_id,
   (r.base_cents+
     CASE WHEN r.allocation_order<=(p_amount*100)::bigint-r.base_total
       THEN 1 ELSE 0 END)::numeric / 100 AS allocated
 FROM ranked r;
$alloc$;
REVOKE ALL ON FUNCTION jco_private.allocate_owner_amount(uuid,numeric)
 FROM PUBLIC,anon,authenticated;

-- Defense in depth: the old one-owner draft RPC remains unchanged, but its
-- attempt to allocate 100% to a primary owner of shared property is rejected.
CREATE FUNCTION jco_private.enforce_shared_owner_statement_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE
 v_property uuid; v_owner_count integer; v_share_sum numeric;
 v_share numeric; v_total numeric; v_existing numeric; v_share_ceiling numeric;
BEGIN
 SELECT l.property_id INTO v_property FROM public.leases l
 WHERE l.id=NEW.lease_id AND l.organization_id=NEW.organization_id FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Lease tenant missing for owner statement' USING ERRCODE='23514';
 END IF;
 SELECT count(*),coalesce(sum(ownership_percentage),0) INTO v_owner_count,v_share_sum
 FROM public.property_ownerships WHERE property_id=v_property;
 IF v_owner_count<=1 THEN RETURN NEW; END IF;
 IF v_share_sum<>100 THEN
   RAISE EXCEPTION 'La participación de copropietarios debe sumar 100 %%' USING ERRCODE='23514';
 END IF;
 SELECT ownership_percentage INTO v_share
 FROM public.property_ownerships
 WHERE property_id=v_property AND owner_id=NEW.owner_id;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'El propietario no participa en este inmueble' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(paid_amount),0) INTO v_total
 FROM public.rent_payments WHERE organization_id=NEW.organization_id
   AND lease_id=NEW.lease_id AND period_month=NEW.period_month AND status<>'CANCELLED';
 -- Ceil one fractional cent accounts for deterministic largest remainder.
 v_share_ceiling:=pg_catalog.ceil(v_total*v_share)/100;
 IF NEW.gross_income>v_share_ceiling THEN
   RAISE EXCEPTION 'El ingreso de este copropietario supera su participación'
     USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(gross_income),0) INTO v_existing
 FROM public.owner_statements
 WHERE organization_id=NEW.organization_id AND lease_id=NEW.lease_id
   AND period_month=NEW.period_month AND id IS DISTINCT FROM NEW.id;
 IF NEW.gross_income+v_existing>v_total THEN
   RAISE EXCEPTION 'Las liquidaciones superan el canon efectivamente cobrado'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION jco_private.enforce_shared_owner_statement_cap()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER owner_statements_shared_cap
 BEFORE INSERT OR UPDATE OF owner_id,lease_id,period_month,gross_income
 ON public.owner_statements
 FOR EACH ROW EXECUTE FUNCTION jco_private.enforce_shared_owner_statement_cap();

-- Authorized manager/owner gets exactly one isolated draft per rightful owner.
CREATE FUNCTION public.create_owner_shared_drafts(
  target_org uuid,target_lease uuid,target_month date,
  agency_commission numeric,withholding_tax numeric
) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog'
AS $shared$
DECLARE
 v_lease public.leases%ROWTYPE;
 v_income numeric;v_owners integer;v_sum numeric;v_primary integer;
 v_primary_id uuid;v_rec record;v_id uuid;
BEGIN
 IF auth.uid() IS NULL
 OR NOT public.commission_is_manager(target_org)
 OR NOT public.has_org_permission(target_org,'owner_statements.create')
 OR NOT public.has_org_permission(target_org,'rent_payments.view') THEN
   RAISE EXCEPTION 'No tienes permiso para liquidar copropietarios' USING ERRCODE='42501';
 END IF;
 IF target_month IS NULL OR NOT pg_catalog.isfinite(target_month)
 OR extract(day FROM target_month)<>1
 OR agency_commission IS NULL OR withholding_tax IS NULL
 OR agency_commission<0 OR withholding_tax<0
 OR agency_commission<>pg_catalog.round(agency_commission,2)
 OR withholding_tax<>pg_catalog.round(withholding_tax,2)
 THEN RAISE EXCEPTION 'Fecha o deducciones inválidas' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_lease FROM public.leases WHERE id=target_lease
 AND organization_id=target_org FOR UPDATE;
 IF NOT FOUND OR v_lease.owner_id IS NULL
 OR v_lease.status NOT IN('ACTIVE','RENEWAL','FINISHED') THEN
   RAISE EXCEPTION 'Contrato no apto para liquidar copropietarios' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public.property_ownerships
 WHERE property_id=v_lease.property_id ORDER BY owner_id FOR SHARE;
 SELECT count(*),coalesce(sum(p.ownership_percentage),0),
   count(*) FILTER(WHERE p.is_primary),(array_agg(p.owner_id) FILTER(WHERE p.is_primary))[1]
 INTO v_owners,v_sum,v_primary,v_primary_id
 FROM public.property_ownerships p JOIN public.property_owners owner
 ON owner.id=p.owner_id AND owner.organization_id=target_org
 WHERE p.property_id=v_lease.property_id;
 IF v_owners<2 OR v_sum<>100 OR v_primary<>1 OR v_primary_id IS DISTINCT FROM v_lease.owner_id
 OR v_owners<>(SELECT count(*) FROM public.property_ownerships WHERE property_id=v_lease.property_id)
 THEN RAISE EXCEPTION 'Copropietarios incompletos, participación distinta de 100 %% o titular principal inconsistente'
 USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.owner_statements s WHERE s.organization_id=target_org
 AND s.lease_id=target_lease AND s.period_month=target_month) THEN
   RAISE EXCEPTION 'Ya existen liquidaciones para este contrato y mes'
     USING ERRCODE='23505';
 END IF;
 SELECT coalesce(sum(paid_amount),0) INTO v_income
 FROM public.rent_payments WHERE organization_id=target_org AND lease_id=target_lease
 AND period_month=target_month AND status<>'CANCELLED';
 IF v_income<=0 OR agency_commission+withholding_tax>v_income THEN
   RAISE EXCEPTION 'Ingreso no cobrado o deducciones superiores al canon'
     USING ERRCODE='23514';
 END IF;
 FOR v_rec IN
  SELECT g.owner_id,g.allocated AS gross_income,
    c.allocated AS commission_amount,t.allocated AS tax_amount,
    po.ownership_percentage AS share_percent
  FROM jco_private.allocate_owner_amount(v_lease.property_id,v_income) g
  JOIN jco_private.allocate_owner_amount(v_lease.property_id,agency_commission) c
    ON c.owner_id=g.owner_id
  JOIN jco_private.allocate_owner_amount(v_lease.property_id,withholding_tax) t
    ON t.owner_id=g.owner_id
  JOIN public.property_ownerships po ON po.property_id=v_lease.property_id
    AND po.owner_id=g.owner_id
  ORDER BY g.owner_id
 LOOP
  IF v_rec.commission_amount+v_rec.tax_amount>v_rec.gross_income THEN
    RAISE EXCEPTION 'Redondeo produce deducciones mayores que la participación'
      USING ERRCODE='23514';
  END IF;
  INSERT INTO public.owner_statements(
    organization_id,lease_id,owner_id,period_month,gross_income,
    commission_amount,tax_amount,other_deductions,net_amount,status)
  VALUES(target_org,target_lease,v_rec.owner_id,target_month,v_rec.gross_income,
    v_rec.commission_amount,v_rec.tax_amount,0,
    v_rec.gross_income-v_rec.commission_amount-v_rec.tax_amount,'DRAFT')
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(target_org,auth.uid(),'owner_statement.shared_draft_created','OWNER_STATEMENT',v_id,
    pg_catalog.jsonb_build_object('owner_share',v_rec.share_percent,'lease_id',target_lease,
    'period_month',target_month,'gross',v_rec.gross_income,'commission',v_rec.commission_amount,
    'withholding',v_rec.tax_amount));
  RETURN NEXT v_id;
 END LOOP;
 RETURN;
END;
$shared$;
REVOKE ALL ON FUNCTION public.create_owner_shared_drafts(uuid,uuid,date,numeric,numeric)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_shared_drafts(uuid,uuid,date,numeric,numeric)
 TO authenticated;

-- A multi-owner reconciliation must preserve the allocated gross amount,
-- never reset an individual statement to the entire month's collected rent.
CREATE OR REPLACE FUNCTION public.reconcile_owner_draft_statement(
 target_org uuid,target_statement uuid
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public','auth'
AS $reconcile$
DECLARE
 statement public.owner_statements%ROWTYPE;
 approved_other numeric;detail_commission numeric;detail_tax numeric;
 commission_rows integer;tax_rows integer;pending_rows integer;
 collected numeric;net_total numeric;v_property_id uuid;ownership_count integer;
 share_sum numeric;split_gross numeric;
BEGIN
 IF auth.uid() IS NULL OR
    NOT public.has_org_permission(target_org,'owner_statements.create') OR
    NOT public.has_org_permission(target_org,'rent_payments.view') THEN
   RAISE EXCEPTION 'No tienes permiso para conciliar esta liquidación' USING ERRCODE='42501';
 END IF;
 SELECT * INTO statement FROM public.owner_statements
 WHERE organization_id=target_org AND id=target_statement FOR UPDATE;
 IF NOT FOUND OR statement.status<>'DRAFT' THEN
   RAISE EXCEPTION 'Solo se pueden conciliar liquidaciones en borrador' USING ERRCODE='23514';
 END IF;
 SELECT
   coalesce(sum(amount) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER'
      AND category NOT IN('TAX','COMMISSION')),0),
   coalesce(sum(amount) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER'
      AND category='COMMISSION'),0),
   coalesce(sum(amount) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER'
      AND category='TAX'),0),
   count(*) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER' AND category='COMMISSION'),
   count(*) FILTER(WHERE status='APPROVED' AND responsible_party='OWNER' AND category='TAX'),
   count(*) FILTER(WHERE status='DRAFT')
 INTO approved_other,detail_commission,detail_tax,commission_rows,tax_rows,pending_rows
 FROM public.owner_statement_deductions
 WHERE organization_id=target_org AND statement_id=target_statement;
 IF pending_rows>0 THEN RAISE EXCEPTION 'Existen deducciones pendientes de revisión'
 USING ERRCODE='23514'; END IF;
 IF (commission_rows>0 AND detail_commission<>statement.commission_amount) OR
    (tax_rows>0 AND detail_tax<>statement.tax_amount) THEN
    RAISE EXCEPTION 'El desglose no coincide con comisiones e impuestos'
      USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public.rent_payments WHERE organization_id=target_org
   AND lease_id=statement.lease_id AND period_month=statement.period_month FOR UPDATE;
 SELECT coalesce(sum(paid_amount),0) INTO collected FROM public.rent_payments
 WHERE organization_id=target_org AND lease_id=statement.lease_id AND
 period_month=statement.period_month AND status<>'CANCELLED';
 SELECT l.property_id INTO v_property_id FROM public.leases l
 WHERE l.id=statement.lease_id AND l.organization_id=target_org;
 SELECT count(*),coalesce(sum(ownership_percentage),0)
 INTO ownership_count,share_sum FROM public.property_ownerships
 WHERE public.property_ownerships.property_id=v_property_id;
 IF ownership_count>1 THEN
  IF share_sum<>100 THEN RAISE EXCEPTION 'Participaciones no suman 100 %%' USING ERRCODE='23514'; END IF;
  SELECT allocated INTO split_gross FROM jco_private.allocate_owner_amount(v_property_id,collected)
  WHERE owner_id=statement.owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El propietario no pertenece al inmueble' USING ERRCODE='23514'; END IF;
  collected:=split_gross;
 END IF;
 net_total:=collected-statement.commission_amount-statement.tax_amount-approved_other;
 IF net_total<0 THEN RAISE EXCEPTION 'Deducciones superiores al canon' USING ERRCODE='23514'; END IF;
 UPDATE public.owner_statements
 SET gross_income=collected,other_deductions=approved_other,net_amount=net_total
 WHERE id=target_statement AND organization_id=target_org AND status='DRAFT';
 RETURN net_total;
END;
$reconcile$;

DO $verify$
BEGIN
 IF has_function_privilege('anon','public.create_owner_shared_drafts(uuid,uuid,date,numeric,numeric)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.create_owner_shared_drafts(uuid,uuid,date,numeric,numeric)','EXECUTE')
 OR to_regprocedure('jco_private.enforce_shared_owner_statement_cap()') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.owner_statements'::regclass
   AND tgname='owner_statements_shared_cap' AND tgenabled='O')
 THEN RAISE EXCEPTION 'G09 security gate or split trigger incomplete'; END IF;
END $verify$;
COMMIT;
