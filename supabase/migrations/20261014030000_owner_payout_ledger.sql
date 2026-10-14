-- Independently documented outgoing owner payments. Never initiate bank transfers here.
CREATE TABLE IF NOT EXISTS public.owner_statement_payouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 statement_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount>0 AND amount<=999999999999.99),
 paid_on date NOT NULL CHECK (paid_on<=CURRENT_DATE),
 payment_method text NOT NULL CHECK (payment_method IN ('TRANSFER','CASH','CHECK','OTHER')),
 payment_reference text NOT NULL CHECK (length(trim(payment_reference)) BETWEEN 5 AND 140),
 evidence_reference text NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 5 AND 500),
 recorded_by uuid NOT NULL REFERENCES auth.users(id),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT owner_statement_payouts_statement_fk FOREIGN KEY(organization_id,statement_id)
 REFERENCES public.owner_statements(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT owner_statement_payouts_unique_reference UNIQUE(organization_id,statement_id,payment_reference)
);
CREATE INDEX IF NOT EXISTS owner_statement_payouts_statement_idx ON public.owner_statement_payouts(organization_id,statement_id);
ALTER TABLE public.owner_statement_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_statement_payouts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.owner_statement_payouts TO authenticated;
DROP POLICY IF EXISTS owner_statement_payouts_view ON public.owner_statement_payouts;
CREATE POLICY owner_statement_payouts_view ON public.owner_statement_payouts FOR SELECT TO authenticated
 USING (public.has_org_permission(organization_id,'owner_statements.view'));

CREATE OR REPLACE FUNCTION public.admin_record_owner_payout(
 p_statement_id uuid,p_organization_id uuid,p_amount numeric,p_paid_on date,
 p_payment_method text,p_payment_reference text,p_evidence_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public','auth'
AS $$
DECLARE v_statement public.owner_statements%ROWTYPE;v_paid numeric;v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.commission_is_manager(p_organization_id)
 OR NOT public.has_org_permission(p_organization_id,'owner_statements.create') THEN
   RAISE EXCEPTION 'Solo un administrador autorizado puede registrar pagos al propietario' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_statement FROM public.owner_statements
 WHERE id=p_statement_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada' USING ERRCODE='P0002'; END IF;
 IF v_statement.status <> 'GENERATED' THEN
   RAISE EXCEPTION 'Solo se pueden registrar abonos en liquidaciones emitidas y no pagadas' USING ERRCODE='23514';
 END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
 OR p_paid_on IS NULL OR p_paid_on>CURRENT_DATE
 OR p_payment_method IS NULL OR p_payment_method NOT IN ('TRANSFER','CASH','CHECK','OTHER')
 OR length(trim(coalesce(p_payment_reference,''))) NOT BETWEEN 5 AND 140
 OR length(trim(coalesce(p_evidence_reference,''))) NOT BETWEEN 5 AND 500 THEN
   RAISE EXCEPTION 'Datos o soporte del pago no válidos' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(amount),0) INTO v_paid FROM public.owner_statement_payouts
 WHERE statement_id=p_statement_id AND organization_id=p_organization_id;
 IF v_paid+p_amount>v_statement.net_amount THEN
   RAISE EXCEPTION 'El abono supera el saldo por pagar al propietario' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.owner_statement_payouts(organization_id,statement_id,amount,paid_on,
 payment_method,payment_reference,evidence_reference,recorded_by)
 VALUES(p_organization_id,p_statement_id,p_amount,p_paid_on,p_payment_method,
 trim(p_payment_reference),trim(p_evidence_reference),auth.uid()) RETURNING id INTO v_id;
 IF v_paid+p_amount=v_statement.net_amount THEN
   UPDATE public.owner_statements SET status='PAID'
   WHERE id=p_statement_id AND organization_id=p_organization_id;
 END IF;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_record_owner_payout(uuid,uuid,numeric,date,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_record_owner_payout(uuid,uuid,numeric,date,text,text,text) TO authenticated;
