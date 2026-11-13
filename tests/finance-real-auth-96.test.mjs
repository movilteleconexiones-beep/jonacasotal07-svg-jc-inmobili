// #96 — REAL Supabase Auth / PostgREST / private Storage acceptance probe.
// Opt-in only. Does not create users, receipts, bank payouts or documents.
// Never run against production; no secrets, JWTs, emails or PDF contents are logged.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const CLONE_REF = 'zjgstfgiirgjssnihaam';
const DENY = '42501';
// admin_decide_owner_payout_review validates note length (15..500)
// after authorization and BEFORE testing whether the review exists.
const VALID_REVIEW_NOTE = 'Autorizacion de prueba no persistente';
const MISSING = '00000000-0000-4000-8000-000000000111';
const ROLES = [
  {name:'ORGANIZATION_OWNER', env:'OWNER', privileged:true},
  {name:'ADMIN', env:'ADMIN', privileged:true},
  {name:'MANAGER', env:'MANAGER', privileged:false},
  {name:'AGENT', env:'AGENT', privileged:false},
  {name:'CLIENT', env:'CLIENT', privileged:false},
];

function required(name) {
  const value = process.env[name];
  assert.ok(value && value.trim(), 'Missing protected QA configuration: ' + name);
  return value.trim();
}

function uuid(value, field) {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, field + ' must be UUID');
  return value;
}

function expectedRpcCases(org, other, privileged) {
  return [
    ['issue', 'admin_issue_owner_statement',
      {p_statement_id:MISSING, p_organization_id:org}, privileged ? 'P0002' : DENY],
    ['payout', 'admin_record_owner_payout',
      {p_statement_id:MISSING, p_organization_id:org, p_amount:1, p_paid_on:'2026-11-13',
       p_payment_method:'TRANSFER', p_payment_reference:'QA-NO-WRITE',
       p_evidence_reference:'QA-NO-WRITE'}, privileged ? 'P0002' : DENY],
    ['review', 'admin_decide_owner_payout_review',
      {p_organization_id:org, p_review_id:MISSING, p_decision:'RESOLVED',
       p_note:VALID_REVIEW_NOTE}, privileged ? 'P0002' : DENY],
    ['receipt', 'record_tenant_rent_receipt',
      {target_org:org, target_payment:MISSING, receipt_amount:1,
       receipt_method:'CASH', receipt_reference:'QA-NO-WRITE',
       request_key:'00000000-0000-4000-8000-000000000112'},
       privileged ? '23514' : DENY],
    ['other tenant', 'admin_issue_owner_statement',
      {p_statement_id:MISSING, p_organization_id:other}, DENY],
  ];
}

function checkError(error, code, label) {
  assert.ok(error, label + ': expected a refusal or missing-record error');
  assert.equal(error.code, code, label + ': unexpected PostgREST SQLSTATE');
}

