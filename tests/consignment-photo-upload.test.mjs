import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal=readFileSync(new URL('../src/components/SubmitPropertyModal.tsx',import.meta.url),'utf8');
const upload=readFileSync(new URL('../supabase/functions/consignment-photo-upload/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261011090000_private_consignment_photos.sql',import.meta.url),'utf8');

test('photo upload follows persistence of the consignment record',()=>{
 assert.ok(modal.indexOf('await submitPropertyConsignment(')<modal.indexOf('await uploadConsignmentPhoto('));
 assert.match(modal,/photos\.length > 10/);
 assert.match(modal,/setUploadedPhotos\(uploaded\)/);
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
