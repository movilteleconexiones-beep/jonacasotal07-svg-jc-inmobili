-- Disposable PostgreSQL 17 only, never hosted Supabase.
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
 THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO authenticated;
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
CREATE TABLE public.contacts(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 first_name text NOT NULL,
 last_name text,
 email text,
 phone text,
 source text NOT NULL DEFAULT 'MANUAL'
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_tenant_insert ON public.contacts FOR INSERT TO authenticated
 WITH CHECK (organization_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY contacts_tenant_select ON public.contacts FOR SELECT TO authenticated
 USING (organization_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY contacts_tenant_update ON public.contacts FOR UPDATE TO authenticated
 USING (organization_id=current_setting('app.tenant_id',true)::uuid)
 WITH CHECK (organization_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE ON public.contacts TO authenticated;
-- No anon access. No RLS bypass; the uniqueness index must arbitrate
-- two independent clients, even if each had independently passed a UI preflight.
