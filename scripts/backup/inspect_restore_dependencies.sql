-- Read-only diagnostic for an ISOLATED PostgreSQL 17 restore. Never certifies recovery.
-- Reports catalog prerequisites implicated by issue #214; no user rows are read.
WITH checks AS (
  SELECT 'auth.users id unique key' AS requirement,
         EXISTS (
           SELECT 1
           FROM pg_namespace n
           JOIN pg_class t ON t.relnamespace = n.oid
           JOIN pg_attribute a ON a.attrelid = t.oid
           JOIN pg_index i ON i.indrelid = t.oid
           WHERE n.nspname = 'auth'
             AND t.relname = 'users'
             AND a.attname = 'id'
             AND NOT a.attisdropped
             AND i.indisunique
             AND i.indisvalid
             AND i.indimmediate
             AND i.indnkeyatts = 1
             AND i.indpred IS NULL
             AND i.indexprs IS NULL
             AND i.indkey[0] = a.attnum
         ) AS ok
  UNION ALL
  SELECT 'private.can_read_portal_property(uuid,uuid)',
         to_regprocedure('private.can_read_portal_property(uuid,uuid)') IS NOT NULL
)
SELECT requirement, CASE WHEN ok THEN 'OK' ELSE 'FALTA' END AS result
FROM checks
ORDER BY requirement;


-- Informational restore health metrics; these totals alone do NOT certify
-- backup completeness or data integrity. Run only on an isolated restore.
-- An absent auth.users table yields zero references without raising SQL errors.
SELECT 'auth.users referencing FK constraints' AS requirement,
       count(*)::text AS result
FROM pg_constraint con
WHERE con.contype='f'
  AND con.confrelid=to_regclass('auth.users')
UNION ALL
SELECT 'unvalidated foreign key constraints',
       count(*)::text
FROM pg_constraint con
JOIN pg_class rel ON rel.oid=con.conrelid
JOIN pg_namespace ns ON ns.oid=rel.relnamespace
WHERE con.contype='f' AND NOT con.convalidated
  AND ns.nspname NOT IN ('pg_catalog','information_schema')
UNION ALL
SELECT 'invalid non-system indexes',
       count(*)::text
FROM pg_index ind
JOIN pg_class rel ON rel.oid=ind.indrelid
JOIN pg_namespace ns ON ns.oid=rel.relnamespace
WHERE NOT ind.indisvalid
  AND ns.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY requirement;
