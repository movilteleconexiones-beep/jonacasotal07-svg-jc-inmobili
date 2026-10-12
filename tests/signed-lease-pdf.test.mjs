import assert from 'node:assert/strict';
import test from 'node:test';
import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import {
  MAX_SIGNED_LEASE_PDF_BYTES, SIGNED_LEASE_BUCKET, signedLeasePrefix,
  validateSignedLeasePdf, isSignedLeaseDocument,
} from '../src/core/signed-lease-pdf.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const leaseId = '22222222-2222-4222-8222-222222222222';
const otherOrganizationId = '33333333-3333-4333-8333-333333333333';
const otherLeaseId = '44444444-4444-4444-8444-444444444444';
const fileId = '55555555-5555-4555-8555-555555555555';
const path = signedLeasePrefix(organizationId, leaseId) + fileId + '.pdf';
const row = {
  organization_id: organizationId, entity_type: 'GENERAL',
  entity_id: leaseId, document_type: 'CONTRACT',
  storage_bucket: SIGNED_LEASE_BUCKET, storage_path: path,
};

test('signed contract files are restricted to the selected organization, lease and private folder', () => {
  assert.equal(SIGNED_LEASE_BUCKET, 'organization-documents');
  assert.equal(isSignedLeaseDocument(row, organizationId, leaseId), true);
  assert.equal(isSignedLeaseDocument(row, otherOrganizationId, leaseId), false);
  assert.equal(isSignedLeaseDocument(row, organizationId, otherLeaseId), false);
  for (const replacement of [
    { organization_id: otherOrganizationId },
    { entity_id: otherLeaseId },
    { document_type: 'OTHER' },
    { entity_type: 'CONTACT' },
    { storage_bucket: 'propiedades' },
    { storage_path: signedLeasePrefix(otherOrganizationId, leaseId) + fileId + '.pdf' },
    { storage_path: signedLeasePrefix(organizationId, otherLeaseId) + fileId + '.pdf' },
    { storage_path: signedLeasePrefix(organizationId, leaseId) + '../../unsafe.pdf' },
  ]) {
    assert.equal(isSignedLeaseDocument({ ...row, ...replacement }, organizationId, leaseId), false);
  }
});

test('PDF preflight rejects non-PDF, forged extension, invalid mime and too-large files', async () => {
  assert.equal(await validateSignedLeasePdf(new File(
    [Buffer.from('%PDF-1.7 valid header')], 'firmado.pdf', { type: 'application/pdf',
  })), null);
  assert.equal(await validateSignedLeasePdf(new File(
    [Buffer.from('%PDF-1.7')], 'firmado.PDF', { type: '',
  })), null);
  assert.match(await validateSignedLeasePdf(new File(
    [Buffer.from('not a pdf')], 'firmado.pdf', { type: 'application/pdf',
  })) ?? '', /cabecera PDF/);
  assert.match(await validateSignedLeasePdf(new File(
    [Buffer.from('%PDF-1.7')], 'firmado.exe', { type: 'application/pdf',
  })) ?? '', /Selecciona un archivo PDF/);
  assert.match(await validateSignedLeasePdf(new File(
    [Buffer.from('%PDF-1.7')], 'firmado.pdf', { type: 'text/plain',
  })) ?? '', /Selecciona un archivo PDF/);
  assert.match(await validateSignedLeasePdf(new File(
    [], 'firmado.pdf', { type: 'application/pdf',
  })) ?? '', /10 MB/);
  assert.match(await validateSignedLeasePdf(new File(
    [new Uint8Array(MAX_SIGNED_LEASE_PDF_BYTES + 1)], 'firmado.pdf',
    { type: 'application/pdf' })) ?? '', /10 MB/);
});

test('upload UI requires signed confirmation and document permissions; never makes public URLs', () => {
  const module = readFileSync(new URL('../src/modules/finance/SignedLeaseDocuments.tsx', import.meta.url), 'utf8');
  const rent = readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx', import.meta.url), 'utf8');
  assert.match(rent, /Contrato firmado \(PDF\)/);
  assert.match(rent, /<SignedLeaseDocuments organizationId=\{organizationId\} leases=\{leases\}/);
  assert.match(module, /PERMISSIONS\.LEASES_VIEW/);
  assert.match(module, /PERMISSIONS\.DOCUMENTS_VIEW/);
  assert.match(module, /PERMISSIONS\.DOCUMENTS_UPLOAD/);
  assert.match(module, /form\.get\('signed_confirmation'\) !== 'on'/);
  assert.match(module, /accept="\.pdf,application\/pdf"/);
  assert.match(module, /validateSignedLeasePdf\(file\)/);
  assert.match(module, /upsert: false/);
  assert.match(module, /crypto\.randomUUID\(\) \+ '\.pdf'/);
  assert.match(module, /\.eq\('organization_id', organizationId\)/);
  assert.match(module, /entity_id: lease\.id/);
  assert.match(module, /createSignedUrl\(document\.storage_path, 60\)/);
  assert.doesNotMatch(module, /getPublicUrl|\.update\(\{status: 'ACTIVE'\}\)|WOMPI_PRIVATE_KEY/);
});

test('existing portal document rules exclude GENERAL lease attachments', () => {
  const module = readFileSync(new URL('../src/modules/finance/SignedLeaseDocuments.tsx', import.meta.url), 'utf8');
  assert.match(module, /entity_type: 'GENERAL'/);
  assert.match(module, /document_type: 'CONTRACT'/);
  assert.match(module, /storage_bucket: SIGNED_LEASE_BUCKET/);
  assert.match(module, /Archivo privado/);
});
