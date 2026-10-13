import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const ui=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
const restore=readFileSync(new URL('../supabase/migrations/20261013052000_restore_cancelled_commissions.sql',import.meta.url),'utf8');
const archive=readFileSync(new URL('../supabase/migrations/20261013051500_fix_archive_reason.sql',import.meta.url),'utf8');
test('restoration requires administrator and records audit',()=>{
 assert.match(ui,/restore_cancelled_commission/);
 assert.match(ui,/Recuperar<\/button>/);
 assert.match(restore,/commission_is_manager\(target_org\)/);
 assert.match(restore,/status='PENDING'/);
 assert.match(restore,/commissions.cancelled_restored/);
 assert.match(restore,/c.paid_at IS NOT NULL/);
});
test('archive reason is qualified to avoid PostgreSQL ambiguity',()=>{
 assert.match(archive,/archive_rectified_commission\.reason/);
 assert.doesNotMatch(archive,/btrim\(reason\)/);
});
