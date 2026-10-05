import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileTemplate, INFRACTION_OPENING, renderTemplate, validateTemplate } from '../src/domain/template.js';

test('renderiza apenas variaveis permitidas', () => {
  const result = renderTemplate('Ola {{primeiro_nome}}, infracao {{codigo_infracao}}.', { name: 'Ana Silva', infractionCode: '123' });
  assert.equal(result, 'Ola Ana, infracao 123.');
});

test('bloqueia variavel desconhecida', () => {
  assert.throws(() => validateTemplate('Ola {{cpf}}'), /Variaveis desconhecidas/);
});

test('perfil de multa preserva abertura obrigatoria e permite continuacao', () => {
  const template = buildProfileTemplate('infraction_first_contact', 'Mariana', 'Caso queira mais informações, responda esta mensagem.');
  assert.ok(template.startsWith(INFRACTION_OPENING));
  assert.equal(
    renderTemplate(template, { name: 'Ana Silva', infractionDescription: 'por avançar o sinal vermelho' }, { senderName: 'Mariana' }),
    'Olá Ana, meu nome é Mariana. Identificamos através do Diário Oficial a multa por avançar o sinal vermelho.\n\nCaso queira mais informações, responda esta mensagem.'
  );
});

test('perfil de multa exige nome valido do atendente', () => {
  assert.throws(() => buildProfileTemplate('infraction_first_contact', 'X', ''), /Nome do atendente invalido/);
});
