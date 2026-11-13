import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const src=readFileSync(new URL(
  '../security/tests/g12_clone_only_live_billing_rollback.sql',import.meta.url),'utf8');
const sql=src.split('\n').filter(s=>!/^\s*--/.test(s)).join('\n');

test('G12 LIVE billing rehearsal must rollback ALL SQL changes and never call a real provider',()=>{
  assert.match(sql,/^BEGIN;/m);
  assert.match(sql,/^ROLLBACK;/m);
  assert.equal((sql.match(/^ROLLBACK;/gm)??[]).length,1);
  assert.doesNotMatch(sql,/\bCOMMIT\s*;/i);
  assert.doesNotMatch(sql,/\b(http|https):\/\//i);
  assert.doesNotMatch(sql,/\b(?:http_post|net\.http_post|pg_net|dblink|COPY|TRUNCATE)\b/i);
  assert.match(src,/project_id=zjgstfgiirgjssnihaam/);
  assert.match(src,/Simulated JWT/);
  assert.match(src,/NO Wompi network calls/);
  assert.match(sql,/^SELECT 'PASS: simulated LIVE billing RPC[\s\S]*ROLLED BACK/mi);
});

test('G12 temporary LIVE buyer is existing QA tenant; superadmin LIFETIME stays protected',()=>{
  assert.match(sql,/o.slug='sistema-inmobiliario-jco' AND o.status='ACTIVE'/);
  assert.match(sql,/b.is_test=true/);
  assert.match(sql,/o.slug='jco-inmodigital-global'/);
  assert.match(sql,/s.status='LIFETIME'/);
  assert.match(sql,/qa_org=super_org/);
  assert.match(sql,/UPDATE public\.organization_billing_access\s+SET is_test=false WHERE organization_id=qa_org AND is_test=true/);
  assert.match(sql,/UPDATE public\.billing_activation_settings\s+SET production_enabled=true WHERE id=true AND production_enabled=false/);
  assert.match(sql,/SELECT \* INTO super_org/);
  assert.match(sql,/super_org'\)::uuid/);
});

test('G12 checks order idempotency, payment replay and one applied license without fake certification',()=>{
  assert.match(sql,/SET LOCAL ROLE authenticated/);
  assert.match(sql,/SET LOCAL ROLE service_role/);
  assert.match(sql,/billing_create_order\(qa_org,plan_id,'production',requested\)/);
  assert.match(sql,/ord IS DISTINCT FROM public\.billing_create_order/);
  assert.match(sql,/process_verified_payment_event\(/);
  assert.match(sql,/result<>'processed'/);
  assert.match(sql,/result<>'duplicate'/);
  assert.match(sql,/fulfillment_status='APPLIED'/);
  assert.match(sql,/payment_events WHERE payment_order_id=ord_id/);
  assert.match(sql,/current_period_end > saved_period/);
  assert.match(sql,/license_type='SAAS' AND status='ACTIVE'/);
  assert.match(sql,/NO MONEY CHARGED/);
});
