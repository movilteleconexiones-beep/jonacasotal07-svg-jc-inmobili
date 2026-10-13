import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const ui=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261013061500_archived_commission_replacement.sql',import.meta.url),'utf8');
test('archived commission recovers as an editable new commission',()=>{
 assert.match(ui,/Recuperar como nueva editable/);
 assert.match(ui,/replace_archived_commission/);
 assert.match(sql,/corr\.archived_from_active/);
 assert.match(sql,/original_commission_id uuid PRIMARY KEY/);
 assert.match(sql,/RETURNING id INTO new_id/);
 assert.match(sql,/commissions\.archived_replaced/);
 assert.match(sql,/'PENDING'/);
 assert.doesNotMatch(sql,/UPDATE public\.commissions\s/i);
 assert.doesNotMatch(sql,/DELETE FROM public\.commissions\s/i);
});
