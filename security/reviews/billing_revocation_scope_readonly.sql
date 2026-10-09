-- READ ONLY: run against reviewed staging before designing permission-revocation locks.
-- Role sharing can invalidate naive per-organization serialization.
SELECT r.id AS role_id,r.organization_id AS role_organization_id,
       count(DISTINCT m.organization_id) AS member_organization_count,
       count(DISTINCT m.organization_id) FILTER
         (WHERE m.organization_id IS DISTINCT FROM r.organization_id) AS cross_organization_members
FROM public.roles r
JOIN public.member_roles mr ON mr.role_id=r.id
JOIN public.organization_members m ON m.id=mr.organization_member_id
GROUP BY r.id,r.organization_id
HAVING count(DISTINCT m.organization_id) FILTER
         (WHERE m.organization_id IS DISTINCT FROM r.organization_id)>0;

-- Billing permission assignments: read-only evidence; no grants are made.
SELECT p.key,count(DISTINCT rp.role_id) AS roles_with_grant,
       count(DISTINCT mp.organization_member_id) FILTER (WHERE mp.effect='ALLOW') AS explicit_allows,
       count(DISTINCT mp.organization_member_id) FILTER (WHERE mp.effect='DENY') AS explicit_denies
FROM public.permissions p
LEFT JOIN public.role_permissions rp ON rp.permission_id=p.id
LEFT JOIN public.member_permissions mp ON mp.permission_id=p.id
WHERE p.key='billing.manage'
GROUP BY p.key;

-- Authorization-sensitive table triggers to audit before changing write behavior.
SELECT c.relname AS table_name,t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('organization_members','member_permissions','member_roles','role_permissions','roles','organizations')
AND NOT t.tgisinternal
ORDER BY c.relname,t.tgname;
