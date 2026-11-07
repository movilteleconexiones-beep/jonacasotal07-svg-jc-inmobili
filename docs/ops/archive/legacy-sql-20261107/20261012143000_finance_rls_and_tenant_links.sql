-- Staging only. Restrict financial table writes and make every lease relation
-- tenant-composite even when valid UUIDs belong to different organizations.
BEGIN;

-- Supabase may default to ALL table privileges. TRUNCATE bypasses RLS,
-- so removing INSERT/UPDATE/DELETE alone does not protect financial ledgers.
REVOKE ALL ON public.leases,public.rent_payments,public.owner_statements
  FROM PUBLIC,anon;
REVOKE TRUNCATE,REFERENCES,TRIGGER
  ON public.leases,public.rent_payments,public.owner_statements,
     public.owner_statement_deductions,public.rent_receipts
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.leases TO authenticated;

-- Abort before acquiring schema locks if historic cross-organization records exist.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.properties p ON p.id=l.property_id
    WHERE p.organization_id<>l.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.contacts c ON c.id=l.tenant_id
    WHERE c.organization_id<>l.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.property_owners o ON o.id=l.owner_id
    WHERE o.organization_id<>l.organization_id
  ) THEN
    RAISE EXCEPTION 'Existing cross-organization lease relations require manual review'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.owner_statements s
    JOIN public.property_owners o ON o.id=s.owner_id
    WHERE o.organization_id<>s.organization_id
  ) THEN
    RAISE EXCEPTION 'Existing cross-organization settlement owner relations require manual review'
      USING ERRCODE='23514';
  END IF;
END
$preflight$;

-- These constraints are needed for a tenant-bound composite FK; existing
-- single-column IDs already have unique primary keys.
ALTER TABLE public.properties
  ADD CONSTRAINT financial_properties_tenant_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.contacts
  ADD CONSTRAINT financial_contacts_tenant_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.property_owners
  ADD CONSTRAINT financial_property_owners_tenant_id_unique UNIQUE (organization_id,id);

-- A settlement must not reference an owner from a different organization.
-- Replace the legacy single-column FK to preserve unambiguous PostgREST joins.
ALTER TABLE public.owner_statements DROP CONSTRAINT owner_statements_owner_id_fkey;
ALTER TABLE public.owner_statements
  ADD CONSTRAINT owner_statement_owner_same_tenant_fk
    FOREIGN KEY (organization_id,owner_id)
    REFERENCES public.property_owners(organization_id,id) ON DELETE RESTRICT;

-- Replace (do not duplicate) old single-column FKs to avoid ambiguous
-- PostgREST joins against the same destination table.
ALTER TABLE public.leases DROP CONSTRAINT leases_property_id_fkey;
ALTER TABLE public.leases DROP CONSTRAINT leases_tenant_id_fkey;
ALTER TABLE public.leases DROP CONSTRAINT leases_owner_id_fkey;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_property_same_tenant_fk
    FOREIGN KEY (organization_id,property_id)
    REFERENCES public.properties(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT leases_tenant_same_tenant_fk
    FOREIGN KEY (organization_id,tenant_id)
    REFERENCES public.contacts(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT leases_owner_same_tenant_fk
    FOREIGN KEY (organization_id,owner_id)
    REFERENCES public.property_owners(organization_id,id) ON DELETE RESTRICT;

-- Existing tenant membership policies for leases are permissive. Add
-- RESTRICTIVE policies so broad legacy ALL policies cannot bypass granular
-- authorization. Revisit inherited commercial entitlements separately.
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY leases_financial_view ON public.leases AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'leases.view'));
CREATE POLICY leases_financial_insert ON public.leases AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_permission(organization_id,'leases.create'));
CREATE POLICY leases_financial_update ON public.leases AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_org_permission(organization_id,'leases.edit'))
  WITH CHECK (public.has_org_permission(organization_id,'leases.edit'));
REVOKE DELETE ON public.leases FROM PUBLIC,anon,authenticated;

-- A user must never forge an owner's net or mark a payment made directly.
-- create_owner_draft_statement and reconcile_owner_draft_statement are
-- server-only privileged functions that validate organization permissions.
REVOKE INSERT, UPDATE, DELETE ON public.owner_statements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.owner_statements TO authenticated;
ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_statement_financial_view
  ON public.owner_statements AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'owner_statements.view'));

-- The receipt migration already revoked direct rent_payments mutations,
-- but its legacy SELECT rules also need a granular read permission.
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY rent_payments_financial_view
  ON public.rent_payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'rent_payments.view'));

-- Reject non-finite amounts, fractions below one cent and invalid dates even
-- when a caller skips the browser's form validation. The upper bound also
-- rejects PostgreSQL numeric NaN/Infinity, which positive-only checks allow.
ALTER TABLE public.leases
  ADD CONSTRAINT leases_financial_amount_valid CHECK (
    monthly_rent BETWEEN 0 AND 999999999999.99 AND monthly_rent=round(monthly_rent,2)
    AND (status NOT IN ('ACTIVE','RENEWAL') OR (monthly_rent>0 AND tenant_id IS NOT NULL))),
  ADD CONSTRAINT leases_financial_dates_valid CHECK (
    isfinite(start_date) AND (end_date IS NULL OR (isfinite(end_date) AND end_date>=start_date)));
ALTER TABLE public.rent_payments
  ADD CONSTRAINT rent_payment_financial_amounts_valid CHECK (
    expected_amount>0 AND expected_amount<=999999999999.99
    AND expected_amount=round(expected_amount,2)
    AND paid_amount BETWEEN 0 AND expected_amount AND paid_amount=round(paid_amount,2)),
  ADD CONSTRAINT rent_payment_month_valid CHECK (
    isfinite(period_month) AND extract(day FROM period_month)=1);
ALTER TABLE public.owner_statements
  ADD CONSTRAINT owner_statement_financial_amounts_valid CHECK (
    gross_income BETWEEN 0 AND 999999999999.99 AND gross_income=round(gross_income,2)
    AND commission_amount BETWEEN 0 AND gross_income AND commission_amount=round(commission_amount,2)
    AND tax_amount BETWEEN 0 AND gross_income AND tax_amount=round(tax_amount,2)
    AND other_deductions BETWEEN 0 AND gross_income AND other_deductions=round(other_deductions,2)
    AND net_amount BETWEEN 0 AND gross_income
    AND net_amount=gross_income-commission_amount-tax_amount-other_deductions),
  ADD CONSTRAINT owner_statement_month_valid CHECK (
    isfinite(period_month) AND extract(day FROM period_month)=1);
ALTER TABLE public.owner_statement_deductions
  ADD CONSTRAINT owner_deduction_finite_amount CHECK (amount<=999999999999.99);
ALTER TABLE public.rent_receipts
  ADD CONSTRAINT rent_receipt_finite_amount CHECK (amount<=999999999999.99);

-- This privileged function is invoked by its trigger, never as a client RPC.
REVOKE ALL ON FUNCTION public.guard_owner_statement_deduction_change()
  FROM PUBLIC,anon,authenticated;

COMMENT ON POLICY leases_financial_insert ON public.leases IS
  'Restrictive tenant permission gate, also enforced against legacy ALL policies.';
COMMIT;
