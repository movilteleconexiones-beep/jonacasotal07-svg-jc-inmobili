-- Supabase grants EXECUTE on newly created functions to anon by default.
-- The original function validates ownership but must not be callable anonymously.
BEGIN;
REVOKE ALL ON FUNCTION public.set_organization_public_slug(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_public_slug(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.set_organization_public_slug(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.set_organization_public_slug(uuid,text) TO authenticated;
COMMIT;
