import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal=readFileSync(new URL('../src/components/SubmitPropertyModal.tsx',import.meta.url),'utf8');
const upload=readFileSync(new URL('../supabase/functions/consignment-photo-upload/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261011090000_private_consignment_photos.sql',import.meta.url),'utf8');

test('photo upload follows persistence of the consignment record',()=>{
 const submitHandler = modal.slice(modal.indexOf('const handleSubmit = async'), modal.indexOf('const resetAndClose'));
 assert.ok(submitHandler.includes('await submitPropertyConsignment('));
 assert.ok(submitHandler.indexOf('await submitPropertyConsignment(') < submitHandler.indexOf('await attemptPhotoUploads(reference, 0)'));
 assert.match(modal, /await uploadConsignmentPhoto\(site\.slug, request\.current\.id, reference, i, photos\[i\]\)/);
 assert.match(modal,/next\.length > 10/);
 assert.match(modal,/setUploadedPhotos\(i \+ 1\)/);
});
test('storage remains private with tenant scoped reviewer policy',()=>{
 assert.match(sql,/values\('jco-consignment-photos','jco-consignment-photos',false/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/property_consignment_photos_reviewer_read/);
 assert.match(sql,/public\.has_org_permission\(c\.organization_id,'properties\.view'\)/);
 assert.match(sql,/resolve_consignment_photo_submission/);
 assert.match(sql,/to service_role/);
});
test('uploads verify a persisted submission and inspect binary image signature',()=>{
 assert.match(upload,/resolve_consignment_photo_submission/);
 assert.match(upload,/magic\(bytes,file\.type\)/);
 assert.match(upload,/consignment\.organization_id/);
 assert.match(upload,/position>9/);
 assert.match(upload,/upsert:false/);
 assert.doesNotMatch(upload,/getPublicUrl\(/);
});

const review=readFileSync(new URL('../supabase/functions/consignment-photo-review/index.ts',import.meta.url),'utf8');
const moduleUi=readFileSync(new URL('../src/modules/consignments/PropertyConsignmentsModule.tsx',import.meta.url),'utf8');
test('review photo links require a verified user and tenant RLS',()=>{
 assert.match(review,/privileged\.auth\.getUser\(bearer\)/);
 assert.match(review,/asUser\.from\('property_consignments'\)/);
 assert.match(review,/asUser\.from\('property_consignment_photos'\)/);
 assert.match(review,/createSignedUrl\(photo\.storage_path,300\)/);
 assert.doesNotMatch(review,/getPublicUrl\(/);
 assert.match(moduleUi,/fetchConsignmentPhotos\(selected\.id\)/);
});
test('public handler applies streaming limits before decoding images',()=>{
 assert.match(upload,/req\.body\?\.getReader\(\)/);
 assert.match(upload,/total>5500000/);
 assert.match(upload,/bytes\[0\]===255/);
});
