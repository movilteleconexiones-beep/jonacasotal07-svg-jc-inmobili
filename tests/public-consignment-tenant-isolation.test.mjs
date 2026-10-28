import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isIntakeSiteForSlug } from '../src/core/public-consignment-scope.ts';

const intake = {slug:'agencia-a',company_name:'Inmobiliaria A',country:'CO',currency:'COP'};

test('accepts only site metadata belonging to the requested real-estate agency',()=>{
  assert.equal(isIntakeSiteForSlug(intake,'agencia-a'),true);
  assert.equal(isIntakeSiteForSlug(intake,'agencia-b'),false);
  assert.equal(isIntakeSiteForSlug({...intake,slug:'agencia-b'},'agencia-a'),false);
  assert.equal(isIntakeSiteForSlug(intake,'../app'),false);
  assert.equal(isIntakeSiteForSlug(null,'agencia-a'),false);
});

test('rejects corrupted and untyped public intake brand fields',()=>{
  for(const patch of [
    {company_name:''},{company_name:'  '},{company_name:42},
    {country:'Colombia'},{country:''},{country:null},
    {currency:'pesos'},{currency:42},{slug:12},
  ]) assert.equal(isIntakeSiteForSlug({...intake,...patch},'agencia-a'),false,JSON.stringify(patch));
});

test('each open and agency navigation gets a fresh consignment component',()=>{
  const app = readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const modal = app.slice(app.indexOf('{/* Never retain owner contact details'));
  assert.match(modal,/\{isSubmitModalOpen && \(\s*<SubmitPropertyModal/);
  assert.match(modal,/key=\{tenantSlug \|\| 'public-consignment-no-agency'\}/);
  assert.match(modal,/publicSiteSlug=\{tenantSlug\}/);
  assert.match(modal,/onClose=\{\(\) => setIsSubmitModalOpen\(false\)\}/);
});

test('late intake metadata cannot be shown as another agency branding',()=>{
  const hook=readFileSync(new URL('../src/lib/property-consignments.ts',import.meta.url),'utf8');
  assert.match(hook,/let cancelled = false;/);
  assert.match(hook,/if \(cancelled\) return;/);
  assert.match(hook,/!isIntakeSiteForSlug\(data, publicSiteSlug\)/);
  assert.match(hook,/return \(\) => \{ cancelled = true; \}/);
});

test('pending consignment/photo uploads remain scoped to their initial site and request ID',()=>{
  const modal = readFileSync(new URL('../src/components/SubmitPropertyModal.tsx',import.meta.url),'utf8');
  assert.match(modal,/submitPropertyConsignment\(site.slug, request.current.id, input\)/);
  assert.match(modal,/uploadConsignmentPhoto\(site.slug, request.current.id, reference, i, photos\[i\]\)/);
  assert.match(modal,/request.current = \{ signature, id: crypto.randomUUID\(\) \}/);
});
