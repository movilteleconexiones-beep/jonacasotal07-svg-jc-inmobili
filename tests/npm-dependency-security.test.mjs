import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url),'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url),'utf8'));

test('resolved runtime Express 4 transitive dependencies contain security patches',()=>{
  const bp=lock.packages['node_modules/body-parser'];
  const qs=lock.packages['node_modules/qs'];
  assert.equal(bp?.version,'1.20.9','CVE-2026-111181: body-parser 1.20.9 patch required');
  assert.equal(qs?.version,'6.16.1','CVE-2026-110816: qs 6.16.1 patch required');
  assert.match(bp.integrity,/^sha512-[A-Za-z0-9+/]+=*$/);
  assert.match(qs.integrity,/^sha512-[A-Za-z0-9+/]+=*$/);
  for(const [name,entry] of Object.entries(lock.packages)) {
    if(/(^|\/)node_modules\/body-parser$/.test(name))
      assert.equal(entry.version,'1.20.9','Unpatched nested body-parser in lockfile');
    if(/(^|\/)node_modules\/qs$/.test(name))
      assert.equal(entry.version,'6.16.1','Unpatched nested qs in lockfile');
  }
  assert.match(pkg.dependencies.express,/^\^4\./);
});

test('npm ci actually installs the verified security patch versions',()=>{
  assert.equal(require('body-parser/package.json').version,'1.20.9');
  assert.equal(require('qs/package.json').version,'6.16.1');
  assert.equal(require('express/package.json').version,'4.22.3');
});