const enabled = process.env.JCO_QA96_RUN_REAL_AUTH === '1';
test('#96 real Auth: five separate JWT sessions, 25 RPC decisions and private receipt PDF isolation',
  {skip: enabled ? false : 'QA gate intentionally disabled; CI must not claim live-session certification'},
  async t => {
    const endpoint = new URL(required('JCO_QA96_SUPABASE_URL'));
    assert.equal(endpoint.protocol, 'https:');
    assert.equal(endpoint.origin, 'https://' + CLONE_REF + '.supabase.co',
      'CLONE ONLY — refuse production and unrelated projects');
    const key = required('JCO_QA96_PUBLISHABLE_KEY');
    const org = uuid(required('JCO_QA96_TEST_ORG_ID'), 'test org');
    const other = uuid(required('JCO_QA96_OTHER_ORG_ID'), 'other org');
    assert.notEqual(org, other, 'The tenant boundary must be meaningful');
    const receipt = required('JCO_QA96_PRIVATE_PDF_PATH');
    const foreignReceipt = required('JCO_QA96_OTHER_PRIVATE_PDF_PATH');
    assert.ok(receipt.startsWith(org + '/') && receipt.endsWith('/comprobante.pdf'),
      'Test receipt must be an actual PDF linked to the QA organization');
    assert.ok(foreignReceipt.startsWith(other + '/') && foreignReceipt.endsWith('/comprobante.pdf'),
      'Other-tenant receipt must be an actual QA PDF');
    assert.notEqual(receipt, foreignReceipt);

    const { createClient } = await import('@supabase/supabase-js');
    const clients = new Map();
    const userIds = new Set();
    const idsByRole = new Map();
    const signatures = new Set();
    try {
      // Each client owns its own non-persistent Auth session and access token.
      for (const role of ROLES) {
        const client = createClient(endpoint.origin, key, {
          auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false},
        });
        clients.set(role.name, client);
        const email = required('JCO_QA96_' + role.env + '_EMAIL');
        const password = required('JCO_QA96_' + role.env + '_PASSWORD');
        const {data, error} = await client.auth.signInWithPassword({email,password});
        assert.ok(!error && data?.session?.access_token && data?.user?.id,
          'Real Auth login failed for ' + role.name);
        const {data:verified, error:verificationError} =
          await client.auth.getUser(data.session.access_token);
        assert.ok(!verificationError && verified?.user?.id === data.user.id,
          'Auth server did not independently verify ' + role.name);
        assert.ok(!userIds.has(data.user.id), 'Role identities are not independent');
        userIds.add(data.user.id);
        idsByRole.set(role.name,data.user.id);
        signatures.add(data.session.access_token);
      }
      assert.equal(userIds.size, 5, 'Five distinct Auth identities are compulsory');
      assert.equal(signatures.size, 5, 'Sessions must have distinct JWTs');

      // Server-side read-only fixture attestation. Never send this QA-only
      // secret key to the web browser or expose it in logs.
      const secret = required('JCO_QA96_SECRET_KEY');
      const auditor = createClient(endpoint.origin,secret,
        {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const {data:billing,error:billingError} = await auditor
        .from('organization_billing_access').select('is_test')
        .eq('organization_id',org).single();
      assert.ok(!billingError && billing?.is_test === true,
        'Refuse any organization that is not an explicitly marked test tenant');
      const {data:foreignBilling,error:foreignBillingError} = await auditor
        .from('organization_billing_access').select('is_test')
        .eq('organization_id',other).single();
      assert.ok(!foreignBillingError && foreignBilling?.is_test === true,
        'Refuse real foreign tenants; both organizations must be QA-only');
      const {data:supports,error:supportError} = await auditor
        .from('rent_receipt_supports')
        .select('storage_path,organization_id,rent_payment_id,mime_type,size_bytes')
        .in('storage_path',[receipt,foreignReceipt]);
      assert.ok(!supportError && supports?.length === 2,
        'Both PDFs must have actual rent receipt support metadata');
      for (const support of supports) {
        const tenant = support.storage_path === receipt ? org : other;
        assert.equal(support.organization_id,tenant,'Receipt metadata crosses tenants');
        assert.equal(support.mime_type,'application/pdf','Receipt is not registered as PDF');
        assert.ok(Number(support.size_bytes)>10,'Empty private receipt');
      }
      const {data:payments,error:paymentsError} = await auditor
        .from('rent_payments').select('id,organization_id')
        .in('id',supports.map(x => x.rent_payment_id));
      assert.ok(!paymentsError && payments?.length === 2,
        'Test PDFs require two real test-period records');
      const paymentTenant = new Map(payments.map(x => [x.id,x.organization_id]));
      for (const support of supports) {
        assert.equal(paymentTenant.get(support.rent_payment_id),support.organization_id,
          'Receipt support is not linked to its own tenant');
      }
      const {data:members,error:memberError} = await auditor
        .from('organization_members').select('id,user_id,organization_id,status')
        .in('user_id',[...userIds]);
      assert.ok(!memberError && members?.length === 5,
        'QA identities must have exactly one membership each');
      for (const member of members) {
        assert.equal(member.organization_id,org,'No memberships in another tenant');
        assert.equal(member.status,'ACTIVE','All QA memberships must be active');
      }
      const {data:assignments,error:assignmentError} = await auditor
        .from('member_roles').select('organization_member_id,role_id')
        .in('organization_member_id',members.map(x => x.id));
      assert.ok(!assignmentError && assignments?.length === 5,
        'Exactly one role assignment per QA identity is required');
      const {data:roleDefs,error:roleError} = await auditor
        .from('roles').select('id,key,organization_id,active')
        .in('id',assignments.map(x => x.role_id));
      assert.ok(!roleError && roleDefs?.length === 5,'Role definitions are incomplete');
      const memberByUser = new Map(members.map(x => [x.user_id,x.id]));
      const roleById = new Map(roleDefs.map(x => [x.id,x]));
      for (const role of ROLES) {
        const memberId = memberByUser.get(idsByRole.get(role.name));
        const assigned = assignments.filter(x => x.organization_member_id === memberId);
        assert.equal(assigned.length,1,role.name + ': not an exclusive role');
        const definition = roleById.get(assigned[0].role_id);
        assert.equal(definition?.key,role.name,'QA account has wrong role');
        assert.equal(definition?.organization_id,org,'Role belongs to another tenant');
        assert.equal(definition?.active,true,'QA role inactive');
      }
      const {data:admins,error:adminError} = await auditor
        .from('platform_admins').select('user_id').eq('active',true)
        .in('user_id',[...userIds]);
      assert.ok(!adminError && admins?.length === 0,
        'QA users must never possess SuperAdmin');
      const {data:links,error:linksError} = await auditor
        .from('portal_access_links').select('user_id')
        .eq('user_id',idsByRole.get('CLIENT'));
      assert.ok(!linksError && links?.length === 0,
        'CLIENT QA must not inherit separate portal permissions');

      for (const role of ROLES) {
        await t.test(role.name + ' — 5 genuine JWT RPC decisions', async () => {
          const client = clients.get(role.name);
          for (const [label, procedure, parameters, expectedCode] of
            expectedRpcCases(org, other, role.privileged)) {
            const {error} = await client.rpc(procedure,parameters);
            checkError(error,expectedCode,role.name + ' / ' + label);
          }
        });
      }

      // The PDF files must exist in the PRIVATE jco-rent-receipts-private bucket,
      // with an actual rent_payment and corresponding storage RLS authorization.
      // Preparing those artifacts is a separate supervised QA fixture step.
      for (const role of ROLES) {
        await t.test(role.name + ' — same/foreign tenant private PDFs', async () => {
          const client = clients.get(role.name);
          const {data:ownPdf,error:ownError} =
            await client.storage.from('jco-rent-receipts-private').download(receipt);
          if (role.privileged) {
            assert.ok(!ownError && ownPdf, role.name + ' should read authorized PDF');
            const start = Buffer.from(await ownPdf.arrayBuffer()).subarray(0,5).toString('utf8');
            assert.equal(start,'%PDF-', 'Expected a real PDF, not a QA placeholder');
          } else {
            assert.ok(ownError && !ownPdf, role.name + ' should not read finance PDF');
          }
          const {data:foreignPdf,error:foreignError} =
            await client.storage.from('jco-rent-receipts-private').download(foreignReceipt);
          assert.ok(foreignError && !foreignPdf,
            role.name + ' must never read the other tenant\'s PDF');
        });
      }

      await t.test('anonymous cannot download the private receipt',async () => {
        const anonymous = createClient(endpoint.origin,key,
          {auth:{persistSession:false,autoRefreshToken:false}});
        const {data,error} = await anonymous.storage
          .from('jco-rent-receipts-private').download(receipt);
        assert.ok(error && !data, 'Anonymous private receipt read must fail');
      });
    } finally {
      // No refresh or persisted local storage. This local sign-out discards
      // client sessions; the provisioner separately deletes only its own QA users.
      // Local sign-out by itself does NOT revoke existing JWT access tokens.
      await Promise.all([...clients.values()].map(client =>
        client.auth.signOut({scope:'local'}).catch(() => null)));
    }
  });
