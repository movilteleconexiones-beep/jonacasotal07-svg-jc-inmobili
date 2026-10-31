-- Isolated PostgreSQL 17 test schema; never run against real Supabase.
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$roles$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY,
 email text,
 email_confirmed_at timestamptz
);
CREATE TABLE public.organization_invitations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 email text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING',
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 accepted_by uuid,
 accepted_at timestamptz
);
CREATE TABLE public.roles(
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,
 key text NOT NULL
);
CREATE TABLE public.organization_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 user_id uuid NOT NULL,
 status text NOT NULL,
 joined_at timestamptz,
 UNIQUE(organization_id,user_id)
);
CREATE TABLE public.invitation_roles(
 invitation_id uuid NOT NULL,
 role_id uuid NOT NULL,
 PRIMARY KEY(invitation_id,role_id)
);
CREATE TABLE public.member_roles(
 organization_member_id uuid NOT NULL,
 role_id uuid NOT NULL,
 PRIMARY KEY(organization_member_id,role_id)
);

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('10000000-0000-4000-8000-000000000001','victim@agency.test',NULL),
 ('10000000-0000-4000-8000-000000000002','attacker@other.test',now()),
 ('10000000-0000-4000-8000-000000000003','victim@agency.test',now()),
 ('10000000-0000-4000-8000-000000000004','other@agency.test',now());

INSERT INTO public.roles(id,organization_id,active,key) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',true,'ADMIN'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',true,'AGENT'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',false,'DISABLED');
INSERT INTO public.organization_invitations(id,organization_id,email,status,expires_at) VALUES
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','  VICTIM@AGENCY.TEST  ','PENDING',now()+interval '1 day'),
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','victim@agency.test','PENDING',now()-interval '1 day'),
 ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','victim@agency.test','PENDING',now()+interval '1 day'),
 ('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','victim@agency.test','PENDING',now()+interval '1 day'),
 ('40000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002','other@agency.test','PENDING',now()+interval '1 day');
INSERT INTO public.invitation_roles(invitation_id,role_id) VALUES
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
 ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001'),
 ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002'),
 ('40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000002');
