-- PostgreSQL 17 isolated deal deletion fixture, never references real user data.
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('jco_test.actor',true),'')::uuid;
$$;
CREATE FUNCTION public.has_org_permission(org uuid,key text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT key='deals.close' AND
        org='11111111-1111-4111-8111-111111111111'::uuid
        AND auth.uid()='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid(),public.has_org_permission(uuid,text) TO authenticated;
CREATE TABLE public.organization_members(
 id uuid primary key,organization_id uuid not null,user_id uuid not null,status text not null
);
CREATE TABLE public.roles(
 id uuid primary key,organization_id uuid not null,key text not null,active boolean not null
);
CREATE TABLE public.member_roles(
 organization_member_id uuid,role_id uuid,primary key(organization_member_id,role_id)
);
CREATE TABLE public.deals(
 id uuid primary key,organization_id uuid not null,contact_id uuid not null,
 property_id uuid not null,operation_type text not null,stage text not null
);
CREATE TABLE public.contacts(
 id uuid primary key,organization_id uuid not null,UNIQUE(organization_id,id)
);
CREATE TABLE public.properties(
 id uuid primary key,organization_id uuid not null,UNIQUE(organization_id,id)
);
CREATE TABLE public.activities(
 id uuid primary key,deal_id uuid REFERENCES public.deals(id) ON DELETE CASCADE
);
CREATE TABLE public.commissions(
 id uuid primary key,deal_id uuid REFERENCES public.deals(id) ON DELETE CASCADE
);
CREATE TABLE public.audit_log(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid,actor_user_id uuid,action text,entity_type text,
 entity_id uuid,metadata jsonb,created_at timestamptz default now()
);
GRANT SELECT, UPDATE, DELETE ON public.deals TO anon,authenticated;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_deal_access ON public.deals FOR ALL TO authenticated
  USING (true) WITH CHECK(true);
INSERT INTO public.organization_members VALUES
('b1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ACTIVE'),
('b2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACTIVE'),
('b3333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','ACTIVE');
INSERT INTO public.roles VALUES
('c1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','ADMIN',true),
('c2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','AGENT',true),
('c3333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','ADMIN',true);
INSERT INTO public.member_roles VALUES
('b1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111'),
('b2222222-2222-4222-8222-222222222222','c2222222-2222-4222-8222-222222222222'),
('b3333333-3333-4333-8333-333333333333','c3333333-3333-4333-8333-333333333333');
INSERT INTO public.deals VALUES
('d1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','e1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','RENT','INTEREST'),
('d2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','e2222222-2222-4222-8222-222222222222','f2222222-2222-4222-8222-222222222222','SALE','OFFER'),
('d3333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','e3333333-3333-4333-8333-333333333333','f3333333-3333-4333-8333-333333333333','SALE','WON'),
('d4444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','e4444444-4444-4444-8444-444444444444','f4444444-4444-4444-8444-444444444444','RENT','INTEREST'),
('d5555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','e5555555-5555-4555-8555-555555555555','f5555555-5555-4555-8555-555555555555','SALE','NEGOTIATION');
INSERT INTO public.contacts(id,organization_id) SELECT contact_id,organization_id FROM public.deals;
INSERT INTO public.properties(id,organization_id) SELECT property_id,organization_id FROM public.deals;
INSERT INTO public.activities VALUES
('a2222222-2222-4222-8222-222222222222','d2222222-2222-4222-8222-222222222222');
INSERT INTO public.commissions VALUES
('a5555555-5555-4555-8555-555555555555','d5555555-5555-4555-8555-555555555555');
