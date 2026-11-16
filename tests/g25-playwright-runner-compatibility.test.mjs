import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const workflows = [
  'g15-anonymous-journey-matrix.yml',
  'g11-mobile-release-smoke.yml',
  'g07-hosted-intake-policy-browser.yml',
  'g03-public-crm-privacy-browser.yml',
  'g08-live-frontend-project-ref.yml',
];

test('G25: all protected hosted Chromium suites use supported pinned OS', () => {
  for (const workflow of workflows) {
    const src = readFileSync(new URL('../.github/workflows/' + workflow, import.meta.url), 'utf8');
    assert.match(src, /^\s*runs-on: ubuntu-24\.04$/m, workflow);
    assert.match(src, /npm install --no-save --ignore-scripts playwright@1\.56\.1/, workflow);
    assert.match(src, /npx playwright install --with-deps chromium/, workflow);
    assert.doesNotMatch(src, /runs-on:\s*ubuntu-latest/, workflow);
  }
});
