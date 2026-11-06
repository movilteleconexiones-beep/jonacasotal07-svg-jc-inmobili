-- INMOJCO #104/#203: READ-ONLY, metadata-only catalogue fingerprints.
-- Snapshot: 2026-11-03 live Supabase PostgreSQL 17.
-- Never reads tenant records or proves historical DDL origin / restore success.
-- Intentional schema upgrades can change these hashes; investigate, do not repair.
WITH expected(identifier,owner,relkind,rls_enabled,force_rls,
  columns_count,constraints_count,indexes_count,policies_count,triggers_count,
  columns_sha256,constraints_sha256,indexes_sha256,policies_sha256,triggers_sha256,
  raw_table_acl_sha256,anon_select,anon_insert,auth_select,auth_insert,service_read) AS (
 VALUES
 ('private.property_intake_sites','postgres','r',true,false,5,6,2,0,0,
  '3f4cf8f06a37a75487bb17161e1993bd0fb1cdba5ec03beb341ced2d5b5aafe5',
  '721d8491d8610b45708705f1f74659b243fe0c1d6e70bfca387ca6482a3a5176',
  '1aecff8f509264945fa87d193f9512d407a9636ed55f9d275b99b1eacd3cd4e4',
  '73c8ffe9553f8c24730219e392209eaa97d52ee18633550b3ce8526c9955e6e0',
  '73c8ffe9553f8c24730219e392209eaa97d52ee18633550b3ce8526c9955e6e0',
  'd51696be62bea2471822f7114b081fc4989012a076cf2721dc1bf1139b89773d',
  false,false,false,false,false),
 ('public.property_consignments','postgres','r',true,false,15,15,9,2,0,
  'f7b8a75e1670fc8728a3abbf53f7e79927201a0a62db86de35940aa07bb88a17',
  'f04514ac965e941ea60786cdacbce638e028ee22309a5d00a8158d0f98324b8a',
  '53934ed53fde0809abf3cafd07e1382d8427d0e8719ce4df599622a4e92277e0',
  '98cf9518c182a65f92432189b60575483d95257ea4b7f614e6443c0ade450773',
  '73c8ffe9553f8c24730219e392209eaa97d52ee18633550b3ce8526c9955e6e0',
  '2308cfd3881b7f11d704b37d12348d9b6b89b510e769eb71425faef3c92a3392',
  false,false,true,false,true)
), objects AS (
 SELECT e.*,c.oid,c.relowner,c.relkind AS actual_kind,c.relrowsecurity,
 c.relforcerowsecurity,c.relacl,pg_get_userbyid(c.relowner) AS actual_owner
 FROM expected e
 LEFT JOIN pg_class c ON c.oid=to_regclass(e.identifier)
), actual AS (
 SELECT o.*,
 (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=o.oid AND a.attnum>0 AND NOT a.attisdropped) AS actual_columns,
 (SELECT count(*) FROM pg_constraint co WHERE co.conrelid=o.oid) AS actual_constraints,
 (SELECT count(*) FROM pg_index idx WHERE idx.indrelid=o.oid) AS actual_indexes,
 (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid=o.oid) AS actual_policies,
 (SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid=o.oid AND NOT tg.tgisinternal) AS actual_triggers,
 (SELECT encode(extensions.digest(coalesce(string_agg(
   format('%s|%s|%s|%s|%s|%s|%s',a.attnum,a.attname,
      format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,
      a.attgenerated,coalesce(pg_get_expr(ad.adbin,ad.adrelid),'∅')),
   E'\n' ORDER BY a.attnum),'∅'),'sha256'),'hex')
  FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
  WHERE a.attrelid=o.oid AND a.attnum>0 AND NOT a.attisdropped) AS actual_cols_sha,
 (SELECT encode(extensions.digest(coalesce(string_agg(
   format('%s|%s|%s|%s|%s',co.conname,co.contype,co.convalidated,
      co.condeferrable,pg_get_constraintdef(co.oid,true)),
   E'\n' ORDER BY co.conname),'∅'),'sha256'),'hex')
  FROM pg_constraint co WHERE co.conrelid=o.oid) AS actual_constraints_sha,
 (SELECT encode(extensions.digest(coalesce(string_agg(
   format('%s|%s|%s',ci.relname,idx.indisvalid,pg_get_indexdef(idx.indexrelid)),
   E'\n' ORDER BY ci.relname),'∅'),'sha256'),'hex')
  FROM pg_index idx JOIN pg_class ci ON ci.oid=idx.indexrelid WHERE idx.indrelid=o.oid) AS actual_indexes_sha,
 (SELECT encode(extensions.digest(coalesce(string_agg(
   format('%s|%s|%s|%s|%s|%s',pol.polname,pol.polcmd,pol.polpermissive,
      (SELECT string_agg(rolname,',' ORDER BY rolname) FROM pg_roles r
        WHERE r.oid=ANY(pol.polroles)),
      coalesce(pg_get_expr(pol.polqual,pol.polrelid),'∅'),
      coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'∅')),
   E'\n' ORDER BY pol.polname),'∅'),'sha256'),'hex')
  FROM pg_policy pol WHERE pol.polrelid=o.oid) AS actual_policies_sha,
 (SELECT encode(extensions.digest(coalesce(string_agg(
   format('%s|%s|%s',tg.tgname,tg.tgenabled,pg_get_triggerdef(tg.oid,true)),
   E'\n' ORDER BY tg.tgname),'∅'),'sha256'),'hex')
  FROM pg_trigger tg WHERE tg.tgrelid=o.oid AND NOT tg.tgisinternal) AS actual_triggers_sha
 FROM objects o
)
SELECT identifier, 'CATALOG_IDENTITY' AS component,
 CASE WHEN oid IS NULL THEN 'MISSING'
      WHEN actual_owner IS DISTINCT FROM owner OR actual_kind::text IS DISTINCT FROM relkind
        OR relrowsecurity IS DISTINCT FROM rls_enabled
        OR relforcerowsecurity IS DISTINCT FROM force_rls THEN 'DRIFT'
      ELSE 'OK' END AS finding
