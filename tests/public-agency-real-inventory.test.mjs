import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicAgencySlug,publicConsignmentSlug,publicAgencyUrl} from '../src/core/public-agency-route.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const app=read('src/App.tsx');
const front=read('src/pages/PublicAgencyCatalog.tsx');
const privateModule=read('src/modules/properties/PropertiesModule.tsx');
const publish=read('src/modules/properties/PropertyPublishingControls.tsx');
const sql=read('supabase/migrations/20261015194000_isolated_real_property_publications.sql');

test('agency catalog URLs only accept strict slugs and no UUID query overrides',()=>{
 assert.equal(publicAgencySlug('/inmobiliaria/tenant-a'),'tenant-a');
 assert.equal(publicAgencySlug('/inmobiliaria/tenant-b/'),'tenant-b');
 for(const path of ['/inmobiliaria','/inmobiliaria/','/inmobiliaria/%2F',
  '/inmobiliaria/../','/inmobiliaria/A_1','/inmobiliaria/tenant-a/other',
  '/inmobiliaria/zz','/inmobiliaria/test?org=123']){
  assert.equal(publicAgencySlug(path),null,path);
 }
 assert.equal(publicAgencyUrl('tenant-a'),'/inmobiliaria/tenant-a');
 assert.throws(()=>publicAgencyUrl('../tenant-b'),/válido/);
 assert.equal(publicConsignmentSlug('/inmobiliaria/tenant-b','tenant-a'),'tenant-b');
 assert.equal(publicConsignmentSlug('/inmobiliaria/../tenant-a','tenant-a'),null);
 assert.equal(publicConsignmentSlug('/','tenant-a'),'tenant-a');
});

test('central website does not promote bundled sample inventory as real listings',()=>{
 assert.match(app,/const \[properties\] = useState<Property\[\]>\(\[\]\)/);
 assert.match(app,/const publicSlug = publicAgencySlug\(window\.location\.pathname\)/);
 assert.match(app,/<PublicAgencyCatalog\s*\/>/);
 assert.doesNotMatch(app,/useState<Property\[\]>\(PROPERTIES\)/);
});

test('public catalog has no private table query nor private photo access',()=>{
 assert.match(front,/supabase\.rpc\('get_public_property_intake_site'/);
 assert.match(front,/supabase\.rpc\('get_public_agency_listings'/);
 assert.match(front,/publicAgencySlug\(window\.location\.pathname\)/);
 assert.doesNotMatch(front,/\.from\('properties'\)|\.from\('organization_members'\)/);
 assert.doesNotMatch(front,/jco-inventory-private'\)\.createSignedUrl/);
 assert.match(front,/No fue posible comprobar el inventario público/);
 assert.match(front,/setListings\(\[\]\)/);
});

test('listing is explicitly published and requires enabled ACTIVE site',()=>{
 assert.match(sql,/property_id uuid PRIMARY KEY/);
 assert.match(sql,/published boolean NOT NULL DEFAULT false/);
 assert.match(sql,/p\.status='AVAILABLE'/);
 assert.match(sql,/s\.enabled/);
 assert.match(sql,/o\.status='ACTIVE'/);
 assert.match(sql,/pub\.organization_id=o\.id AND pub\.published/);
 assert.match(sql,/jco_private\.is_internal_staff\(organization_id\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.get_public_agency_listings\(text,integer,integer\) TO anon,authenticated/);
 assert.doesNotMatch(sql,/GRANT (?:SELECT|ALL) ON public\.properties TO anon/);
 assert.doesNotMatch(sql,/storage\.buckets.*public\s*=\s*true/);
});

test('only editable staff can explicitly publish; private photos remain private',()=>{
 assert.match(privateModule,/PropertyPublishingControls/);
 assert.match(publish,/can\(PERMISSIONS\.PROPERTIES_EDIT\)/);
 assert.match(publish,/property\.status!=='AVAILABLE'/);
 assert.match(publish,/jco-inventory-private/);
 assert.match(publish,/property_publications'\)\.upsert/);
});
