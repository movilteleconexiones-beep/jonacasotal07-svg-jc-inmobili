import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { updatePublicInquiryView } from '../src/core/public-inquiry-view.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('a return visit to agency A cannot accept stale results from the earlier A visit', () => {
  const first = { slug: 'agency-a', epoch: 0 };
  assert.strictEqual(updatePublicInquiryView(first, 'agency-a'), first);
  const second = updatePublicInquiryView(first, 'agency-b');
  const third = updatePublicInquiryView(second, 'agency-a');
  assert.deepEqual([second.epoch, third.epoch], [1, 2]);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first, third);
  assert.strictEqual(updatePublicInquiryView(third, 'agency-a'), third);
});

test('public inquiry clears all visitor PII and consent on agency switch', () => {
  const start = app.indexOf('React.useLayoutEffect(() => {\n    // Never carry personally identifying form fields');
  const end = app.indexOf('}, [tenantSlug]);', start);
  assert.ok(start > -1 && end > start, 'tenant-change effect must be scoped to tenantSlug');
  const effect = app.slice(start, end);
  for (const expression of [
    "setContactName('')", "setContactEmail('')", "setContactPhone('')",
    "setContactService('Consulta general')", "setContactNotes('')", "setContactTrap('')",
    'setScheduledVisitsLog([])',
    'setContactSubmitted(false)', 'setContactConsent(false)', "setContactError('')",
  ]) assert.ok(effect.includes(expression), 'missing privacy reset: ' + expression);
});

test('in-flight CRM success and errors from previous tenant cannot update the new page', () => {
  const start = app.indexOf('const handleContactSubmit = async');
  const end = app.indexOf('if (isSuperAdminRoute)', start);
  assert.ok(start > 0 && end > start);
  const handler = app.slice(start, end);
  assert.match(handler, /const submittedView = publicInquiryView\.current/);
  assert.match(handler, /const submittedTenantSlug = tenantSlug/);
  assert.match(handler, /if \(publicInquiryView\.current !== submittedView\) return;\s*setContactSubmitted\(true\)/);
  assert.match(handler, /if \(publicInquiryView\.current === submittedView\) \{\s*setContactError\(/);
  assert.match(handler, /if \(useReplaySafeCrm\) clearPublicInquiryAttempt\(submittedTenantSlug\)/);
  assert.match(handler, /contactSubmitInFlight\.current = false;\s*setContactBusy\(false\)/);
});

test('portal branding still resolves from server-scoped public tenant, not previous membership', () => {
  assert.match(app, /const publicInquiryView = React\.useRef\(\{ slug: tenantSlug, epoch: 0 \}\)/);
  assert.match(app, /publicInquiryView\.current = updatePublicInquiryView\(publicInquiryView\.current, tenantSlug\)/);
  assert.match(app, /const branding: TenantBrandingState = \{/);
  assert.match(app, /companyName: publicCatalog\.brand\?\.companyName \|\| fallbackCompanyName/);
});
