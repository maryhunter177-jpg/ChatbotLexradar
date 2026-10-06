import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverLexRadarStatePath, extractEligibleLeads, readLexRadarState } from '../src/integrations/lexradar.js';

test('descobre a base pelo marcador oficial do LexRadar em outro computador', () => {
  const appData = 'C:\\Users\\Cliente\\AppData\\Roaming';
  const marker = path.win32.join(appData, 'lexradar', 'data-root-location.json');
  const fsApi = {
    existsSync: (target) => target === marker,
    readFileSync: (target) => {
      assert.equal(target, marker);
      return JSON.stringify({ version: 1, dataRoot: 'E:\\LexRadar-Dados' });
    }
  };
  assert.equal(discoverLexRadarStatePath({ platform: 'win32', appData, homeDir: 'C:\\Users\\Cliente', fsApi, pathApi: path.win32 }), 'E:\\LexRadar-Dados\\data\\lexradar-data.json');
});

test('usa caminho explicito quando configurado e fallback de Documentos sem marcador', () => {
  assert.equal(discoverLexRadarStatePath({ explicitPath: 'F:\\Base\\estado.json', platform: 'win32', pathApi: path.win32 }), 'F:\\Base\\estado.json');
  const expected = 'C:\\Users\\Cliente\\Documents\\LexRadar-Dados\\data\\lexradar-data.json';
  const fsApi = { existsSync: (target) => target === expected };
  assert.equal(discoverLexRadarStatePath({ platform: 'win32', appData: '', homeDir: 'C:\\Users\\Cliente', fsApi, pathApi: path.win32 }), expected);
});

test('falha visivelmente quando o marcador do LexRadar esta invalido', () => {
  const appData = 'C:\\Users\\Cliente\\AppData\\Roaming';
  const marker = path.win32.join(appData, 'lexradar', 'data-root-location.json');
  const fsApi = { existsSync: (target) => target === marker, readFileSync: () => '{' };
  assert.throws(() => discoverLexRadarStatePath({ platform: 'win32', appData, fsApi, pathApi: path.win32 }), /local de dados/);
});

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
