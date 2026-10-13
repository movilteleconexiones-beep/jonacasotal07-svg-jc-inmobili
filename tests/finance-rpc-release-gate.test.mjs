import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

// Release gate: public client contracts must remain synchronized with the
// database procedures. These checks are static; SQL behavior is tested
// separately using PostgreSQL fixtures in GitHub Actions.
const modules = [
  {
    name: 'commissions',
    path: 'src/modules/commissions/CommissionsModule.tsx',
    procedures: [
      'edit_unpaid_commission',
      'cancel_unpaid_commission',
      'request_paid_commission_review',
      'decide_paid_commission_review',
      'set_commission_status_audited',
    ],
    prohibited: [/\.from\(['"]commissions['"]\)\.update\(/, /\.from\(['"]commissions['"]\)\.delete\(/],
  },
  {
    name: 'rent corrections',
    path: 'src/modules/finance/RentOwnerBalances.tsx',
    procedures: [
      'schedule_lease_rent_amendment',
      'correct_unpaid_rent_period',
      'request_paid_rent_review',
    ],
    prohibited: [/\.from\(['"]rent_payments['"]\)\.update\(/, /\.from\(['"]rent_payments['"]\)\.delete\(/],
  },
  {
    name: 'owner statement reconciliation',
    path: 'src/modules/finance/OwnerDeductionLedger.tsx',
    procedures: [
      'reconcile_owner_draft_statement_audited',
      'revert_owner_draft_reconciliation',
    ],
    prohibited: [/\.from\(['"]owner_statements['"]\)\.update\(/, /\.from\(['"]owner_statements['"]\)\.delete\(/],
  },
];

for (const mod of modules) {
  test(mod.name + ': audited RPC contract is present and direct ledger writes are absent', () => {
    const ui = source(mod.path);
    for (const procedure of mod.procedures) {
      const escaped = procedure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(ui, new RegExp('\\.rpc\\(\\s*[\\x27\\x22]' + escaped + '[\\x27\\x22]\\s*,\\s*\\{\\s*target_org\\s*:'), procedure + ' must include tenant context');
    }
    for (const prohibited of mod.prohibited) assert.doesNotMatch(ui, prohibited);
  });
}
