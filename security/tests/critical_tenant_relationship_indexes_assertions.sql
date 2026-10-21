-- Verify the exact ordered B-tree index prefixes used to support tenant FKs.
DO $check$
DECLARE actual_count integer;
BEGIN
  SELECT count(*) INTO actual_count FROM (
    VALUES
    ('deals_org_contact_fk_fast_idx', 'deals', ARRAY['organization_id','contact_id']::text[]),
    ('deals_org_property_fk_fast_idx', 'deals', ARRAY['organization_id','property_id']::text[]),
    ('maintenance_requests_org_fk_fast_idx', 'maintenance_requests', ARRAY['organization_id']::text[]),
    ('portal_links_contact_fk_fast_idx', 'portal_access_links', ARRAY['contact_id']::text[]),
    ('portal_links_owner_fk_fast_idx', 'portal_access_links', ARRAY['owner_id']::text[])
  ) AS expected(index_name, table_name, column_names)
  JOIN pg_class ix ON ix.relname=expected.index_name
  JOIN pg_namespace ns ON ns.oid=ix.relnamespace AND ns.nspname='public'
  JOIN pg_index idx ON idx.indexrelid=ix.oid
  JOIN pg_class tab ON tab.oid=idx.indrelid AND tab.relname=expected.table_name
  JOIN pg_am am ON am.oid=ix.relam AND am.amname='btree'
  WHERE idx.indisvalid AND idx.indisready AND
    ARRAY(SELECT a.attname::text FROM unnest(idx.indkey) WITH ORDINALITY AS keys(attnum,pos)
          JOIN pg_attribute a ON a.attrelid=tab.oid AND a.attnum=keys.attnum
          WHERE keys.pos <= array_length(expected.column_names,1)
          ORDER BY keys.pos)=expected.column_names;
  IF actual_count<>5 THEN
    RAISE EXCEPTION 'Only % of 5 tenant relationship indexes match their intended ordered column prefixes',actual_count;
  END IF;
END;
$check$;
