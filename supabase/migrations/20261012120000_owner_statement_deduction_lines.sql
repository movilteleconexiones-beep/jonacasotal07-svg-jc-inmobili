-- STAGING REVIEW ONLY. This migration must not be applied to production before
-- independent Supabase/PostgREST, RLS, tax and transaction-lock validation.
-- A classified, immutable deduction log for each owner's period statement.
-- It DOES NOT recalculate existing statements or transfer money.
BEGIN;

-- Each statement is globally identified by id, but a composite FK is needed
-- to guarantee all ledger entries belong to the same inmobiliaria.
ALTER TABLE public.owner_statements
  ADD CONSTRAINT owner_statements_org_id_key UNIQUE (organization_id, id);

CREATE TABLE public.owner_statement_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  statement_id uuid NOT NULL,
  charge_date date NOT NULL,
  category text NOT NULL CHECK (category IN (
    'WATER','ELECTRICITY','GAS','WASTE','BUILDING_FEE',
    'MAINTENANCE','REPAIRS','INSURANCE','TAX','COMMISSION','OTHER'
  )),
  responsible_party text NOT NULL CHECK (responsible_party IN ('OWNER','TENANT','AGENCY')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 4 AND 500),
  support_reference text CHECK (support_reference IS NULL OR length(support_reference) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','VOIDED')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_deductions_statement_same_tenant_fk
    FOREIGN KEY (organization_id, statement_id)
    REFERENCES public.owner_statements(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT owner_deductions_void_reason_check
    CHECK (status <> 'VOIDED' OR (void_reason IS NOT NULL AND length(btrim(void_reason)) BETWEEN 6 AND 500))
);

CREATE INDEX owner_deductions_statement_created_idx
  ON public.owner_statement_deductions (organization_id, statement_id, created_at DESC);

-- Serialize mutations with statement state changes and reject edits to a
-- generated/paid statement. Even draft entries are immutable: corrections
-- require an auditable VOID and a new line.
CREATE FUNCTION public.guard_owner_statement_deduction_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  parent_status text;
  actor uuid;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE='42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Deduction entries must be voided rather than deleted' USING ERRCODE='23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'VOIDED' OR NEW.status = OLD.status OR
       (OLD.status = 'APPROVED' AND NEW.status <> 'VOIDED') OR
       (OLD.status = 'DRAFT' AND NEW.status NOT IN ('APPROVED','VOIDED')) THEN
      RAISE EXCEPTION 'Invalid deduction status transition' USING ERRCODE='23514';
    END IF;
    IF ROW(NEW.organization_id,NEW.statement_id,NEW.charge_date,NEW.category,
           NEW.responsible_party,NEW.amount,NEW.description,NEW.support_reference,
           NEW.created_by,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.organization_id,OLD.statement_id,OLD.charge_date,OLD.category,
           OLD.responsible_party,OLD.amount,OLD.description,OLD.support_reference,
           OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Deduction values are immutable; void and replace' USING ERRCODE='23514';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
       NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
       NEW.voided_by IS DISTINCT FROM OLD.voided_by OR
       NEW.voided_at IS DISTINCT FROM OLD.voided_at OR
       (NEW.status <> 'VOIDED' AND NEW.void_reason IS DISTINCT FROM OLD.void_reason) THEN
      RAISE EXCEPTION 'Approval and void metadata is server-owned' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.status <> 'DRAFT' OR NEW.created_by <> actor OR
        NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR
        NEW.voided_by IS NOT NULL OR NEW.voided_at IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
    RAISE EXCEPTION 'New deductions must be draft entries authored by the user' USING ERRCODE='23514';
  END IF;

  SELECT s.status INTO parent_status
  FROM public.owner_statements s
  WHERE s.organization_id = NEW.organization_id AND s.id = NEW.statement_id
  FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft owner statements accept deductions' USING ERRCODE='23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'APPROVED' THEN
      NEW.approved_at := now();
      NEW.approved_by := actor;
      NEW.void_reason := NULL;
    ELSIF NEW.status = 'VOIDED' THEN
      NEW.voided_at := now();
      NEW.voided_by := actor;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER owner_statement_deductions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.owner_statement_deductions
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_statement_deduction_change();

ALTER TABLE public.owner_statement_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_statement_deductions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.owner_statement_deductions TO authenticated;

CREATE POLICY owner_deductions_view
ON public.owner_statement_deductions FOR SELECT TO authenticated
USING (public.has_org_permission(organization_id, 'owner_statements.view'));

CREATE POLICY owner_deductions_insert
ON public.owner_statement_deductions FOR INSERT TO authenticated
WITH CHECK (public.has_org_permission(organization_id, 'owner_statements.create')
  AND created_by = auth.uid() AND status = 'DRAFT');

CREATE POLICY owner_deductions_update_status
ON public.owner_statement_deductions FOR UPDATE TO authenticated
USING (public.has_org_permission(organization_id, 'owner_statements.create'))
WITH CHECK (public.has_org_permission(organization_id, 'owner_statements.create'));

COMMENT ON TABLE public.owner_statement_deductions IS
'Per-owner per-period classified charges. No automatic ledger payouts, tax decisions, or recalculation of owner_statements.';
COMMENT ON COLUMN public.owner_statement_deductions.responsible_party IS
'OWNER affects the owner's deduction reconciliation; TENANT and AGENCY must never be deducted from owner net.';
COMMENT ON COLUMN public.owner_statement_deductions.category IS
'TAX and COMMISSION are separate columns in owner_statements and must not be counted again as other_deductions.';
COMMIT;
