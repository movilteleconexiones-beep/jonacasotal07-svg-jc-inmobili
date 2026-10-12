-- Artificial fixture: two organizations, not related to any customer in Supabase.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$roles$;
CREATE SCHEMA auth;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('jco_test.actor', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE FUNCTION public.has_org_permission(org_id uuid, permission_key text)
RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT org_id = NULLIF(current_setting('jco_test.organization', true), '')::uuid
     AND permission_key IN ('owner_statements.view','owner_statements.create')
$$;

CREATE TABLE public.owner_statements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','GENERATED','PAID'))
);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.owner_statements TO authenticated;
INSERT INTO public.owner_statements (id, organization_id, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','DRAFT'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','DRAFT'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','DRAFT');

SET jco_test.actor = '99999999-9999-4999-8999-999999999999';
SET jco_test.organization = '11111111-1111-4111-8111-111111111111';
