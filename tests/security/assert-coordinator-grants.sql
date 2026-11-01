DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id WHERE r.key='MANAGER') <> 2 THEN
    RAISE EXCEPTION 'MANAGER must have exactly two financial grants';
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id WHERE r.key='AGENT') THEN
    RAISE EXCEPTION 'AGENT must not have rent payment grants';
  END IF;
END
$assert$;
