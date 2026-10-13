-- Correcciones de comisiones marcadas PAGADAS por error, sin desembolso real.
-- Original inmutable; ajuste efectivo mediante registro independiente.
CREATE TABLE IF NOT EXISTS public.commission_accounting_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 commission_id uuid NOT NULL UNIQUE REFERENCES public.commissions(id),
 review_request_id uuid NOT NULL UNIQUE REFERENCES public.commission_review_requests(id),
 original_amount numeric(18,2) NOT NULL CHECK (original_amount>=0),
 correct_basis numeric(18,2) NOT NULL CHECK (correct_basis>0),
 correct_percentage numeric(7,4) NOT NULL CHECK (correct_percentage BETWEEN 0 AND 100),
 corrected_amount numeric(18,2) NOT NULL CHECK (corrected_amount=round(correct_basis*correct_percentage/100,2)),
 difference_amount numeric(18,2) GENERATED ALWAYS AS (original_amount-corrected_amount) STORED,
 money_disbursed boolean NOT NULL DEFAULT false CHECK (money_disbursed=false),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
 confirmed_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (organization_id,commission_id) REFERENCES public.commissions(organization_id,id)
);
ALTER TABLE public.commission_accounting_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_accounting_corrections FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.commission_accounting_corrections TO authenticated;
CREATE POLICY commission_corrections_read ON public.commission_accounting_corrections
 FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'commissions.view'));
-- No UPDATE, DELETE or INSERT access for browser roles. Administrative insertion requires
-- a separately confirmed no-disbursement correction and creates an audit_log entry.
