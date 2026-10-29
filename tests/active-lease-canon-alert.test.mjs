import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const entry=readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx',import.meta.url),'utf8');
const correction=readFileSync(new URL('../src/modules/finance/ActiveLeaseCorrection.tsx',import.meta.url),'utf8');
const contacts=readFileSync(new URL('../src/modules/contacts/ContactsModule.tsx',import.meta.url),'utf8');
const helper=readFileSync(new URL('../src/core/rental-canon-reference.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261029081500_active_lease_rectification_with_signed_evidence.sql',import.meta.url),'utf8');

test('new contracts warn about a lower or higher canon than the listed rental value',()=>{
 assert.match(entry,/select\('id,code,title,price,operation_type'\)/);
 assert.match(entry,/newCanonMismatch&&<p role="alert"/);
 assert.match(entry,/rentalCanonWarning\(newCanonMismatch\)/);
 assert.match(entry,/propertyCheck\.data\.price/);
 assert.match(entry,/window\.confirm\(rentalCanonWarning\(priceCheck\)/);
 assert.match(helper,/direction:entered>listed\?'superior':'inferior'/);
 assert.match(helper,/listed===entered\) return null/);
 assert.match(helper,/operationType!=='RENT'/);
});

test('administrative draft editor warns before submitting rent mismatch',()=>{
 assert.match(entry,/draftCanonMismatch&&<p role="alert"/);
 assert.match(entry,/rentalCanonWarning\(draftCanonMismatch\)/);
 assert.match(entry,/admin_correct_lease_draft/);
 assert.match(entry,/currentProperty\.data\.price/);
 assert.match(entry,/window\.confirm\(rentalCanonWarning\(difference\)/);
});

test('active contract correction is visible to admin and requires matching signed evidence',()=>{
 assert.match(contacts,/<ActiveLeaseCorrection/);
 assert.match(correction,/role\.key==='ADMIN'/);
 assert.match(correction,/PERMISSIONS\.LEASES_EDIT/);
 assert.match(correction,/PERMISSIONS\.DOCUMENTS_VIEW/);
 assert.match(correction,/isSignedLeaseDocument\(doc,organizationId,lease\.id\)/);
 assert.match(correction,/supporting_signed_document:selectedEvidence/);
 assert.match(correction,/correction_reason:reason/);
 assert.match(correction,/matchingDocs\.length>1/);
 assert.match(correction,/mismatch&&<p role="alert"/);
 assert.doesNotMatch(correction,/\.from\('leases'\)\.update\(/);
});

test('server correction locks lease, preserves obligations, requires admin and signed file',()=>{
 assert.match(sql,/is_rental_lifecycle_admin\(target_org\)/);
 assert.match(sql,/has_org_permission\(target_org,'documents\.view'\)/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/doc\.mime_type='application\/pdf'/);
 assert.match(sql,/storage\.objects file/);
 assert.match(sql,/pay\.expected_amount IS DISTINCT FROM/);
 assert.match(sql,/lease\.active_rectified/);
 assert.match(sql,/financial_movements_modified',false/);
 assert.match(sql,/CREATE TRIGGER jco_active_lease_terms_guard/);
 assert.match(sql,/REVOKE ALL ON TABLE jco_private\.active_lease_correction_permits/);
 assert.doesNotMatch(sql,/DELETE FROM public\.(rent_payments|rent_receipts|owner_statements|documents|leases)/i);
});
