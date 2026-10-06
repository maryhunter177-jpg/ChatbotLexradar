import test from 'node:test';
import assert from 'node:assert/strict';
import { isOptOutMessage, normalizeInboundEvent } from '../src/domain/inbound.js';

test('normaliza mensagem recebida individual da Evolution', () => {
  assert.deepEqual(normalizeInboundEvent({
    event: 'messages.upsert',
    data: {
      key: { id: 'm1', fromMe: false, remoteJid: '5511999991234@s.whatsapp.net' },
      pushName: 'Ana', message: { conversation: 'Não quero receber' }
    }
  }), { phone: '5511999991234', body: 'Não quero receber', messageId: 'm1', pushName: 'Ana' });
});

test('ignora mensagem propria, grupo e evento diferente', () => {
  assert.equal(normalizeInboundEvent({ event: 'messages.upsert', data: { key: { fromMe: true, remoteJid: '5511999991234@s.whatsapp.net' }, message: { conversation: 'oi' } } }), null);
  assert.equal(normalizeInboundEvent({ event: 'messages.upsert', data: { key: { fromMe: false, remoteJid: '123@g.us' }, message: { conversation: 'oi' } } }), null);
  assert.equal(normalizeInboundEvent({ event: 'connection.update' }), null);
});

test('reconhece somente pedidos claros de descadastro', () => {
  for (const value of ['SAIR', 'Pare.', 'Não quero receber', 'nao tenho interesse', 'DESCADASTRAR']) assert.equal(isOptOutMessage(value), true);
  for (const value of ['não quero perder o prazo', 'pode continuar', 'oi']) assert.equal(isOptOutMessage(value), false);
});
