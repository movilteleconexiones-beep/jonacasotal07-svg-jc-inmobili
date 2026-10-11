import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const ui=readFileSync(new URL('../src/modules/properties/PropertiesModule.tsx',import.meta.url),'utf8');
const lib=readFileSync(new URL('../src/lib/property-private-photos.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261011095000_private_inventory_property_photos.sql',import.meta.url),'utf8');
test('new properties offer photos and existing properties have a gallery',()=>{
 assert.match(ui,/inventory-new-photos/);
 assert.match(ui,/Ver \/ agregar fotos/);
 assert.match(ui,/saveInventoryPhotos\(created\.id,organizationId,pendingPhotos\)/);
 assert.match(ui,/loadInventoryPhotos\(property\.id,organizationId\)/);
});
test('storage uses a private bucket and tenant scoped policies',()=>{
 assert.match(sql,/values \('jco-inventory-private','jco-inventory-private',false/);
 assert.match(sql,/property_private_photos enable row level security/);
 assert.match(sql,/bucket_id='jco-inventory-private'/);
 assert.match(sql,/properties\.edit/);
 assert.match(sql,/split_part\(name,'\/',2\)/);
});
test('client enforces type, size and file count and uses signed URLs',()=>{
 assert.match(lib,/MAX_PHOTOS = 10/);
 assert.match(lib,/5 \* 1024 \* 1024/);
 assert.match(lib,/createSignedUrl/);
 assert.match(lib,/upsert:false/);
 assert.doesNotMatch(lib,/getPublicUrl/);
});
