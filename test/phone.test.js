import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrazilianMobile, uniquePhones } from '../src/domain/phone.js';

test('normaliza celular brasileiro sem expor formatacao', () => {
  assert.equal(normalizeBrazilianMobile('(11) 99999-1234'), '5511999991234');
  assert.deepEqual(uniquePhones(['(11) 99999-1234', '55 11 99999-1234', 'invalido']), ['5511999991234']);
});
