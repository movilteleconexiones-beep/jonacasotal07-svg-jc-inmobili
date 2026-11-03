-- Execute only in a disposable PostgreSQL 17 CI database with synthetic data.
DO $checks$
BEGIN
 IF has_table_privilege('anon','public.properties','SELECT')
    OR has_table_privilege('authenticated','public.properties','SELECT')
    OR has_table_privilege('anon','public.organizations','SELECT') THEN
   RAISE EXCEPTION 'Public API role has direct access to tenant inventory';
 END IF;
 IF NOT has_function_privilege('anon','public.tenant_public_catalog(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.tenant_public_catalog(text)','EXECUTE') THEN
   RAISE EXCEPTION 'Catalog RPC lost intended public access';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(
    (SELECT coalesce(proacl,pg_catalog.acldefault('f',proowner))
     FROM pg_catalog.pg_proc WHERE oid='public.tenant_public_catalog(text)'::regprocedure)
    ) acl WHERE grantee=0 AND privilege_type='EXECUTE') THEN
   RAISE EXCEPTION 'Catalog RPC exposes implicit PUBLIC execution';
 END IF;
END $checks$;
BEGIN;
SET LOCAL ROLE anon;
DO $checks$
DECLARE catalog jsonb; listing jsonb; beta jsonb;
BEGIN
 catalog := public.tenant_public_catalog('alpha');
 beta := public.tenant_public_catalog('beta');
 IF catalog IS NULL OR catalog->>'company_name' <> 'Alpha Public'
    OR beta->>'company_name' <> 'Beta Public' THEN
   RAISE EXCEPTION 'Anonymous tenant branding isolation failed';
 END IF;
 listing := catalog->'properties';
 IF jsonb_typeof(listing) <> 'array' OR jsonb_array_length(listing) <> 100 THEN
   RAISE EXCEPTION 'Anonymous listing cap or JSON shape failed';
 END IF;
 IF listing->0->>'title' <> 'Featured Alpha' THEN
   RAISE EXCEPTION 'Featured listing ordering failed';
 END IF;
 IF EXISTS (
   SELECT 1 FROM jsonb_array_elements(listing) p
   WHERE p->>'id' IN (
     'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
     'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
     'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
   ) OR p ? 'owner_phone' OR p ? 'internal_notes'
 ) OR catalog::text LIKE '%PRIVATE-OWNER-PHONE%'
   OR catalog::text LIKE '%PRIVATE-INTERNAL-NOTES%' THEN
   RAISE EXCEPTION 'Anonymous listing exposed another tenant, unavailable item or private field';
 END IF;
 IF public.tenant_public_catalog('inactive') IS NOT NULL
    OR public.tenant_public_catalog('disabled') IS NOT NULL
    OR public.tenant_public_catalog('unpaid') IS NOT NULL
    OR public.tenant_public_catalog('missing') IS NOT NULL THEN
   RAISE EXCEPTION 'Catalog bypassed active, website or payment gate';
 END IF;
END $checks$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
DO $checks$
DECLARE catalog jsonb;
BEGIN
 catalog := public.tenant_public_catalog('alpha');
 IF catalog->>'company_name' <> 'Alpha Public'
    OR jsonb_array_length(catalog->'properties') <> 100 THEN
   RAISE EXCEPTION 'Authenticated public catalog regression';
 END IF;
 IF public.tenant_public_catalog('unpaid') IS NOT NULL THEN
   RAISE EXCEPTION 'Authenticated catalog bypassed payment guard';
 END IF;
END $checks$;
ROLLBACK;
SELECT 'PASS: catalog SQL runtime, anon/auth isolation, availability, 100-cap, hidden fields, inactive/website/payment gates' AS result;
