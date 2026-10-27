-- INMOJCO: read-only inventory for an authorized PRIVATE local backup.
-- Never copy file names, credentials, or object bytes into GitHub / chat.
-- Run in Supabase SQL Editor and save returned JSON privately as:
--   source-inventory.local.json
-- This is just a count snapshot, NOT a backup and NOT proof of remote completeness.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH bucket_counts AS (
  SELECT b.id AS bucket_id, count(o.id) AS object_count
  FROM storage.buckets b
  LEFT JOIN storage.objects o ON o.bucket_id=b.id
  GROUP BY b.id
)
SELECT jsonb_build_object(
  'project_ref', 'cuitgyqrjibgwuniapmk',
  'observed_at_utc',
    to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'buckets', coalesce(
    jsonb_agg(jsonb_build_object('id',bucket_id,'object_count',object_count) ORDER BY bucket_id),
    '[]'::jsonb)
) AS source_inventory_json
FROM bucket_counts;

COMMIT;