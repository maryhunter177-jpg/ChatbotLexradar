import test from 'node:test';
import assert from 'node:assert/strict';
import { isWithinDeliverySchedule, normalizeDeliverySchedule } from '../src/domain/schedule.js';

test('agenda desabilitada nao restringe o worker', () => {
  assert.equal(isWithinDeliverySchedule(new Date('2026-10-04T03:00:00Z'), { enabled: false }), true);
});

test('agenda respeita dia, horario e fuso de Sao Paulo', () => {
  const schedule = normalizeDeliverySchedule({ enabled: true, weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' });
  assert.equal(isWithinDeliverySchedule(new Date('2026-10-05T15:00:00Z'), schedule), true);
  assert.equal(isWithinDeliverySchedule(new Date('2026-10-05T22:00:00Z'), schedule), false);
  assert.equal(isWithinDeliverySchedule(new Date('2026-10-04T15:00:00Z'), schedule), false);
});

test('rejeita janela, dia e fuso invalidos', () => {
  assert.throws(() => normalizeDeliverySchedule({ enabled: true, start: '18:00', end: '09:00' }), /Janela/);
  assert.throws(() => normalizeDeliverySchedule({ enabled: true, weekdays: [8] }), /Dias/);
  assert.throws(() => normalizeDeliverySchedule({ enabled: true, timeZone: 'Invalid/Zone' }), /Fuso/);
});
