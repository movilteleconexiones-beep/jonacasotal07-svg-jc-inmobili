import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ruleset=JSON.parse(readFileSync(new URL('../security/recovery/backup-refs-ruleset.json',import.meta.url),'utf8'));

test('backups are protected against update, deletion and non-fast-forward, without blocking new refs',()=>{
  assert.equal(ruleset.target,'branch');
  assert.equal(ruleset.enforcement,'active');
  assert.deepEqual(ruleset.conditions.ref_name.include,['refs/heads/backup/**']);
  assert.deepEqual(ruleset.conditions.ref_name.exclude,[]);
  assert.deepEqual(ruleset.rules.map(r=>r.type).sort(),['deletion','non_fast_forward','update']);
  const update=ruleset.rules.find(r=>r.type==='update');
  assert.equal(update.parameters.update_allows_fetch_and_merge,false);
  assert.ok(!ruleset.rules.some(r=>r.type==='creation'),'new backups must remain creatable');
  assert.ok(!('bypass_actors' in ruleset),'no unspecified bypass actors');
});

test('ruleset JSON is only an operator recipe and not treated as an installed control',()=>{
  const notes=readFileSync(new URL('../docs/release/inmojco-backup-refs-github-protection.md',import.meta.url),'utf8');
  assert.match(notes,/NO aplicada/);
  assert.match(notes,/Administration: write/);
  assert.match(notes,/gh api --method POST/);
  assert.match(notes,/enforcement: active/);
  assert.match(notes,/no\s+constituyen un backup completo/);
});
