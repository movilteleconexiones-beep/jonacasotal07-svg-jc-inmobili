import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261028182000_property_publication_cutover_stage2.sql', import.meta.url), 'utf8');

test('cutover is atomic and refuses existing live listings without explicit approval', () => {
  assert.match(sql,/BEGIN;[\s\S]*LOCK TABLE public\.properties, public\.property_publications/);
  assert.match(sql,/public\.tenant_public_catalog\(o\.slug\)/);
  assert.match(sql,/jsonb_array_elements\(/);
  assert.match(sql,/approval\.published IS DISTINCT FROM true/);
  assert.match(sql,/visible\.previous_description/);
  assert.match(sql,/approval\.public_description/);
  assert.match(sql,/RAISE EXCEPTION 'Cannot cut over public catalog: current listings lack approved publication or reviewed description'/);
  const check = sql.indexOf('approval.published IS DISTINCT FROM true');
  const replacement = sql.indexOf('CREATE OR REPLACE FUNCTION public.tenant_public_catalog');
  assert.ok(check >= 0 && replacement > check, 'approval guard must precede atomic function replacement');
  assert.match(sql,/COMMIT;\s*$/);
});

test('new public catalog preserves branding and exposes only approved public descriptions and images', () => {
  for (const field of ['public_headline','public_description','public_hero_url',
    'public_office_address','public_services','public_page_content','whatsapp']) {
    assert.ok(sql.includes("'" + field + "', b." + field), 'current public branding: ' + field);
  }
  assert.match(sql,/JOIN public\.property_publications approved/);
  assert.match(sql,/approved\.published IS TRUE/);
  assert.match(sql,/prop\.status='AVAILABLE'/);
  assert.match(sql,/'description', p\.public_description/);
  assert.match(sql,/'image_url', p\.public_photo_url/);
  assert.doesNotMatch(sql,/'description', p\.description/);
  assert.match(sql,/REVOKE ALL PRIVILEGES ON TABLE public\.properties FROM anon/);
});
