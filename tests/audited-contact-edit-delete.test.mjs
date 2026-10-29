import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const ui=readFileSync(new URL('../src/modules/contacts/ContactsModule.tsx',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261029100000_audited_contact_correction_and_unlinked_removal.sql',import.meta.url),'utf8');

test('administrators edit contact details without creating another client',()=>{
 assert.match(ui,/adminMayCorrect/);
 assert.match(ui,/PERMISSIONS\.CLIENTS_EDIT/);
 assert.match(ui,/admin_correct_client_contact/);
 assert.match(ui,/Corregir ficha de cliente/);
 assert.match(ui,/Guardar corrección/);
 assert.match(ui,/Ya existe una ficha con este correo/);
 assert.match(sql,/contact\.corrected/);
 assert.match(sql,/before/);
 assert.match(sql,/after/);
});

test('only unlinked clients may be physically deleted, with catalog FK guard',()=>{
 assert.match(ui,/admin_delete_unlinked_contact/);
 assert.match(ui,/Eliminar si no está vinculado/);
 assert.match(ui,/window\.confirm/);
 assert.match(sql,/pg_catalog\.pg_constraint/);
 assert.match(sql,/c\.confrelid='public\.contacts'::regclass/);
 assert.match(sql,/has_ref/);
 assert.match(sql,/contact\.unlinked_deleted/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.admin_delete_unlinked_contact/);
});

test('contacts linked to contracts, prospects or portals cannot be cascaded away',()=>{
 assert.match(sql,/Client has linked records/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/ONLY|admin|Administrator/);
 assert.doesNotMatch(ui,/\.from\('contacts'\)\.delete\(/);
});
