import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
 new URL('../supabase/migrations/20261107115138_revoke_excess_public_maintain_postgres_phase.sql', import.meta.url),
 'utf8',
);

// Exact digest obtained from the SQL statements[] of the applied Supabase migration.
// A future edit must create a NEW forward migration, never rewrite this history.
const LIVE_SQL_MD5 = '6189f33c15ab2efa63fe542378246ae1';

test('G08 applied PostgreSQL MAINTAIN migration is immutable and matches live ledger', () => {
 assert.equal(createHash('md5').update(migration).digest('hex'), LIVE_SQL_MD5);
});

test('G08 removes only excess PostgreSQL MAINTAIN from API roles and fails closed', () => {
 assert.match(migration, /current_user <> 'postgres'/);
 assert.match(migration, /Unexpected public object owner/);
 assert.match(migration, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE MAINTAIN ON TABLES FROM anon, authenticated/);
 assert.match(migration, /REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated/);
 assert.match(migration, /v_count<>v_service OR v_anon<>0 OR v_auth<>0/);
 assert.match(migration, /a\.privilege_type='MAINTAIN'/);
 assert.match(migration, /Commercial SELECT grants unexpectedly changed/);
 assert.doesNotMatch(migration, /\bSET ROLE\b/i);
 assert.doesNotMatch(migration, /\bGRANT MAINTAIN\b/i);
 assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
 assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
 assert.doesNotMatch(migration, /REVOKE\s+\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});
