-- INMOJCO #104/#203 — review candidate, not a Supabase migration.
-- NOT APPROVED for production: requires backup, staging, E2E and protection.
-- Replaces 5 legacy CRM FKs IN PLACE instead of adding parallel FKs,
-- preventing ambiguous PostgREST embeds (PGRST201) while retaining names.
-- Never "repair" the live migration ledger from this standalone candidate.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
-- Serialize parent updates before any existing-row preflight/DDL.
LOCK TABLE public.contacts,public.properties,public.leads,public.property_consignments
  IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
DECLARE
  r record;
  v_definition text;
  v_parent_oid oid;
BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'CRM tenant FK blocked: postgres owner required';
  END IF;
  IF (SELECT count(*) FROM pg_class
    WHERE oid IN('public.contacts'::regclass,'public.properties'::regclass,
                 'public.leads'::regclass,'public.property_consignments'::regclass)
      AND relowner='postgres'::regrole AND relrowsecurity AND relkind IN('r','p'))<>4
  THEN RAISE EXCEPTION 'CRM tenant FK blocked: owner/table/RLS contract changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid='public.contacts'::regclass
      AND contype='u' AND convalidated
      AND pg_get_constraintdef(oid,true)='UNIQUE (organization_id, id)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid='public.properties'::regclass
      AND contype='u' AND convalidated
      AND pg_get_constraintdef(oid,true)='UNIQUE (organization_id, id)')
  THEN RAISE EXCEPTION 'CRM tenant FK blocked: parent composite unique keys missing'; END IF;
  -- Assert one and only one FK per child/parent, and pin old and new forms.
  FOR r IN SELECT * FROM (VALUES
     ('leads','contacts','leads_contact_id_fkey',
      'FOREIGN KEY (contact_id) REFERENCES contacts(id)',
      'FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)'),
     ('leads','properties','leads_property_id_fkey',
      'FOREIGN KEY (property_id) REFERENCES properties(id)',
      'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id)'),
     ('property_consignments','contacts','property_consignments_contact_id_fkey',
      'FOREIGN KEY (contact_id) REFERENCES contacts(id)',
      'FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)'),
     ('property_consignments','properties','property_consignments_property_id_fkey',
      'FOREIGN KEY (property_id) REFERENCES properties(id)',
      'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id)'),
     ('property_consignments','leads','property_consignments_lead_id_fkey',
      'FOREIGN KEY (lead_id) REFERENCES leads(id)',
      'FOREIGN KEY (organization_id, lead_id, contact_id) REFERENCES leads(organization_id, id, contact_id)')
  ) AS x(child,parent,fk_name,old_def,new_def)
  LOOP
    v_parent_oid:=to_regclass('public.'||r.parent);
    SELECT pg_get_constraintdef(c.oid,true) INTO v_definition
    FROM pg_constraint c WHERE c.conrelid=to_regclass('public.'||r.child)
      AND c.conname=r.fk_name AND c.contype='f'
      AND c.confrelid=v_parent_oid AND NOT c.condeferrable;
    IF v_definition IS NULL OR v_definition NOT IN(r.old_def,r.new_def)
      OR (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid=to_regclass('public.'||r.child)
         AND c.contype='f' AND c.confrelid=v_parent_oid)<>1
    THEN RAISE EXCEPTION 'CRM tenant FK blocked: unexpected or parallel relationship %',r.fk_name;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.leads l
      JOIN public.contacts c ON c.id=l.contact_id
      WHERE l.organization_id<>c.organization_id)
    OR EXISTS(SELECT 1 FROM public.leads l
      JOIN public.properties p ON p.id=l.property_id
      WHERE l.organization_id<>p.organization_id)
    OR EXISTS(SELECT 1 FROM public.property_consignments pc
      JOIN public.contacts c ON c.id=pc.contact_id
      WHERE pc.organization_id<>c.organization_id)
    OR EXISTS(SELECT 1 FROM public.property_consignments pc
      JOIN public.properties p ON p.id=pc.property_id
      WHERE pc.organization_id<>p.organization_id)
    OR EXISTS(SELECT 1 FROM public.property_consignments pc
      WHERE pc.lead_id IS NOT NULL AND pc.contact_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.property_consignments pc
      JOIN public.leads l ON l.id=pc.lead_id
      WHERE pc.organization_id<>l.organization_id
        OR pc.contact_id IS DISTINCT FROM l.contact_id)
  THEN RAISE EXCEPTION 'NO-GO: existing CRM cross-agency/contact links'; END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint c
      WHERE c.conrelid='public.property_consignments'::regclass
        AND c.conname='jco_consignment_lead_requires_contact'
        AND (c.contype<>'c' OR pg_get_constraintdef(c.oid,true)<>
         'CHECK (lead_id IS NULL OR contact_id IS NOT NULL)'))
  THEN RAISE EXCEPTION 'CRM tenant FK blocked: lead/contact CHECK drift'; END IF;
