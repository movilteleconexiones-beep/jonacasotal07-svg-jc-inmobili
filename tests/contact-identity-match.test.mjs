import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedContactName, sameContactIdentity } from '../src/core/contact-identity.ts';

const sample = (first_name, last_name, email) => ({ first_name, last_name, email });

test('same name + case-insensitive email identifies a CRM duplicate', () => {
  assert.equal(sameContactIdentity(
    sample(' Andrea ', 'De la   Cruz', '  ANDREA@EXAMPLE.TEST '),
    sample('andrea', 'de la cruz', 'andrea@example.test'),
  ), true);
});

test('separate people may share a family or company email', () => {
  assert.equal(sameContactIdentity(
    sample('Andrea', 'Cliente', 'familia@example.test'),
    sample('David', 'Cliente', 'FAMILIA@example.test'),
  ), false);
});

test('a full name in first_name matches a split first/last CRM record', () => {
  assert.equal(sameContactIdentity(
    sample('Laura Manual', null, 'laura@example.test'),
    sample('Laura', 'Manual', 'LAURA@example.test'),
  ), true);
});

test('a blank/missing email does not establish a safe duplicate identity', () => {
  assert.equal(sameContactIdentity(
    sample('Laura', 'Manual', null),
    sample('Laura', 'Manual', null),
  ), false);
  assert.equal(sameContactIdentity(
    sample('Laura', 'Manual', ' '),
    sample('Laura', 'Manual', 'laura@example.test'),
  ), false);
});

test('normalized name is stable across repeated whitespace and case', () => {
  assert.equal(normalizedContactName('  José  ', '  Pérez  '), 'josé pérez');
  assert.equal(normalizedContactName(' Ana   María ', ''), 'ana maría');
});

test('email values containing SQL LIKE wildcard characters are compared literally', () => {
  assert.equal(sameContactIdentity(
    sample('Laura', 'Manual', 'laura%_m@example.test'),
    sample('Laura', 'Manual', 'lauraxxm@example.test'),
  ), false);
});
