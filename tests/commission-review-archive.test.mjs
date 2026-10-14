import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261014010000_admin_archive_commission_reviews.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
test('archival requires tenant administrator and forbids pending cases',()=>{
 assert.match(sql,/commission_is_manager\(p_organization_id\)/);
 assert.match(sql,/v_status='PENDING'/);
 assert.match(sql,/archived_by=COALESCE/);
 assert.match(sql,/REVOKE ALL ON FUNCTION/);
 assert.doesNotMatch(sql,/DELETE FROM public\.commission_review_requests/i);
});
test('archive UI is admin only and history preserved',()=>{
 assert.match(ui,/isCommissionAdministrator&&review.status!=='PENDING'&&!review.archived_at/);
 assert.match(ui,/admin_archive_commission_review/);
 assert.match(ui,/Solicitudes archivadas/);
});