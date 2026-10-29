-- Dedicated PostgreSQL 17 CI fixture ONLY. Never run against live Supabase.
-- Exercised with the real owner payout ledger migration, but synthetic users.
CREATE SCHEMA auth;
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $role$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), -- tenant A manager
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), -- tenant A external client
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'); -- tenant B manager
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.owner_statements (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('DRAFT','GENERATED','PAID')),
 net_amount numeric(15,2) NOT NULL CHECK(net_amount>=0),
 UNIQUE(organization_id,id)
);
ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.owner_statements TO authenticated;

-- Stub only the two authorization helpers; do not replace production functions.
-- Manager A is authorized only for A; manager B only for B.
CREATE FUNCTION public.commission_is_manager(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
 SELECT ((SELECT auth.uid())='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
          AND org='11111111-1111-4111-8111-111111111111'::uuid)
     OR ((SELECT auth.uid())='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
          AND org='22222222-2222-4222-8222-222222222222'::uuid);
$body$;
CREATE FUNCTION public.has_org_permission(org uuid,permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
 SELECT permission_key IN ('owner_statements.view','owner_statements.create')
    AND public.commission_is_manager(org);
$body$;
GRANT EXECUTE ON FUNCTION public.commission_is_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid,text) TO authenticated;

INSERT INTO public.owner_statements(id,organization_id,status,net_amount) VALUES
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','GENERATED',1390000),
 ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','GENERATED',500000),
 ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','DRAFT',200000);

CREATE FUNCTION public.test_assert(ok boolean,description text)
RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
 IF ok IS DISTINCT FROM TRUE THEN
   RAISE EXCEPTION 'Owner payout regression failed: %',description;
 END IF;
END $body$;
GRANT EXECUTE ON FUNCTION public.test_assert(boolean,text) TO authenticated;