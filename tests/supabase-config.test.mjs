import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8');

test('Supabase requires both explicitly configured public variables', () => {
  assert.match(source, /Boolean\(configuredUrl && configuredKey\)/);
});

test('missing or partial configuration fails closed', () => {
  assert.match(source, /isSupabaseConfigured \? configuredUrl! : 'https:\/\/unconfigured\.invalid'/);
  assert.match(source, /isSupabaseConfigured \? configuredKey! : 'missing-supabase-configuration'/);
});

test('the browser client never silently targets official production', () => {
  assert.doesNotMatch(source, /DEFAULT_SUPABASE_URL|DEFAULT_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source, /nqzopzhmhqdssgpljypu/);
});
