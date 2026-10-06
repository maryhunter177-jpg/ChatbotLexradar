import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractEligibleLeads, readLexRadarState } from '../src/integrations/lexradar.js';

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

test('aceita status concluido com acento e limita o tamanho de campos', () => {
  const leads = extractEligibleLeads({ settings: { mode: 'live' }, records: [
    { id: '1', status: 'Reutilizado do histórico', phones: ['11999991234'], infractionDescription: 'x'.repeat(3000) }
  ] });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].infractionDescription.length, 2000);
});

test('bloqueia lote acima do limite configurado', () => {
  const records = [1, 2].map((id) => ({ id: String(id), status: 'Finalizado', phones: ['11999991234'] }));
  assert.throws(() => extractEligibleLeads({ settings: { mode: 'live' }, records }, { maxLeads: 1 }), /limite configurado/);
});

test('leitura rejeita JSON incompleto e arquivo acima do limite', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexradar-state-'));
  const file = path.join(dir, 'state.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(file, '{');
  assert.throws(() => readLexRadarState(file), /JSON invalido/);
  fs.writeFileSync(file, JSON.stringify({ settings: {}, records: [] }));
  assert.throws(() => readLexRadarState(file, { maxBytes: 2 }), /excede/);
});
