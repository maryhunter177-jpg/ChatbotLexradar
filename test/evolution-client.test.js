import test from 'node:test';
import assert from 'node:assert/strict';
import { EvolutionClient } from '../src/integrations/evolution-client.js';

test('cria instancia com webhook autenticado e eventos minimos', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const client = new EvolutionClient({
    baseUrl: 'http://evolution:8080', apiKey: 'api-test',
    webhookUrl: 'http://bot:3100/webhooks/evolution', webhookSecret: 'hook-test', fetchImpl
  });
  await client.createInstance('chip_1');
  assert.equal(request.url, 'http://evolution:8080/instance/create');
  assert.equal(request.options.headers.apikey, 'api-test');
  assert.equal(request.options.headers.origin, 'http://127.0.0.1:3100');
  assert.equal(request.options.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(request.body.webhook.headers['x-webhook-secret'], 'hook-test');
  assert.deepEqual(request.body.webhook.events, ['QRCODE_UPDATED', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE_UPDATE', 'CONNECTION_UPDATE']);
});
