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
