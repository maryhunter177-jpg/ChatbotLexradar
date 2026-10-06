import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafeDestination, syncBridge } from '../src/bridge.js';

function stateFile(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexradar-bridge-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ settings: { mode: 'live' }, records }));
  return { dir, file };
}

const baseConfig = (file) => ({
  bridgeToken: 'segredo-local', lexradarStatePath: file,
  bridgeMaxStateBytes: 1024 * 1024, bridgeMaxLeads: 100,
  botRemoteUrl: 'http://127.0.0.1:3100', bridgeAllowRemote: false,
  httpTimeoutMs: 1000
});

test('ponte exige loopback por padrao e HTTPS quando remoto foi autorizado', () => {
  assert.equal(assertSafeDestination('http://127.0.0.1:3100').hostname, '127.0.0.1');
  assert.throws(() => assertSafeDestination('http://vps.example:3100'), /tunel local/);
  assert.throws(() => assertSafeDestination('http://vps.example:3100', true), /HTTPS/);
  assert.equal(assertSafeDestination('https://bot.example', true).protocol, 'https:');
});

test('dry-run valida e conta sem exigir token nem fazer requisicao', async (t) => {
  const { dir, file } = stateFile([{ id: '1', status: 'Finalizado', phones: ['11999991234'] }]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let called = false;
  const result = await syncBridge({ ...baseConfig(file), bridgeToken: '' }, { dryRun: true, fetchImpl: async () => { called = true; } });
  assert.deepEqual(result, { event: 'bridge.validated', eligible: 1 });
  assert.equal(called, false);
});

test('sincronizacao envia DTO minimo pelo endpoint local autenticado', async (t) => {
  const { dir, file } = stateFile([{ id: 'abc', status: 'Finalizado', name: 'Pessoa', phones: ['11999991234'], cpf: 'nao-enviar' }]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let request;
  const result = await syncBridge(baseConfig(file), { fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ imported: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(request.url, 'http://127.0.0.1:3100/api/v1/leads/import');
  assert.equal(request.options.headers.authorization, 'Bearer segredo-local');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.leads[0].sourceId, 'abc');
  assert.equal('cpf' in payload.leads[0], false);
  assert.equal(result.imported, 1);
});
