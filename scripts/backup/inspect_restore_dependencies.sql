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
             AND i.indisimmediate
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
