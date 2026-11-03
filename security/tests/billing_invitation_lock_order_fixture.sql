-- PostgreSQL 17 disposable data ONLY. Installs after billing_order_serialization_fixture
-- and billing_authorization_serialization (both isolated tests).
ALTER TABLE public.organization_members
 ADD COLUMN joined_at timestamptz,
 ADD CONSTRAINT invitation_fixture_member_unique UNIQUE(organization_id,user_id);
CREATE TABLE auth.users (
 id uuid PRIMARY KEY, email text NOT NULL, email_confirmed_at timestamptz
);
CREATE TABLE public.organization_invitations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 email text NOT NULL,status text NOT NULL,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL,accepted_by uuid,accepted_at timestamptz
);
CREATE TABLE public.invitation_roles (
 invitation_id uuid NOT NULL REFERENCES public.organization_invitations(id),
 role_id uuid NOT NULL REFERENCES public.roles(id),
 PRIMARY KEY(invitation_id,role_id)
);
INSERT INTO auth.users VALUES
 ('99999999-aaaa-4aaa-8aaa-999999999999','invited@example.test',now()),
 ('99999999-bbbb-4bbb-8bbb-999999999999','unconfirmed@example.test',NULL);
-- Both active organizations invite the same verified person. One invitation
-- refers to an inactive role and must remain pending without occupying a seat.
INSERT INTO public.roles(id,organization_id,active)
 VALUES('ffffffff-aaaa-4aaa-8aaa-ffffffffffff',
  '11111111-1111-4111-8111-111111111111',false);
INSERT INTO public.organization_invitations VALUES
 ('11111111-0000-4000-8000-000000000111',
  '11111111-1111-4111-8111-111111111111','invited@example.test',
  'PENDING',now()+interval '2 days',now()-interval '20 minutes',NULL,NULL),
 ('22222222-0000-4000-8000-000000000222',
  '22222222-2222-4222-8222-222222222222','invited@example.test',
  'PENDING',now()+interval '2 days',now()-interval '10 minutes',NULL,NULL),
 ('11111111-0000-4000-8000-000000000333',
  '11111111-1111-4111-8111-111111111111','invited@example.test',
  'PENDING',now()+interval '2 days',now()-interval '5 minutes',NULL,NULL);
INSERT INTO public.invitation_roles VALUES
 ('11111111-0000-4000-8000-000000000111',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
 ('22222222-0000-4000-8000-000000000222',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
 ('11111111-0000-4000-8000-000000000333',
  'ffffffff-aaaa-4aaa-8aaa-ffffffffffff');

REVOKE ALL ON public.organization_invitations,public.invitation_roles
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON auth.users FROM PUBLIC,anon,authenticated;

-- Baseline setup occurs with table owner postgres; client only executes RPC.
