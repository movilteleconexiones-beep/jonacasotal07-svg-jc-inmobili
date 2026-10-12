-- Isolated PostgreSQL 17 only; all UUIDs are synthetic.
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,actor_user_id uuid,
  action text NOT NULL,entity_type text,entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_members(
 id uuid PRIMARY KEY,organization_id uuid,user_id uuid,status text NOT NULL
);
CREATE TABLE public.roles(
 id uuid PRIMARY KEY,organization_id uuid,key text,active boolean DEFAULT true
);
CREATE TABLE public.member_roles(
 organization_member_id uuid NOT NULL,role_id uuid NOT NULL,
 PRIMARY KEY(organization_member_id,role_id)
);
INSERT INTO public.organization_members VALUES
 ('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','10101010-1010-4010-8010-101010101010','ACTIVE'),
 ('11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','20202020-2020-4020-8020-202020202020','ACTIVE'),
 ('22222222-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','30303030-3030-4030-8030-303030303030','ACTIVE');
INSERT INTO public.roles VALUES
 ('22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','ADMIN',true),
 ('22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','AGENT',true),
 ('22222222-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','ADMIN',true);
INSERT INTO public.member_roles VALUES
 ('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('22222222-cccc-4ccc-8ccc-cccccccccccc','22222222-cccc-4ccc-8ccc-cccccccccccc');

-- A single paid rent and draft statement with an intentionally stale snapshot.
INSERT INTO public.rent_payments(
 id,organization_id,lease_id,period_month,expected_amount,paid_amount,status
) VALUES (
 'bbbbbbbb-0000-4000-8000-000000000001',
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','2026-10-01',
 1600000,1600000,'PAID'
);
INSERT INTO public.owner_statements(
 id,organization_id,lease_id,owner_id,period_month,
 gross_income,commission_amount,tax_amount,other_deductions,net_amount,status
) VALUES (
 'cccccccc-0000-4000-8000-000000000001',
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-10-01',1500000,160000,30000,0,1310000,'DRAFT'
),(
 'cccccccc-0000-4000-8000-000000000002',
 '22222222-2222-4222-8222-222222222222',
 '44444444-4444-4444-8444-444444444444',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 '2026-10-01',900000,0,0,0,900000,'DRAFT'
),(
 'cccccccc-0000-4000-8000-000000000003',
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-01',0,0,0,0,0,'DRAFT'
);
SELECT set_config('jco_test.organization','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('jco_test.actor','10101010-1010-4010-8010-101010101010',false);
SET ROLE authenticated;
INSERT INTO public.owner_statement_deductions
 (organization_id,statement_id,charge_date,category,responsible_party,amount,description,support_reference)
VALUES(
 '11111111-1111-4111-8111-111111111111',
 'cccccccc-0000-4000-8000-000000000001',
 '2026-10-01','MAINTENANCE','OWNER',120000,
 'Repairs documented by the landlord','REHEARSAL'
);
UPDATE public.owner_statement_deductions SET status='APPROVED'
 WHERE statement_id='cccccccc-0000-4000-8000-000000000001';
RESET ROLE;