FROM actual
UNION ALL
SELECT identifier,'COLUMNS',
 CASE WHEN actual_columns=columns_count AND actual_cols_sha=columns_sha256 THEN 'OK' ELSE 'DRIFT' END FROM actual
UNION ALL
SELECT identifier,'CONSTRAINTS',
 CASE WHEN actual_constraints=constraints_count AND actual_constraints_sha=constraints_sha256 THEN 'OK' ELSE 'DRIFT' END FROM actual
UNION ALL
SELECT identifier,'INDEXES',
 CASE WHEN actual_indexes=indexes_count AND actual_indexes_sha=indexes_sha256 THEN 'OK' ELSE 'DRIFT' END FROM actual
UNION ALL
SELECT identifier,'POLICIES',
 CASE WHEN actual_policies=policies_count AND actual_policies_sha=policies_sha256 THEN 'OK' ELSE 'DRIFT' END FROM actual
UNION ALL
SELECT identifier,'TRIGGERS',
 CASE WHEN actual_triggers=triggers_count AND actual_triggers_sha=triggers_sha256 THEN 'OK' ELSE 'DRIFT' END FROM actual
UNION ALL
SELECT identifier,'ACL',
 CASE WHEN encode(extensions.digest(coalesce(relacl::text,'DEFAULT'),'sha256'),'hex')
           =raw_table_acl_sha256 AND
      has_table_privilege('anon',oid,'SELECT')=anon_select AND
      has_table_privilege('anon',oid,'INSERT')=anon_insert AND
      has_table_privilege('authenticated',oid,'SELECT')=auth_select AND
      has_table_privilege('authenticated',oid,'INSERT')=auth_insert AND
      has_table_privilege('service_role',oid,'SELECT')=service_read
 THEN 'OK' ELSE 'DRIFT' END FROM actual
ORDER BY identifier,component;