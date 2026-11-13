import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * G07: verify published legal PDFs against independently signed acta hashes.
 * A green CI is NOT a legal approval; a human verifies the authentic actas.
 * Never commit signed actas, identification documents, RUT or client PII.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const POLICIES = Object.freeze({
  'sistema-inmobiliario-jco': 'Sistema Inmobiliario JCO',
  'jco-inmodigital-global': 'JCO InmoDigital Global',
});
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{5,95}$/;
const VERSION = /^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/;
const APPROVAL_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;

function assertSafeRegularFile(path) {
  const st = lstatSync(path);
  assert.ok(st.isFile() && !st.isSymbolicLink(), 'Not a regular file: ' + path);
  return st;
}

export function extractPdfText(path) {
  const result = spawnSync('pdftotext', ['-layout', '-nopgbrk', path, '-'], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 3 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error('G07: pdftotext must read approved PDF: ' +
      (result.error?.message ?? result.stderr));
  }
  return result.stdout;
}

/** Verify public PDFs against a reviewed manifest, fail closed for drafts. */
export function verifyPolicyPublication(root = REPO_ROOT, extractText = extractPdfText) {
  const legalDir = resolve(root, 'public/politicas');
  const manifestPath = resolve(root, 'security/legal/approved-policy-publication.json');
  const approvedIds = Object.keys(POLICIES);
  const actualNames = existsSync(legalDir) ? readdirSync(legalDir) : [];

  for (const name of actualNames) {
    assert.ok(approvedIds.some(id => id + '.pdf' === name),
      'G07: unexpected public legal file: ' + name);
    assertSafeRegularFile(join(legalDir, name));
  }

  if (!actualNames.length) {
    assert.ok(!existsSync(manifestPath),
      'G07: approval manifest without published PDFs is misleading');
    return { state: 'CLOSED_NO_PUBLISHED_POLICIES', verified: 0 };
  }
  assert.ok(existsSync(manifestPath),
    'G07: do not publish privacy PDFs without the separately approved manifest');
  assertSafeRegularFile(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.ok(manifest.policies && typeof manifest.policies === 'object' &&
    !Array.isArray(manifest.policies));
  assert.deepEqual(Object.keys(manifest.policies).sort(),
    actualNames.map(name => name.slice(0, -4)).sort(),
    'Each published PDF must have exactly one approval record');

  for (const name of actualNames) {
    const id = name.slice(0, -4);
    const approval = manifest.policies[id];
    assert.ok(approval && typeof approval === 'object', 'G07: missing approval for ' + id);
    assert.equal(approval.policy_url, 'https://www.inmojco.com/politicas/' + name);
    assert.match(approval.pdf_sha256 ?? '', HASH, 'G07: missing PDF digest ' + id);
    assert.match(approval.signed_acta_sha256 ?? '', HASH, 'G07: signed acta SHA required ' + id);
    assert.match(approval.approval_reference ?? '', REF, 'G07: approval reference required ' + id);
    assert.match(approval.policy_version ?? '', VERSION, 'G07: final version required ' + id);
    assert.match(approval.approved_at ?? '', APPROVAL_TIME, 'G07: approval date required ' + id);
    assert.ok(Number.isFinite(Date.parse(approval.approved_at)) &&
      Date.parse(approval.approved_at) <= Date.now() + 5 * 60 * 1000,
      'G07: invalid/future approval timestamp ' + id);
    assert.notEqual(approval.pdf_sha256, approval.signed_acta_sha256,
      'G07: policy and signed acta are distinct documents ' + id);

    const file = join(legalDir, name);
    assert.ok(assertSafeRegularFile(file).size >= 8_000, 'G07: unusually short PDF ' + id);
    const bytes = readFileSync(file);
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')), 'G07: invalid PDF ' + id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), approval.pdf_sha256,
      'G07: published PDF differs from the document explicitly approved ' + id);
    const content = extractText(file);
    assert.ok(content.length > 1_200, 'G07: unreadable/scanned legal PDF ' + id);
    assert.ok(content.includes(POLICIES[id]), 'G07: wrong agency in PDF ' + id);
    assert.ok(/pol[ií]tica de tratamiento/i.test(content), 'G07: not a policy ' + id);
    assert.doesNotMatch(content,
      /BORRADOR\s+DE\s+AUDITOR[IÍ]A|NO\s+PUBLICAR|PENDIENTE\s+DE\s+APROBACI[OÓ]N|\[(?:RAZ[OÓ]N\s+SOCIAL|NIT|DATO\s+DE|DIRECCI[OÓ]N|CORREO|TEL[EÉ]FONO|FECHA\s+DE|COMPLETAR|NOMBRE\s+DEL|MUNICIPIO)/i,
      'G07: publication contains audit/draft notice or unresolved legal placeholders ' + id);
  }
  return { state: 'APPROVED_STATIC_ARTIFACTS_VERIFIED', verified: actualNames.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : REPO_ROOT;
  console.log('G07 public legal artifact release gate:', verifyPolicyPublication(root));
}
