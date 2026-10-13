import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const ui=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261013050000_archive_rectified_commissions.sql',import.meta.url),'utf8');
test('administrator can retire rectified item with recoverable history',()=>{
 assert.match(ui,/archive_rectified_commission/);
 assert.match(ui,/Retirar del listado/);
 assert.match(ui,/Mostrar comisiones retiradas \(historial\)/);
 assert.match(ui,/showArchived\|\|!corrections\[row.id\]\?\.archived_from_active/);
 assert.match(sql,/commission_is_manager\(target_org\)/);
 assert.match(sql,/archived_from_active=true/);
 assert.match(sql,/commissions.rectified_archived/);
 assert.doesNotMatch(sql,/DELETE FROM public.commissions/);
});
