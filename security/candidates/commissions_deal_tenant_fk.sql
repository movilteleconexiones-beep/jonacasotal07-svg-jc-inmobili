-- INMOJCO #104/#203. REVIEW CANDIDATE ONLY. NOT A SUPABASE MIGRATION.
-- NEVER apply to live Supabase without reconciliation #104, clean backup,
-- staging, rollout/rollback and tested PostgREST schema reload.
--
-- The current FK commissions(deal_id) -> deals(id) does not require that
-- the deal belong to the same organization as its commission.
-- REPLACE the original FK (SAME NAME) instead of adding a second FK:
-- duplicate FK paths can break embedded PostgREST joins (PGRST201).
-- Maintain ON DELETE CASCADE; keep RLS and API GRANTs unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Explicit lock order to serialize the preflight with commission/deal writes.
LOCK TABLE public.deals IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.commissions IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
DECLARE
  v_parent oid:=to_regclass('public.deals');
  v_child oid:=to_regclass('public.commissions');
  v_fk text;
  v_unique text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'commission deal FK blocked: must run as postgres owner';
  END IF;
  IF v_parent IS NULL OR v_child IS NULL OR EXISTS(
    SELECT 1 FROM pg_class c WHERE c.oid IN(v_child,v_parent)
    AND (c.relowner <> 'postgres'::regrole OR c.relkind NOT IN('r','p') OR NOT c.relrowsecurity)
  ) THEN
    RAISE EXCEPTION 'commission deal FK blocked: owner/table/RLS drift';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=v_parent)
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=v_child)
  THEN RAISE EXCEPTION 'commission deal FK blocked: missing tables'; END IF;
  SELECT pg_get_constraintdef(c.oid,true) INTO v_fk FROM pg_constraint c
    WHERE c.conrelid=v_child AND c.conname='commissions_deal_id_fkey'
      AND c.contype='f' AND c.confrelid=v_parent;
  IF v_fk IS NULL OR v_fk NOT IN(
    'FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE',
    'FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id) ON DELETE CASCADE'
  ) THEN
    RAISE EXCEPTION 'commission deal FK blocked: original FK definition drift';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c
      WHERE c.conrelid=v_child AND c.contype='f' AND c.confrelid=v_parent)<>1
  THEN
    RAISE EXCEPTION 'commission deal FK blocked: ambiguous PostgREST deal relationships';
  END IF;
  SELECT pg_get_constraintdef(c.oid,true) INTO v_unique FROM pg_constraint c
    WHERE c.conrelid=v_parent AND c.conname='deals_organization_id_id_unique';
  IF v_unique IS NOT NULL AND v_unique <>
      'UNIQUE (organization_id, id)' THEN
    RAISE EXCEPTION 'commission deal FK blocked: named parent uniqueness drift';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.commissions cm
    LEFT JOIN public.deals d ON d.id=cm.deal_id
    WHERE d.id IS NULL OR cm.organization_id IS DISTINCT FROM d.organization_id
  ) THEN
    RAISE EXCEPTION 'commission deal FK blocked: existing cross-tenant or orphan commissions';
  END IF;
END
$preflight$;
DO $parent$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
     WHERE conrelid='public.deals'::regclass
       AND conname='deals_organization_id_id_unique') THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_organization_id_id_unique UNIQUE(organization_id,id);
  END IF;
END
$parent$;
DO $replace$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.commissions'::regclass
      AND conname='commissions_deal_id_fkey'
      AND pg_get_constraintdef(oid,true)=
        'FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE') THEN
    ALTER TABLE public.commissions DROP CONSTRAINT commissions_deal_id_fkey;
    ALTER TABLE public.commissions
      ADD CONSTRAINT commissions_deal_id_fkey
      FOREIGN KEY(organization_id,deal_id)
      REFERENCES public.deals(organization_id,id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$replace$;
ALTER TABLE public.commissions VALIDATE CONSTRAINT commissions_deal_id_fkey;
DO $postcheck$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.commissions'::regclass
      AND c.conname='commissions_deal_id_fkey' AND c.convalidated
      AND pg_get_constraintdef(c.oid,true)=
        'FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id) ON DELETE CASCADE'
  ) OR (SELECT count(*) FROM pg_constraint c
    WHERE c.conrelid='public.commissions'::regclass
      AND c.contype='f' AND c.confrelid='public.deals'::regclass)<>1
  THEN
    RAISE EXCEPTION 'commission deal FK blocked: wrong composite or ambiguous FK';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
    WHERE oid='public.commissions'::regclass)
    OR NOT has_table_privilege('authenticated','public.commissions','INSERT')
    OR NOT has_table_privilege('service_role','public.commissions','SELECT')
  THEN RAISE EXCEPTION 'commission deal FK blocked: lost RLS/API privileges'; END IF;
END
$postcheck$;
NOTIFY pgrst, 'reload schema';
COMMIT;
