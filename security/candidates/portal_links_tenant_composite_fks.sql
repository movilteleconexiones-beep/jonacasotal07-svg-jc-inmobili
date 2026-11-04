-- INMOJCO #104/#203 — REVIEW CANDIDATE ONLY; NOT a Supabase migration.
-- DO NOT RUN IN PRODUCTION before history reconciliation, backups, staging
-- E2E role tests, branch protection, Railway check suites and rollback signoff.
-- Portal links may target a contact OR an owner, never both. Their existing
-- FK(id) paths alone do not enforce organization_id consistency.
-- Replace each original FK IN PLACE (retain names and ON DELETE CASCADE),
-- not add extra relationships that could trigger ambiguous PostgREST embeds.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.contacts IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.property_owners IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.portal_access_links IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
DECLARE
  v_child oid:=to_regclass('public.portal_access_links');
  v_contact oid:=to_regclass('public.contacts');
  v_owner oid:=to_regclass('public.property_owners');
  v_relation text;
  v_old text;
  v_new text;
BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'portal tenant FK blocked: postgres owner required';
  END IF;
  IF v_child IS NULL OR v_contact IS NULL OR v_owner IS NULL
     OR EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN(v_child,v_contact,v_owner)
       AND (c.relowner<>'postgres'::regrole OR c.relkind NOT IN('r','p')
         OR NOT c.relrowsecurity)) THEN
    RAISE EXCEPTION 'portal tenant FK blocked: table/owner/RLS contract changed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=v_child
      AND conname='portal_access_links_check' AND contype='c')
     OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=v_contact
      AND conname='financial_contacts_tenant_id_unique' AND contype='u'
      AND convalidated AND pg_get_constraintdef(oid,true)='UNIQUE (organization_id, id)')
     OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=v_owner
      AND conname='financial_property_owners_tenant_id_unique' AND contype='u'
      AND convalidated AND pg_get_constraintdef(oid,true)='UNIQUE (organization_id, id)')
  THEN
    RAISE EXCEPTION 'portal tenant FK blocked: check or parent composite uniqueness missing';
  END IF;
  FOR v_relation,v_old,v_new IN
    SELECT * FROM (VALUES
      ('portal_access_links_contact_id_fkey',
       'FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE',
       'FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE CASCADE'),
      ('portal_access_links_owner_id_fkey',
       'FOREIGN KEY (owner_id) REFERENCES property_owners(id) ON DELETE CASCADE',
       'FOREIGN KEY (organization_id, owner_id) REFERENCES property_owners(organization_id, id) ON DELETE CASCADE')
    ) v(name,old_definition,new_definition)
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_constraint c
        WHERE c.conrelid=v_child AND c.conname=v_relation AND c.contype='f'
          AND pg_get_constraintdef(c.oid,true) IN (v_old,v_new)) THEN
      RAISE EXCEPTION 'portal tenant FK blocked: original FK definition changed: %',v_relation;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=v_child
    AND c.contype='f' AND c.confrelid=v_contact)<>1 OR
     (SELECT count(*) FROM pg_constraint c WHERE c.conrelid=v_child
    AND c.contype='f' AND c.confrelid=v_owner)<>1 THEN
    RAISE EXCEPTION 'portal tenant FK blocked: ambiguous PostgREST relationships';
  END IF;
  IF EXISTS(SELECT 1 FROM public.portal_access_links l
      LEFT JOIN public.contacts c ON c.id=l.contact_id
      LEFT JOIN public.property_owners o ON o.id=l.owner_id
      WHERE (l.contact_id IS NOT NULL AND (c.id IS NULL OR c.organization_id<>l.organization_id))
         OR (l.owner_id IS NOT NULL AND (o.id IS NULL OR o.organization_id<>l.organization_id))
  ) THEN
    RAISE EXCEPTION 'portal tenant FK blocked: orphan or cross-organization portal links';
  END IF;
END
$preflight$;
DO $replace$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_constraint c
      WHERE c.conrelid='public.portal_access_links'::regclass
      AND c.conname='portal_access_links_contact_id_fkey'
      AND pg_get_constraintdef(c.oid,true)=
          'FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE') THEN
    ALTER TABLE public.portal_access_links
      DROP CONSTRAINT portal_access_links_contact_id_fkey;
    ALTER TABLE public.portal_access_links
      ADD CONSTRAINT portal_access_links_contact_id_fkey
      FOREIGN KEY(organization_id,contact_id)
      REFERENCES public.contacts(organization_id,id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint c
      WHERE c.conrelid='public.portal_access_links'::regclass
      AND c.conname='portal_access_links_owner_id_fkey'
      AND pg_get_constraintdef(c.oid,true)=
          'FOREIGN KEY (owner_id) REFERENCES property_owners(id) ON DELETE CASCADE') THEN
    ALTER TABLE public.portal_access_links
      DROP CONSTRAINT portal_access_links_owner_id_fkey;
    ALTER TABLE public.portal_access_links
      ADD CONSTRAINT portal_access_links_owner_id_fkey
      FOREIGN KEY(organization_id,owner_id)
      REFERENCES public.property_owners(organization_id,id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$replace$;
ALTER TABLE public.portal_access_links
  VALIDATE CONSTRAINT portal_access_links_contact_id_fkey;
ALTER TABLE public.portal_access_links
  VALIDATE CONSTRAINT portal_access_links_owner_id_fkey;
DO $verify$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.portal_access_links'::regclass
     AND c.conname='portal_access_links_contact_id_fkey' AND c.convalidated
     AND pg_get_constraintdef(c.oid,true)=
       'FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE CASCADE')
   OR NOT EXISTS(SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.portal_access_links'::regclass
     AND c.conname='portal_access_links_owner_id_fkey' AND c.convalidated
     AND pg_get_constraintdef(c.oid,true)=
       'FOREIGN KEY (organization_id, owner_id) REFERENCES property_owners(organization_id, id) ON DELETE CASCADE')
   OR (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid='public.portal_access_links'::regclass AND c.contype='f'
       AND c.confrelid='public.contacts'::regclass)<>1
   OR (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid='public.portal_access_links'::regclass AND c.contype='f'
       AND c.confrelid='public.property_owners'::regclass)<>1
  THEN RAISE EXCEPTION 'portal tenant FK blocked: composite FKs invalid or ambiguous'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
      WHERE oid='public.portal_access_links'::regclass)
    OR NOT has_table_privilege('authenticated','public.portal_access_links','INSERT')
    OR NOT has_table_privilege('service_role','public.portal_access_links','SELECT')
  THEN RAISE EXCEPTION 'portal tenant FK blocked: RLS/API grants changed'; END IF;
END
$verify$;
NOTIFY pgrst,'reload schema';
COMMIT;
