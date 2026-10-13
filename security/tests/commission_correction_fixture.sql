-- PostgreSQL 17 sandbox: all data is synthetic, no production records.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('jco_test.actor',true),'')::uuid;
$$;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.organization_members(id uuid PRIMARY KEY,organization_id uuid,user_id uuid,status text);
CREATE TABLE public.roles(id uuid PRIMARY KEY,organization_id uuid,key text,active boolean);
CREATE TABLE public.member_roles(organization_member_id uuid,role_id uuid,PRIMARY KEY(organization_member_id,role_id));
CREATE TABLE public.deals(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
CREATE TABLE public.commissions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,deal_id uuid NOT NULL REFERENCES public.deals(id),
 beneficiary_user_id uuid,commission_type text NOT NULL DEFAULT 'AGENT',percentage numeric,amount numeric,
 currency text NOT NULL DEFAULT 'COP',status text NOT NULL DEFAULT 'PENDING',due_date date,
 paid_at timestamptz,notes text,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,actor_user_id uuid,
 action text NOT NULL,entity_type text,entity_id uuid,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.has_org_permission(target_org uuid, permission_key text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT target_org='11111111-1111-4111-8111-111111111111'::uuid
 AND auth.uid() IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)
 AND permission_key IN ('commissions.view','commissions.edit','commissions.create');
$$;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid,text) TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.commissions TO authenticated,anon;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissive_legacy_commissions ON public.commissions FOR ALL TO authenticated
 USING (true) WITH CHECK (true);
INSERT INTO public.organization_members VALUES
 ('11111111-aaaa-4aaa-8aaa-111111111111','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ACTIVE'),
 ('22222222-bbbb-4bbb-8bbb-222222222222','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACTIVE'),
 ('33333333-cccc-4ccc-8ccc-333333333333','22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','ACTIVE');
INSERT INTO public.roles VALUES
 ('11111111-aaaa-4aaa-8aaa-111111111112','11111111-1111-4111-8111-111111111111','ADMIN',true),
 ('22222222-bbbb-4bbb-8bbb-222222222223','11111111-1111-4111-8111-111111111111','AGENT',true),
 ('33333333-cccc-4ccc-8ccc-333333333334','22222222-2222-4222-8222-222222222222','ADMIN',true);
INSERT INTO public.member_roles VALUES
 ('11111111-aaaa-4aaa-8aaa-111111111111','11111111-aaaa-4aaa-8aaa-111111111112'),
 ('22222222-bbbb-4bbb-8bbb-222222222222','22222222-bbbb-4bbb-8bbb-222222222223'),
 ('33333333-cccc-4ccc-8ccc-333333333333','33333333-cccc-4ccc-8ccc-333333333334');
INSERT INTO public.deals VALUES
 ('11111111-2222-4333-8444-111111111111','11111111-1111-4111-8111-111111111111'),
 ('22222222-3333-4444-8555-222222222222','22222222-2222-4222-8222-222222222222');
INSERT INTO public.commissions(id,organization_id,deal_id,beneficiary_user_id,commission_type,percentage,amount,status,paid_at,created_by) VALUES
 ('11111111-1111-4111-8111-000000000001','11111111-1111-4111-8111-111111111111','11111111-2222-4333-8444-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AGENT',10,180000,'PENDING',null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('11111111-1111-4111-8111-000000000002','11111111-1111-4111-8111-111111111111','11111111-2222-4333-8444-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AGENT',10,180000,'PAYABLE',null,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('11111111-1111-4111-8111-000000000003','11111111-1111-4111-8111-111111111111','11111111-2222-4333-8444-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AGENT',10,1800000,'PAID','2026-10-12T19:50:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('22222222-2222-4222-8222-000000000001','22222222-2222-4222-8222-222222222222','22222222-3333-4444-8555-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','AGENT',10,180000,'PENDING',null,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
