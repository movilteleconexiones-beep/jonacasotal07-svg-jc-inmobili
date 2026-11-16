import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const sql=readFileSync(new URL('../security/candidates/g23_cursor_catalog_REVIEW_ONLY.sql',import.meta.url),'utf8');
const hook=readFileSync(new URL('../src/core/use-public-tenant-catalog.ts',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');

test('G23 public catalog uses a stable keyset, protected tenant entitlement and bounded pages',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.tenant_public_catalog_page/);
  assert.match(sql,/STABLE SECURITY DEFINER/);
  assert.match(sql,/SET search_path = ''/);
  assert.match(sql,/jco_private\.operational_access\(o\.id\)/);
  assert.match(sql,/s\.enable_public_website IS TRUE/);
  assert.match(sql,/o\.status='ACTIVE'/);
  assert.match(sql,/p\.organization_id=org_id/);
  assert.match(sql,/p\.status='AVAILABLE'/);
  assert.match(sql,/l\.property_id=p\.id/);
  assert.match(sql,/l\.status IN \('ACTIVE','RENEWAL'\)/);
  assert.match(sql,/\(p\.featured,p\.created_at,p\.id\) < \(after_featured,after_created_at,after_id\)/);
  assert.match(sql,/ORDER BY p\.featured DESC,p\.created_at DESC,p\.id DESC/);
  assert.match(sql,/LIMIT page_size\+1/);
  assert.match(sql,/page_size NOT BETWEEN 1 AND 50/);
  assert.doesNotMatch(sql,/OFFSET\s+\d{3}/i);
  assert.doesNotMatch(sql,/\bSELECT \*\s+FROM public\.properties\b/i);
});

test('G23 grants only intended RPC access and never exposes private tenancy tables',()=>{
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.tenant_public_catalog_page.*FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/TO anon,authenticated,service_role/);
  assert.match(sql,/idx_g23_public_properties_cursor/);
  assert.doesNotMatch(sql,/GRANT .* ON (?:TABLE|SCHEMA) public\./i);
  assert.doesNotMatch(sql,/\b(TRUNCATE|DELETE FROM|UPDATE public\.properties|DROP TABLE)\b/i);
});

test('G23 frontend exhausts server pages, detects duplicates and never reports partial inventory as complete',()=>{
  assert.match(hook,/supabase\.rpc\('tenant_public_catalog_page'/);
  assert.match(hook,/for\(let page=0;page<40;page\+\+\)/);
  assert.match(hook,/const ids=new Set<string>\(\)/);
  assert.match(hook,/ids\.has\(property\.id\)/);
  assert.match(hook,/batch\.properties\.length>50/);
  assert.match(hook,/loadingMore:hasMore,complete:!hasMore/);
  assert.match(hook,/live=false/);
  assert.match(app,/publicCatalog\.complete \? 'Inmuebles publicados' : 'Inmuebles cargados/);
  assert.match(app,/publicCatalog\.loadingMore \|\| publicCatalog\.error/);
  assert.match(app,/Los filtros se actualizarán al terminar/);
  assert.doesNotMatch(hook,/\.from\('properties'\)/);
});
