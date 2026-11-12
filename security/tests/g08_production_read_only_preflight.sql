-- INMOJCO G08 #91 | production READ-ONLY preflight | 2026-11-12
-- Execute ONLY against project cuitgyqrjibgwuniapmk as authorized SQL admin.
-- Does NOT back up the database and does NOT authorize a migration.
-- No user PII, keys, paths, or rows are returned: only metadata and counts.
-- Must be rerun immediately before DDL; restore-proof is a SEPARATE blocker.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';

DO $g08$
DECLARE
  link record;
  actual_fk text;
  validated boolean;
  actual_del "char";
  linked_rows bigint;
  foreign_rows bigint;
  total_linked bigint := 0;
  total_foreign bigint := 0;
  checked int := 0;
  ownership_count bigint;
  ownership_foreign bigint;
  parent_name text;
  matched_unique bigint;
  org_column_nullable text;
BEGIN
  IF EXISTS(SELECT 1 FROM public.organizations
            WHERE status IS NULL OR status NOT IN ('ACTIVE','INACTIVE')) THEN
    RAISE EXCEPTION 'G08 NO-GO: unexpected organization state';
  END IF;
  -- Production before G08 has exactly 16 legacy one-column FKs. The delete
  -- action is checked via catalog confdeltype to prevent silent semantic drift.
  FOR link IN SELECT * FROM (VALUES
    ('leads','contact_id','contacts','leads_contact_id_fkey','c'),
    ('leads','property_id','properties','leads_property_id_fkey','n'),
    ('activities','contact_id','contacts','activities_contact_id_fkey','c'),
    ('activities','deal_id','deals','activities_deal_id_fkey','c'),
    ('activities','lead_id','leads','activities_lead_id_fkey','c'),
    ('activities','property_id','properties','activities_property_id_fkey','c'),
    ('appointments','contact_id','contacts','appointments_contact_id_fkey','n'),
    ('appointments','lead_id','leads','appointments_lead_id_fkey','n'),
    ('appointments','property_id','properties','appointments_property_id_fkey','n'),
    ('commissions','deal_id','deals','commissions_deal_id_fkey','c'),
    ('portal_access_links','contact_id','contacts','portal_access_links_contact_id_fkey','c'),
    ('portal_access_links','owner_id','property_owners','portal_access_links_owner_id_fkey','c'),
    ('property_consignments','contact_id','contacts','property_consignments_contact_id_fkey','r'),
    ('property_consignments','lead_id','leads','property_consignments_lead_id_fkey','r'),
    ('property_consignments','property_id','properties','property_consignments_property_id_fkey','r'),
    ('property_private_photos','property_id','properties','property_private_photos_property_id_fkey','c')
  ) AS x(child_name,link_column,parent_name,constraint_name,delete_char)
  LOOP
    SELECT pg_get_constraintdef(c.oid),c.convalidated,c.confdeltype
      INTO actual_fk,validated,actual_del
      FROM pg_constraint c WHERE c.conrelid=to_regclass('public.'||link.child_name)
         AND c.conname=link.constraint_name AND c.contype='f';
    IF actual_fk IS NULL OR validated IS NOT TRUE
       OR actual_del<>link.delete_char::"char"
       OR actual_fk NOT LIKE 'FOREIGN KEY ('||link.link_column||
                            ') REFERENCES '||link.parent_name||'(id) ON DELETE %'
    THEN
      RAISE EXCEPTION 'G08 NO-GO: missing/changed FK for %.%',
        link.child_name,link.link_column;
    END IF;

    SELECT c.is_nullable INTO org_column_nullable
      FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=link.child_name
        AND c.column_name='organization_id';
    IF org_column_nullable IS DISTINCT FROM 'NO' THEN
      RAISE EXCEPTION 'G08 NO-GO: %.organization_id nullable or absent',link.child_name;
    END IF;

    EXECUTE format('SELECT count(*),count(*) FILTER (WHERE c.organization_id IS DISTINCT FROM p.organization_id)
      FROM public.%I c JOIN public.%I p ON p.id=c.%I',
      link.child_name,link.parent_name,link.link_column)
      INTO linked_rows,foreign_rows;
    IF foreign_rows<>0 THEN
      RAISE EXCEPTION 'G08 NO-GO: %.% has % cross-tenant references',
        link.child_name,link.link_column,foreign_rows;
    END IF;
    checked:=checked+1;
    total_linked:=total_linked+linked_rows;
    total_foreign:=total_foreign+foreign_rows;
  END LOOP;

  IF checked<>16 THEN RAISE EXCEPTION 'G08 NO-GO: wrong FK count'; END IF;

  FOREACH parent_name IN ARRAY ARRAY['contacts','properties','property_owners']
  LOOP
    SELECT count(*) INTO matched_unique
    FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.'||parent_name)
      AND c.contype='u'
      AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (organization_id, id)%';
    IF matched_unique<>1 THEN
      RAISE EXCEPTION 'G08 NO-GO: parent %.organization_id,id unique missing/ambiguous',parent_name;
    END IF;
  END LOOP;

  FOREACH parent_name IN ARRAY ARRAY['leads','deals']
  LOOP
    SELECT count(*) INTO matched_unique FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.'||parent_name)
      AND c.contype='u' AND pg_get_constraintdef(c.oid)
        LIKE 'UNIQUE (organization_id, id)%';
    IF matched_unique<>0 THEN
      RAISE EXCEPTION 'G08 NO-GO: parent % already has a scoped unique key',parent_name;
    END IF;
  END LOOP;

  IF to_regprocedure('jco_private.enforce_ownership_same_tenant()') IS NOT NULL
     OR to_regprocedure('jco_private.prevent_ownership_parent_reassignment()') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname IN
       ('enforce_property_ownership_same_tenant','prevent_property_link_tenant_reassignment',
        'prevent_owner_link_tenant_reassignment') AND NOT t.tgisinternal)
  THEN RAISE EXCEPTION 'G08 NO-GO: ownership guard already present'; END IF;

  SELECT count(*),
         count(*) FILTER(WHERE p.organization_id IS DISTINCT FROM owner.organization_id)
    INTO ownership_count,ownership_foreign
  FROM public.property_ownerships x
  JOIN public.properties p ON p.id=x.property_id
  JOIN public.property_owners owner ON owner.id=x.owner_id;
  IF ownership_foreign<>0 THEN
    RAISE EXCEPTION 'G08 NO-GO: property ownership cross-tenant links';
  END IF;

  PERFORM set_config('jco.g08.checked',checked::text,true);
  PERFORM set_config('jco.g08.linked',total_linked::text,true);
  PERFORM set_config('jco.g08.cross_tenant',total_foreign::text,true);
  PERFORM set_config('jco.g08.ownership_links',ownership_count::text,true);
END $g08$;

SELECT 'SCHEMA_READY_BACKUP_NOT_CERTIFIED' AS g08_state,
 current_setting('jco.g08.checked',true)::int AS legacy_fks_checked,
 current_setting('jco.g08.linked',true)::int AS linked_rows_examined,
 current_setting('jco.g08.cross_tenant',true)::int AS cross_tenant_found,
 current_setting('jco.g08.ownership_links',true)::int AS ownerships_checked,
 current_setting('transaction_read_only') AS read_only;
ROLLBACK;
