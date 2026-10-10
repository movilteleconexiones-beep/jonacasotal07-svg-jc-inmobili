import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePropertyConsignment, consignmentErrorMessage } from '../src/core/property-consignment.ts';

const valid = {
  title: 'Apartamento de prueba', operation_type: 'SALE', property_type: 'APARTMENT',
  price: 250000000, lot_area: 65.25, built_area: 65.25, bedrooms: 0, bathrooms: 1.5,
  parking_spaces: 0, administration_fee: 0, construction_year: null,
  state: 'Antioquia', city: 'Medellín', neighborhood: '', description: '',
  owner_name: 'Prueba técnica', owner_phone: '+57 (000) 000-0000', contact_consent: true,
};

test('accepts explicitly declared zero counts, decimal areas, international phone and unknown year', () => {
  assert.equal(validatePropertyConsignment(valid, 2026), null);
});

test('rejects invalid or unbounded prices, areas and counts', () => {
  for (const patch of [
    { price: 0 }, { price: Infinity }, { price: NaN }, { price: 1e14 },
    { price: 1.234 }, { built_area: 0 }, { lot_area: -1 }, { lot_area: 1e9 },
    { bedrooms: 1.5 }, { bedrooms: 501 }, { bathrooms: 1.3 }, { bathrooms: NaN },
    { parking_spaces: -1 }, { parking_spaces: 5001 }, { administration_fee: -1 },
  ]) assert.notEqual(validatePropertyConsignment({ ...valid, ...patch }, 2026), null, JSON.stringify(patch));
});

test('rejects fake dates, unsupported enums, overlong text and invalid contact data', () => {
  for (const patch of [
    { construction_year: 2027 }, { construction_year: 1799 }, { construction_year: 2020.5 },
    { title: 'abcd' }, { title: 'a'.repeat(161) }, { description: 'a'.repeat(2001) },
    { owner_name: 'ab' }, { owner_phone: '555' }, { owner_phone: 'ext 3001234567' },
    { owner_phone: '1'.repeat(16) }, { state: '' }, { city: '' }, { neighborhood: 'a'.repeat(161) },
    { operation_type: 'SOLD' }, { property_type: 'INVALID' }, { contact_consent: false },
  ]) assert.notEqual(validatePropertyConsignment({ ...valid, ...patch }, 2026), null, JSON.stringify(patch));
});

test('does not expose internal server error messages to visitors', () => {
  assert.doesNotMatch(consignmentErrorMessage({ message: 'database credential internal-secret' }), /internal-secret/);
  assert.match(consignmentErrorMessage({ message: 'intake_rate_limited' }), /límite/);
  assert.match(consignmentErrorMessage({ message: 'consignment_permission_denied' }), /permisos/);
});
