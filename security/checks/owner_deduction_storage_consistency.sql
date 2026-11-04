-- INMOJCO | READ-ONLY, aggregate-only PDF integrity check.
-- Safe for authorized read-only SQL inspection; NO DELETE / UPDATE / DDL.
-- Report Storage-vs-documents drift for private owner deduction evidence.
-- Only the organization-documents bucket and owner-deductions prefix are in scope.
-- Never log file paths, names, user IDs or customer records.
WITH objects_scope AS (
  SELECT name
  FROM storage.objects
  WHERE bucket_id = 'organization-documents'
    AND name LIKE '%/owner-deductions/%'
), documents_scope AS (
  SELECT organization_id, entity_id, entity_type, document_type,
         storage_path, uploaded_by
  FROM public.documents
  WHERE storage_bucket = 'organization-documents'
    AND storage_path LIKE '%/owner-deductions/%'
), documents_verified AS (
  SELECT d.*,
    d.entity_type = 'GENERAL'
      AND d.document_type = 'INVOICE'
      AND d.entity_id IS NOT NULL
      AND d.uploaded_by IS NOT NULL
      AND d.storage_path ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/owner-deductions/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/(invoice|payment)/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[.]pdf$'
      AND split_part(d.storage_path, '/', 1) = d.organization_id::text
      AND split_part(d.storage_path, '/', 3) = d.entity_id::text AS valid_link
  FROM documents_scope d
)
SELECT
  (SELECT count(*) FROM objects_scope) AS storage_objects,
  (SELECT count(*) FROM documents_scope) AS document_rows,
  (SELECT count(*) FROM objects_scope o
     WHERE NOT EXISTS (SELECT 1 FROM documents_verified d
       WHERE d.storage_path=o.name AND d.valid_link)) AS orphan_storage_objects,
  (SELECT count(*) FROM documents_verified d
     WHERE NOT EXISTS (SELECT 1 FROM objects_scope o
       WHERE o.name=d.storage_path)) AS missing_storage_objects,
  (SELECT count(*) FROM documents_verified WHERE NOT valid_link) AS invalid_document_links,
  (SELECT count(*) FROM (
    SELECT storage_path FROM documents_scope GROUP BY storage_path HAVING count(*)>1
  ) duplicates) AS duplicate_path_groups,
  (SELECT count(*) FROM objects_scope o
     WHERE NOT (o.name ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/owner-deductions/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/(invoice|payment)/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[.]pdf$')
  ) AS invalid_storage_paths;
