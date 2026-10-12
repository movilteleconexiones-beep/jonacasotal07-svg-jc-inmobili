import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/modules/deals/DealsModule.tsx', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/20261012193000_deals_safe_admin_deletion.sql', import.meta.url), 'utf8');

test('business rows expose edit for deals.edit and delete only to administrator with deals.close', () => {
  assert.match(ui, /<th className="px-4 py-3">Acciones<\/th>/);
  assert.match(ui, /can\(PERMISSIONS\.DEALS_EDIT\) && <button/);
  assert.match(ui, /<Pencil className="h-3\.5 w-3\.5" \/> Editar/);
  assert.match(ui, /mayDelete && <button/);
  assert.match(ui, /<Trash2 className="h-3\.5 w-3\.5" \/> Eliminar/);
  assert.match(ui, /activeMembership\?\.roles\.some\(role => role\.key === 'ADMIN'\)/);
  assert.match(ui, /can\(PERMISSIONS\.DEALS_CLOSE\)/);
});

test('edit form preloads existing business fields and checks organization scope', () => {
  for (const name of ['contact_id', 'property_id', 'operation_type',
    'expected_close_date', 'asking_price', 'offered_price', 'final_price',
    'commission_percentage']) assert.match(ui, new RegExp('name="'+name+'"'));
  assert.match(ui, /defaultValue=\{row\.contact_id\}/);
  assert.match(ui, /defaultValue=\{row\.property_id\}/);
  assert.match(ui, /\.eq\('organization_id', organizationId\)\.eq\('id', row\.id\)/);
  assert.match(ui, /\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(ui, /value > 100/);
  assert.match(ui, /setMessage\('Negocio actualizado correctamente\.'\)/);
});

test('delete uses a permission-scoped RPC, confirmation and not a direct client delete', () => {
  assert.match(ui, /window\.confirm\('¿Eliminar definitivamente este negocio/);
  assert.match(ui, /supabase\.rpc\('delete_unlinked_deal'/);
  assert.match(ui, /target_org: organizationId, target_deal: row\.id/);
  assert.doesNotMatch(ui, /\.from\('deals'\)\.delete\(/);
  assert.match(sql, /REVOKE DELETE ON TABLE public\.deals FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /has_org_permission\(target_org,'deals\.close'\)/);
  assert.match(sql, /role\.key = 'ADMIN'/);
  assert.match(sql, /FOR UPDATE;/);
  assert.match(sql, /public\.activities a WHERE a\.deal_id = target_deal/);
  assert.match(sql, /public\.commissions c WHERE c\.deal_id = target_deal/);
  assert.match(sql, /deal_row\.stage IN \('WON','LOST'\)/);
  assert.match(sql, /INSERT INTO public\.audit_log/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.delete_unlinked_deal\(uuid,uuid\) TO authenticated/);
});