END
$preflight$;

-- An unshared index on the three referenced columns supports the exact
-- (organization, lead, contact) invariant; no new FK paths are created.
CREATE UNIQUE INDEX IF NOT EXISTS jco_leads_org_id_contact_fk_key
  ON public.leads(organization_id,id,contact_id);
DO $replace$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('leads','leads_contact_id_fkey','contact_id','contacts','organization_id,contact_id','organization_id,id'),
    ('leads','leads_property_id_fkey','property_id','properties','organization_id,property_id','organization_id,id'),
    ('property_consignments','property_consignments_contact_id_fkey','contact_id','contacts','organization_id,contact_id','organization_id,id'),
    ('property_consignments','property_consignments_property_id_fkey','property_id','properties','organization_id,property_id','organization_id,id'),
    ('property_consignments','property_consignments_lead_id_fkey','lead_id','leads','organization_id,lead_id,contact_id','organization_id,id,contact_id')
  ) AS x(child,fk_name,legacy_col,parent,new_cols,parent_cols)
  LOOP
    IF EXISTS(SELECT 1 FROM pg_constraint c
      WHERE c.conrelid=to_regclass('public.'||r.child) AND c.conname=r.fk_name
        AND cardinality(c.conkey)=1)
    THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.child,r.fk_name);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.%I(%s) NOT VALID',
          r.child,r.fk_name,r.new_cols,r.parent,r.parent_cols);
    END IF;
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',r.child,r.fk_name);
  END LOOP;
END
$replace$;
DO $check$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='public.property_consignments'::regclass
      AND conname='jco_consignment_lead_requires_contact') THEN
    ALTER TABLE public.property_consignments
      ADD CONSTRAINT jco_consignment_lead_requires_contact
      CHECK (lead_id IS NULL OR contact_id IS NOT NULL) NOT VALID;
  END IF;
END $check$;
ALTER TABLE public.property_consignments
  VALIDATE CONSTRAINT jco_consignment_lead_requires_contact;
DO $verify$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('leads','contacts','leads_contact_id_fkey','FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)'),
    ('leads','properties','leads_property_id_fkey','FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id)'),
    ('property_consignments','contacts','property_consignments_contact_id_fkey','FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)'),
    ('property_consignments','properties','property_consignments_property_id_fkey','FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id)'),
    ('property_consignments','leads','property_consignments_lead_id_fkey','FOREIGN KEY (organization_id, lead_id, contact_id) REFERENCES leads(organization_id, id, contact_id)')
  ) AS x(child,parent,fk_name,expected_definition)
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_constraint c
      WHERE c.conrelid=to_regclass('public.'||r.child) AND c.conname=r.fk_name
      AND c.convalidated AND pg_get_constraintdef(c.oid,true)=r.expected_definition)
      OR (SELECT count(*) FROM pg_constraint c
        WHERE c.conrelid=to_regclass('public.'||r.child)
        AND c.confrelid=to_regclass('public.'||r.parent) AND c.contype='f')<>1
    THEN RAISE EXCEPTION 'CRM tenant FK blocked: invalid or duplicate relationship %',r.fk_name; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='public.property_consignments'::regclass
      AND conname='jco_consignment_lead_requires_contact' AND convalidated)
  THEN RAISE EXCEPTION 'CRM tenant FK blocked: lead/contact guard invalid'; END IF;
END
$verify$;
NOTIFY pgrst,'reload schema';
COMMIT;
