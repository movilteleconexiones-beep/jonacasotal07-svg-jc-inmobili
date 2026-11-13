import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifyPolicyPublication } from '../scripts/legal/verify-approved-policies.mjs';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(9000, 0x20)]);
const hash = data => createHash('sha256').update(data).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jco-g07-policies-'));
  const dir = join(root, 'public/politicas');
  const security = join(root, 'security/legal');
  mkdirSync(dir, { recursive:true }); mkdirSync(security, { recursive:true });
  const policy = { policy_url:'https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf',
    pdf_sha256:hash(PDF), signed_acta_sha256:hash(Buffer.from('signature evidence, offline')),
    approval_reference:'G07-JCO-2026-001', policy_version:'1.0',
    approved_at:'2026-11-10T14:30:00Z' };
  const manifest = { schema_version:1, policies: { 'sistema-inmobiliario-jco': policy } };
  const write = () => writeFileSync(join(security,'approved-policy-publication.json'),
    JSON.stringify(manifest));
  return {root,dir,manifest,policy,write, cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const adequateText = 'POLÍTICA DE TRATAMIENTO DE DATOS PERSONALES — Sistema Inmobiliario JCO\n' +
  'Los derechos de los titulares se ejercen mediante canales de contacto. '.repeat(38);

test('G07: no signed approved PDFs means public intake remains closed', () => {
  const f=fixture(); try {
    assert.equal(verifyPolicyPublication(f.root).state,'CLOSED_NO_PUBLISHED_POLICIES');
  } finally {f.cleanup()}
});
test('G07: adding a policy before its approval manifest blocks CI',()=>{
  const f=fixture();try {
    writeFileSync(join(f.dir,'sistema-inmobiliario-jco.pdf'),PDF);
    assert.throws(()=>verifyPolicyPublication(f.root),/without the separately approved manifest/);
  }finally{f.cleanup()}
});
test('G07: an approval record cannot authorize a changed PDF',()=>{
 const f=fixture();try {
  writeFileSync(join(f.dir,'sistema-inmobiliario-jco.pdf'),Buffer.concat([PDF,Buffer.from('tampered')]));f.write();
  assert.throws(()=>verifyPolicyPublication(f.root,()=>adequateText),/differs from the document explicitly approved/);
 }finally{f.cleanup()}
});
test('G07: a complete correct record and readable policy can pass mechanical checks',()=>{
 const f=fixture();try {
  writeFileSync(join(f.dir,'sistema-inmobiliario-jco.pdf'),PDF);f.write();
  assert.equal(verifyPolicyPublication(f.root,()=>adequateText).verified,1);
 }finally{f.cleanup()}
});
test('G07: a policy with audit stamps or placeholders cannot be published',()=>{
 const f=fixture();try {
  writeFileSync(join(f.dir,'sistema-inmobiliario-jco.pdf'),PDF);f.write();
  assert.throws(()=>verifyPolicyPublication(f.root,()=>adequateText+'\nBORRADOR DE AUDITORÍA'),/draft notice/);
  assert.throws(()=>verifyPolicyPublication(f.root,()=>adequateText+'\n[NIT DEL RESPONSABLE]'),/legal placeholders/);
 }finally{f.cleanup()}
});
test('G07: a signed document manifest without a PDF is rejected',()=>{
 const f=fixture();try {f.write();assert.throws(()=>verifyPolicyPublication(f.root),/manifest without published PDFs/)}
 finally{f.cleanup()}
});
test('G07: only allowlisted policy filenames may be deployed',()=>{
 const f=fixture();try {writeFileSync(join(f.dir,'politica-borrador.pdf'),PDF);
 assert.throws(()=>verifyPolicyPublication(f.root),/unexpected public legal file/)}finally{f.cleanup()}
});
test('G07: legal PDFs must use Caddy static-only 404, never SPA index.html fallback',()=>{
 const caddy=readFileSync(new URL('../Caddyfile', import.meta.url),'utf8');
 const legal=caddy.indexOf('handle @legalDocuments');
 const fallback=caddy.lastIndexOf('try_files {path} /index.html');
 assert.ok(legal>=0 && fallback>legal,'Legal static handler must run before SPA fallback');
 assert.match(caddy, /@legalDocuments path \/politicas \/politicas\/\*/);
 assert.match(caddy.slice(legal,fallback),/file_server/);
});
