import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createConsignmentAttemptManager,
} from '../src/core/consignment-submit-attempt.ts';

const form = {
  title: 'Apartamento en prueba de consignación',
  operation_type: 'RENT',
  property_type: 'APARTMENT',
  price: 1750000,
  lot_area: 72,
  built_area: 68,
  bedrooms: 2,
  bathrooms: 2,
  parking_spaces: 1,
  administration_fee: 190000,
  construction_year: null,
  state: 'Antioquia',
  city: 'Medellín',
  neighborhood: 'Sector de prueba',
  description: 'Solo datos de demostración',
  owner_name: 'Persona ficticia de prueba',
  owner_phone: '+57 300 000 0000',
  contact_consent: true,
};

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
    snapshot() { return [...data.entries()].map(([key, value]) => key + '=' + value).join('\n'); },
  };
}

test('identical consignment after a browser reload reuses UUID without persisting private fields', async () => {
  const storage = memoryStorage();
  const firstPage = createConsignmentAttemptManager();
  const id = await firstPage.getRequestId('sistema-inmobiliario-jco', form, storage);
  assert.match(id, /^[0-9a-f-]{36}$/);
  const secondPage = createConsignmentAttemptManager();
  assert.equal(await secondPage.getRequestId('sistema-inmobiliario-jco', { ...form }, storage), id);
  assert.doesNotMatch(storage.snapshot(), /Persona ficticia|300 000|Apartamento en prueba|Medellín|Sector de prueba/);
  assert.match(storage.snapshot(), /[a-f0-9]{64}/);
});

test('rapid concurrent calls converge to the same logical request', async () => {
  const attempts = createConsignmentAttemptManager();
  const storage = memoryStorage();
  const ids = await Promise.all(Array.from({ length: 10 }, () =>
    attempts.getRequestId('inmobiliaria-a', form, storage)));
  assert.equal(new Set(ids).size, 1);
});

test('tenant boundary and changed payload produce distinct idempotency IDs', async () => {
  const attempts = createConsignmentAttemptManager();
  const storage = memoryStorage();
  const first = await attempts.getRequestId('inmobiliaria-a', form, storage);
  const otherTenant = await attempts.getRequestId('inmobiliaria-b', form, storage);
  const edited = await attempts.getRequestId('inmobiliaria-a', { ...form, price: 1750001 }, storage);
  assert.notEqual(first, otherTenant);
  assert.notEqual(first, edited);
  assert.equal(await attempts.getRequestId('inmobiliaria-a', { ...form, price: 1750001 }, storage), edited);
});

test('a confirmed consignment, explicitly closed, starts a new legitimate request', async () => {
  const attempts = createConsignmentAttemptManager();
  const storage = memoryStorage();
  const first = await attempts.getRequestId('inmobiliaria-a', form, storage);
  attempts.clear('inmobiliaria-a', storage);
  assert.equal(storage.data.size, 0);
  const second = await attempts.getRequestId('inmobiliaria-a', form, storage);
  assert.notEqual(second, first);
});

test('blocked storage preserves same-tab retries without leaking or resurrecting old UUID', async () => {
  const data = new Map();
  let blockWrites = false;
  let blockRemoval = false;
  const storage = {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { if (blockWrites) throw new Error('quota'); data.set(key, value); },
    removeItem(key) { if (blockRemoval) throw new Error('denied'); data.delete(key); },
  };
  const manager = createConsignmentAttemptManager();
  const original = await manager.getRequestId('inmobiliaria-a', form, storage);
  blockWrites = true;
  const edited = await manager.getRequestId('inmobiliaria-a', { ...form, price: 2000000 }, storage);
  assert.notEqual(edited, original);
  assert.equal(await manager.getRequestId('inmobiliaria-a', { ...form, price: 2000000 }, storage), edited);
  blockRemoval = true;
  manager.clear('inmobiliaria-a', storage);
  const third = await manager.getRequestId('inmobiliaria-a', { ...form, price: 2000000 }, storage);
  assert.notEqual(third, edited);
  assert.notEqual(third, original);
});

test('malformed or attacker-controlled storage entries are never trusted', async () => {
  const storage = memoryStorage();
  const manager = createConsignmentAttemptManager();
  storage.setItem('inmojco:consignment-attempt:inmobiliaria-a', JSON.stringify({
    fingerprint: '0'.repeat(64), requestId: 'invalid',
  }));
  const id = await manager.getRequestId('inmobiliaria-a', form, storage);
  assert.notEqual(id, 'invalid');
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('modal locks before async hashing and clears only after confirmed close', () => {
  const modal = readFileSync(new URL('../src/components/SubmitPropertyModal.tsx', import.meta.url), 'utf8');
  const submit = modal.slice(modal.indexOf('const handleSubmit = async'), modal.indexOf('const resetAndClose'));
  assert.match(submit, /submitLock\.current = true;\s*setSubmitting\(true\);/);
  assert.ok(submit.indexOf('submitLock.current = true;') < submit.indexOf('await getConsignmentRequestId('));
  assert.match(submit, /await getConsignmentRequestId\(site\.slug, input\)/);
  assert.match(submit, /await submitPropertyConsignment\(site\.slug, requestId, input\)/);
  assert.match(modal, /if \(createdCode\) clearConsignmentAttempt\(site\?\.slug \|\| publicSiteSlug\)/);
  assert.doesNotMatch(submit, /crypto\.randomUUID\(\)/);
});

test('active backend contract allows replay of same UUID but rejects changed payload', () => {
  // Pinned review of submit_property_consignment(text,uuid,jsonb). No SQL run.
  const sql = readFileSync(
    new URL('../supabase/migrations/20261010212630_property_consignment_intake.sql', import.meta.url),'utf8');
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /request_id = p_request_id/);
  assert.match(sql, /consignment_request_conflict/);
  assert.match(sql, /return jsonb_build_object\('reference', v_existing\.reference\)/i);
});
