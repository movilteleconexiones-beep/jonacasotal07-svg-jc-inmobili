-- One-time, idempotent repair for a legacy tenant bootstrap.
-- Scope: Sistema Inmobiliario JCO only; ADMIN and ORGANIZATION_OWNER.
-- Existing tenant plan already permits all ten keys; no elevated access
-- is added to coordinators, agents, clients, or any other organization.
-- Run only after read-only preflight and a rollback rehearsal.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $repair$
DECLARE
  target_org uuid;
  keys text[] := ARRAY[
    'leases.create','leases.edit','leases.view',
    'maintenance.create','maintenance.edit','maintenance.view',
    'owner_statements.create','owner_statements.view',
    'rent_payments.create','rent_payments.view'
  ];
  roles_found int;
  matched_keys int;
  granted_by_plan int;
  added int;
  after_count int;
BEGIN
  IF (SELECT COUNT(*) FROM public.organizations
      WHERE name='Sistema Inmobiliario JCO' AND status='ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active JCO test organization';
  END IF;
  SELECT id INTO target_org FROM public.organizations
    WHERE name='Sistema Inmobiliario JCO' AND status='ACTIVE';

  SELECT COUNT(*) INTO roles_found FROM public.roles
    WHERE organization_id=target_org
      AND key IN ('ADMIN','ORGANIZATION_OWNER')
      AND is_system_role AND active;
  IF roles_found <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two active system administrative roles, found %',roles_found;
  END IF;

  SELECT COUNT(*) INTO matched_keys FROM public.permissions WHERE key=ANY(keys);
  SELECT COUNT(*) INTO granted_by_plan FROM unnest(keys) p(key)
    JOIN public.organization_billing_access b
      ON b.organization_id=target_org AND p.key=ANY(b.allowed_permissions)
      AND b.is_test;
  IF matched_keys<>10 OR granted_by_plan<>10 THEN
    RAISE EXCEPTION 'Catalog or billing entitlements mismatch; no changes made';
  END IF;

  INSERT INTO public.role_permissions(role_id,permission_id)
  SELECT r.id,p.id
  FROM public.roles r CROSS JOIN public.permissions p
  WHERE r.organization_id=target_org
    AND r.key IN ('ADMIN','ORGANIZATION_OWNER')
    AND r.is_system_role AND r.active AND p.key=ANY(keys)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;

  SELECT COUNT(*) INTO after_count FROM public.role_permissions rp
  JOIN public.roles r ON r.id=rp.role_id
  JOIN public.permissions p ON p.id=rp.permission_id
  WHERE r.organization_id=target_org
    AND r.key IN ('ADMIN','ORGANIZATION_OWNER') AND p.key=ANY(keys);
  IF after_count<>20 THEN
    RAISE EXCEPTION 'Expected 20 role-permission links; got %',after_count;
  END IF;

  IF added>0 THEN
    INSERT INTO public.audit_log(organization_id,action,entity_type,entity_id,metadata)
    VALUES(target_org,'security.legacy_admin_permissions_repaired','organization',target_org,
      jsonb_build_object(
        'scope','JCO administrative system roles only',
        'roles', ARRAY['ADMIN','ORGANIZATION_OWNER'],
        'permission_keys',keys,
        'added_links',added,
        'source','audited 2026-10-29 production-readiness repair'
      ));
  END IF;
  RAISE NOTICE 'JCO permission links added: %, resulting links: %',added,after_count;
END $repair$;
COMMIT;
SELECT r.key AS administrative_role,COUNT(rp.permission_id)::integer AS permission_count
FROM public.roles r LEFT JOIN public.role_permissions rp ON rp.role_id=r.id
JOIN public.organizations o ON o.id=r.organization_id
WHERE o.name='Sistema Inmobiliario JCO'
AND r.key IN ('ADMIN','ORGANIZATION_OWNER')
GROUP BY r.key ORDER BY r.key;
