import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
import test from 'node:test';
const form=readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx',import.meta.url),'utf8');
const pdf=readFileSync(new URL('../src/modules/finance/SignedLeaseDocuments.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261029090000_rental_draft_correction_and_duplicates.sql',import.meta.url),'utf8');

test('all contract creation flows detect existing DRAFT/ACTIVE/RENEWAL',()=>{
  assert.match(form,/\.in\('status',\['DRAFT','ACTIVE','RENEWAL'\]\)/);
  assert.doesNotMatch(form,/if \(mode==='DRAFT'\)/);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS leases_one_open_contract_per_property/);
  assert.match(migration,/WHERE status IN \('DRAFT','ACTIVE','RENEWAL'\)/);
});

test('authorized administrators can correct or annul only drafts, with a reason',()=>{
  assert.match(form,/activationAllowed&&\['STANDARD','DRAFT','APPROVAL'\]/);
  assert.match(form,/admin_correct_lease_draft/);
  assert.match(form,/admin_cancel_lease_draft/);
  assert.match(form,/Guardar corrección auditada/);
  assert.match(form,/Anular borrador/);
  assert.match(migration,/is_rental_lifecycle_admin\(target_org\)/);
  assert.match(migration,/status<>'DRAFT'/);
  assert.match(migration,/lease\.draft_corrected/);
  assert.match(migration,/lease\.draft_cancelled/);
});

test('signed contracts cannot be duplicated in storage-linked documents',()=>{
  assert.match(pdf,/existingCount>0/);
  assert.match(pdf,/selectedDocuments\.length>0/);
  assert.match(pdf,/No se permite duplicarlo/);
  assert.match(migration,/CREATE TRIGGER jco_unique_signed_lease_pdf/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/existing\.entity_id=NEW\.entity_id/);
  assert.doesNotMatch(migration,/DELETE FROM public\.documents/i);
});

test('existing financial records and signed PDF history are preserved',()=>{
  assert.match(migration,/signed_documents_preserved',true/);
  assert.match(migration,/financial_data_deleted',false/);
  assert.match(migration,/FROM public\.rent_payments/);
  assert.match(migration,/FROM public\.owner_statements/);
  assert.doesNotMatch(migration,/DELETE FROM public\.(leases|rent_payments|rent_receipts|documents)/i);
});
