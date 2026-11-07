-- Financial reconciliation corrections are append-only audit events.
-- Never delete receipts, itemized deduction events or paid/generated statements.
BEGIN;

CREATE FUNCTION public.owner_draft_source_fingerprint(target_org uuid, target_statement uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$
 SELECT pg_catalog.md5(
   COALESCE((
     SELECT pg_catalog.jsonb_agg(
       pg_catalog.jsonb_build_array(p.id,p.status,p.expected_amount,p.paid_amount) ORDER BY p.id
     )::text
     FROM public.rent_payments p
     JOIN public.owner_statements s
       ON s.organization_id=p.organization_id AND s.lease_id=p.lease_id
         AND s.period_month=p.period_month
     WHERE s.organization_id=target_org AND s.id=target_statement
   ),'[]')
   || '|' ||
   COALESCE((
     SELECT pg_catalog.jsonb_agg(
       pg_catalog.jsonb_build_array(d.id,d.status,d.category,d.responsible_party,d.amount)
       ORDER BY d.id
     )::text
     FROM public.owner_statement_deductions d
     WHERE d.organization_id=target_org AND d.statement_id=target_statement
   ),'[]')
 );
$$;
REVOKE ALL ON FUNCTION public.owner_draft_source_fingerprint(uuid,uuid)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.reconcile_owner_draft_statement_audited(target_org uuid,target_statement uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  before_row public.owner_statements%ROWTYPE;
  after_row public.owner_statements%ROWTYPE;
  result_net numeric;
  source_hash text;
BEGIN
  IF auth.uid() IS NULL OR
    NOT public.has_org_permission(target_org,'owner_statements.create') OR
    NOT public.has_org_permission(target_org,'rent_payments.view') THEN
    RAISE EXCEPTION 'Not authorized to reconcile this owner statement'
      USING ERRCODE='42501';
  END IF;
  SELECT * INTO before_row FROM public.owner_statements
   WHERE organization_id=target_org AND id=target_statement FOR UPDATE;
  IF NOT FOUND OR before_row.status<>'DRAFT' THEN
    RAISE EXCEPTION 'Only draft owner statements can be reconciled'
      USING ERRCODE='23514';
  END IF;

  -- The original authoritative procedure locks receipts and validates every
  -- charge; this wrapper does not recalculate amounts in application code.
  result_net:=public.reconcile_owner_draft_statement(target_org,target_statement);
  SELECT * INTO after_row FROM public.owner_statements
   WHERE organization_id=target_org AND id=target_statement;
  source_hash:=public.owner_draft_source_fingerprint(target_org,target_statement);

  INSERT INTO public.audit_log(
    organization_id,actor_user_id,action,entity_type,entity_id,metadata
  ) VALUES (
    target_org,auth.uid(),'owner_statement.reconciled','OWNER_STATEMENT',target_statement,
    pg_catalog.jsonb_build_object(
      'before',pg_catalog.jsonb_build_object(
        'gross_income',before_row.gross_income,
        'commission_amount',before_row.commission_amount,
        'tax_amount',before_row.tax_amount,
        'other_deductions',before_row.other_deductions,
        'net_amount',before_row.net_amount
      ),
      'after',pg_catalog.jsonb_build_object(
        'gross_income',after_row.gross_income,
        'commission_amount',after_row.commission_amount,
        'tax_amount',after_row.tax_amount,
        'other_deductions',after_row.other_deductions,
        'net_amount',after_row.net_amount
      ),
      'source_hash',source_hash
    )
  );
  RETURN result_net;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_owner_draft_statement_audited(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_owner_draft_statement_audited(uuid,uuid)
 TO authenticated;

CREATE FUNCTION public.revert_owner_draft_reconciliation(
 target_org uuid,target_statement uuid,reason text
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  statement public.owner_statements%ROWTYPE;
  latest record;
  previous jsonb;
  current jsonb;
  actual jsonb;
  source_hash text;
  old_gross numeric;
  old_commission numeric;
  old_tax numeric;
  old_other numeric;
  old_net numeric;
BEGIN
  IF auth.uid() IS NULL OR
     NOT public.has_org_permission(target_org,'owner_statements.create') OR
     NOT public.has_org_permission(target_org,'rent_payments.view') OR
     NOT EXISTS(
       SELECT 1 FROM public.organization_members m
       JOIN public.member_roles mr ON mr.organization_member_id=m.id
       JOIN public.roles r ON r.id=mr.role_id
       WHERE m.organization_id=target_org AND m.user_id=auth.uid()
         AND m.status='ACTIVE' AND r.organization_id=target_org
         AND r.key='ADMIN' AND r.active
     ) THEN
    RAISE EXCEPTION 'Only an authorized administrator can revert reconciliation'
      USING ERRCODE='42501';
  END IF;
  IF reason IS NULL OR length(btrim(reason))<8 OR length(btrim(reason))>500 THEN
    RAISE EXCEPTION 'Provide an audit reason of 8 to 500 characters'
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO statement FROM public.owner_statements
   WHERE organization_id=target_org AND id=target_statement FOR UPDATE;
  IF NOT FOUND OR statement.status<>'DRAFT' THEN
    RAISE EXCEPTION 'A generated or paid statement cannot be reverted'
      USING ERRCODE='23514';
  END IF;

  SELECT a.action,a.metadata,a.id INTO latest
  FROM public.audit_log a
  WHERE a.organization_id=target_org AND a.entity_type='OWNER_STATEMENT'
    AND a.entity_id=target_statement
    AND a.action IN ('owner_statement.reconciled','owner_statement.reverted')
  ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
  IF NOT FOUND OR latest.action<>'owner_statement.reconciled' THEN
    RAISE EXCEPTION 'No reversible audited reconciliation exists; old entries need manual review'
      USING ERRCODE='23514';
  END IF;

  -- Locks match the established reconciliation lock order.
  PERFORM 1 FROM public.rent_payments p
   WHERE p.organization_id=target_org
     AND p.lease_id=statement.lease_id AND p.period_month=statement.period_month
   FOR UPDATE;
  source_hash:=public.owner_draft_source_fingerprint(target_org,target_statement);
  IF latest.metadata->>'source_hash' IS DISTINCT FROM source_hash THEN
    RAISE EXCEPTION 'Receipts or deductions changed; reconcile current inputs instead of restoring old amounts'
      USING ERRCODE='23514';
  END IF;

  current:=latest.metadata->'after';
  previous:=latest.metadata->'before';
  actual:=pg_catalog.jsonb_build_object(
    'gross_income',statement.gross_income,
    'commission_amount',statement.commission_amount,
    'tax_amount',statement.tax_amount,
    'other_deductions',statement.other_deductions,
    'net_amount',statement.net_amount
  );
  IF current IS NULL OR previous IS NULL OR current<>actual THEN
    RAISE EXCEPTION 'Statement amounts changed since this reconciliation; reversion blocked'
      USING ERRCODE='23514';
  END IF;

  old_gross:=(previous->>'gross_income')::numeric;
  old_commission:=(previous->>'commission_amount')::numeric;
  old_tax:=(previous->>'tax_amount')::numeric;
  old_other:=(previous->>'other_deductions')::numeric;
  old_net:=(previous->>'net_amount')::numeric;
  UPDATE public.owner_statements
  SET gross_income=old_gross,commission_amount=old_commission,tax_amount=old_tax,
      other_deductions=old_other,net_amount=old_net
  WHERE id=target_statement AND organization_id=target_org AND status='DRAFT';

  INSERT INTO public.audit_log(
    organization_id,actor_user_id,action,entity_type,entity_id,metadata
  ) VALUES (
    target_org,auth.uid(),'owner_statement.reverted','OWNER_STATEMENT',target_statement,
    pg_catalog.jsonb_build_object(
      'reason',btrim(reason),'reversed_event',latest.id,
      'before_reversal',current,'restored',previous,'source_hash',source_hash
    )
  );
  RETURN old_net;
END;
$$;
REVOKE ALL ON FUNCTION public.revert_owner_draft_reconciliation(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revert_owner_draft_reconciliation(uuid,uuid,text)
 TO authenticated;

COMMENT ON FUNCTION public.reconcile_owner_draft_statement_audited(uuid,uuid)
 IS 'Audits before/after draft amounts and source fingerprint on every new reconciliation. No bank transfer.';
COMMENT ON FUNCTION public.revert_owner_draft_reconciliation(uuid,uuid,text)
 IS 'ADMIN-only atomic undo of the latest audited draft reconciliation when receipts/deductions and amounts are unchanged. Does not delete transactions.';

COMMIT;
