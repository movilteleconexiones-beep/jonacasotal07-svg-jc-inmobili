-- INMOJCO: read-only Storage inventory with aggregate SHA-256 of object KEYS.
-- Run only in the real Supabase project cuitgyqrjibgwuniapmk.
-- Output does not include raw object names or file bytes. Treat the aggregate
-- fingerprint as private recovery metadata; never commit real inventory to Git.
-- This hashes object PATHS only, NOT the remote bytes or their restorability.
-- The snapshot MUST be taken alongside the authorized download operation.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH bucket_counts AS (
  SELECT b.id AS bucket_id, count(o.id) AS object_count
  FROM storage.buckets b
  LEFT JOIN storage.objects o ON o.bucket_id = b.id
  GROUP BY b.id
),
key_bytes AS (
  -- Each key is UTF-8 hex, so the '|' delimiter cannot collide with a key.
  -- Binary/C collation ensures the exact same ordering as Node.js hex sort.
  SELECT encode(convert_to(o.bucket_id || '/' || o.name, 'UTF8'), 'hex') AS key_hex
  FROM storage.objects o
),
fingerprint AS (
  SELECT encode(sha256(convert_to(coalesce(string_agg(key_hex, '|' ORDER BY key_hex COLLATE "C"), ''), 'UTF8')), 'hex')
    AS object_keys_sha256
  FROM key_bytes
)
SELECT jsonb_build_object(
  'format_version', 2,
  'project_ref', 'cuitgyqrjibgwuniapmk',
  'observed_at_utc',
    to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'object_keys_sha256', (SELECT object_keys_sha256 FROM fingerprint),
  'buckets', coalesce(
    jsonb_agg(jsonb_build_object('id', bucket_id, 'object_count', object_count) ORDER BY bucket_id),
    '[]'::jsonb
  )
) AS source_inventory_json
FROM bucket_counts;

COMMIT;
