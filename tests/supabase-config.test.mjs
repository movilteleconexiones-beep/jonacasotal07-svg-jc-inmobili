import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8');

test('Supabase test overrides require a paired URL and publishable key', () => {
  assert.match(source, /Boolean\(configuredUrl\) === Boolean\(configuredKey\)/);
});

test('partial overrides fail closed instead of connecting to production', () => {
  assert.match(source, /isSupabaseConfigured\s*\?\s*\(configuredUrl \|\| DEFAULT_SUPABASE_URL\)\s*:\s*'https:\/\/unconfigured\.invalid'/);
  assert.match(source, /isSupabaseConfigured\s*\?\s*\(configuredKey \|\| DEFAULT_SUPABASE_PUBLISHABLE_KEY\)\s*:\s*'missing-paired-supabase-configuration'/);
});
