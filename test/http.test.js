import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../src/app.js';

test('health e publico, API exige token e ponte usa token separado', async (t) => {
  const imported = [];
  const service = {
    status: () => ({ ok: 'admin' }),
    importLeads: (leads) => { imported.push(...leads); return { inserted: leads.length, updated: 0, ignored: 0 }; },
    recordWebhook: () => ({ duplicate: false })
  };
  const config = { adminToken: 'admin-secret', bridgeToken: 'bridge-secret', evolutionWebhookSecret: 'hook-secret' };
  const server = http.createServer(createHandler({ service, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  assert.equal((await fetch(`${base}/api/status`, { headers: { authorization: 'Bearer admin-secret' } })).status, 200);
  const bridgeResponse = await fetch(`${base}/api/v1/leads/import`, { method: 'POST', headers: { authorization: 'Bearer bridge-secret', 'content-type': 'application/json' }, body: JSON.stringify({ leads: [{ sourceId: '1' }] }) });
  assert.equal(bridgeResponse.status, 200);
  assert.equal(imported.length, 1);
});

test('webhook rejeita segredo incorreto', async (t) => {
  const service = { recordWebhook: () => ({ duplicate: false }) };
  const server = http.createServer(createHandler({ service, config: { adminToken: 'a', bridgeToken: 'b', evolutionWebhookSecret: 'correct' } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/evolution`, { method: 'POST', headers: { 'x-webhook-secret': 'wrong', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401);
});

test('rotas administrativas configuram linha principal e contingencia', async (t) => {
  const calls = [];
  const service = {
    setPrimaryInstance: (id) => { calls.push(['primary', id]); return { id, operationalMode: 'primary' }; },
    updateInstance: (id, body) => { calls.push(['configure', id, body]); return { id, ...body }; },
    recordWebhook: () => ({ duplicate: false })
  };
  const config = { adminToken: 'admin-secret', bridgeToken: 'bridge-secret', evolutionWebhookSecret: 'hook-secret' };
  const server = http.createServer(createHandler({ service, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/instances/i2/primary`, { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(`${base}/api/instances/i2/configure`, { method: 'POST', headers, body: JSON.stringify({ operationalMode: 'paused' }) })).status, 200);
  assert.deepEqual(calls, [['primary', 'i2'], ['configure', 'i2', { operationalMode: 'paused' }]]);
});

test('rota administrativa gera previa sem disparar mensagem', async (t) => {
  const calls = [];
  const service = {
    previewMessage: (...args) => {
      calls.push(args);
      return { leadId: args[0], messageProfile: 'infraction_first_contact', message: 'Mensagem pronta' };
    },
    recordWebhook: () => ({ duplicate: false })
  };
  const config = { adminToken: 'admin-secret', bridgeToken: 'bridge-secret', evolutionWebhookSecret: 'hook-secret' };
  const server = http.createServer(createHandler({ service, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/messages/preview`, {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ leadId: 'lead-1', senderName: 'Mariana', continuationTemplate: 'Continuacao' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, 'Mensagem pronta');
  assert.deepEqual(calls, [['lead-1', 'Mariana', 'Continuacao']]);
});
