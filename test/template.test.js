import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, validateTemplate } from '../src/domain/template.js';

test('renderiza apenas variaveis permitidas', () => {
  const result = renderTemplate('Ola {{primeiro_nome}}, infracao {{codigo_infracao}}.', { name: 'Ana Silva', infractionCode: '123' });
  assert.equal(result, 'Ola Ana, infracao 123.');
});

test('bloqueia variavel desconhecida', () => {
  assert.throws(() => validateTemplate('Ola {{cpf}}'), /Variaveis desconhecidas/);
});
