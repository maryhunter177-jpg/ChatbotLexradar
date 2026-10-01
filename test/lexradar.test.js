import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEligibleLeads } from '../src/integrations/lexradar.js';

test('extrai somente resultado live finalizado com telefone', () => {
  const state = { settings: { mode: 'live' }, records: [
    { id: 'ok', batchId: 'b1', status: 'Finalizado', type: 'infractions', name: 'Pessoa Teste', phones: ['11999991234'], cpf: 'nao-deve-sair', plate: 'ABC1D23' },
    { id: 'demo', dataMode: 'demo', status: 'Finalizado', phones: ['11999991234'] },
    { id: 'pending', status: 'Aguardando consulta', phones: ['11999991234'] }
  ] };
  const leads = extractEligibleLeads(state);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].sourceId, 'ok');
  assert.equal('cpf' in leads[0], false);
  assert.equal('plate' in leads[0], false);
});
