import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/infra/json-store.js';
import { BotService } from '../src/services/bot-service.js';

function fixture(dispatchEnabled = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lexbot-service-'));
  const store = new JsonStore(root); store.load();
  const calls = [];
  const evolution = { configured: () => true, createInstance: async () => ({}), connectionState: async () => ({ state: 'open' }), connect: async () => ({}), sendText: async (...args) => { calls.push(args); return { key: { id: 'msg-1' } }; } };
  return { root, store, calls, service: new BotService({ store, evolution, dispatchEnabled }) };
}

test('importacao e idempotente e nasce bloqueada para revisao', () => {
  const ctx = fixture();
  try {
    const lead = { schemaVersion: 1, sourceId: 'r1', dataMode: 'live', phones: ['11999991234'], name: 'Teste' };
    assert.deepEqual(ctx.service.importLeads([lead]), { inserted: 1, updated: 0, ignored: 0 });
    assert.deepEqual(ctx.service.importLeads([lead]), { inserted: 0, updated: 1, ignored: 0 });
    assert.equal(ctx.store.state.leads[0].contactPermission, 'pending_review');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('worker nao dispara quando a chave global esta desligada', async () => {
  const ctx = fixture(false);
  try {
    ctx.store.state.jobs.push({ id: 'j1', status: 'queued', availableAt: new Date(0).toISOString() });
    assert.equal(await ctx.service.tick(), false);
    assert.equal(ctx.calls.length, 0);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('campanha aprovada usa rodizio e registra envio', async () => {
  const ctx = fixture(true);
  try {
    await ctx.service.addInstance('chip_1');
    const instance = ctx.store.state.instances[0]; instance.state = 'open'; instance.dailyLimit = 10; ctx.store.save();
    ctx.service.importLeads([{ schemaVersion: 1, sourceId: 'r1', dataMode: 'live', phones: ['11999991234'], name: 'Ana Teste' }]);
    const lead = ctx.store.state.leads[0]; ctx.service.setLeadPermission([lead.id], 'approved', 'Fixture de homologacao');
    const campaign = ctx.service.createCampaign({ name: 'Teste', template: 'Ola {{primeiro_nome}}', instanceIds: [instance.id], minDelayMs: 1000, maxDelayMs: 1000 });
    ctx.service.activateCampaign(campaign.id, [lead.id]);
    assert.equal(await ctx.service.tick(), true);
    assert.equal(ctx.store.state.jobs[0].status, 'sent');
    assert.deepEqual(ctx.calls[0], ['chip_1', '5511999991234', 'Ola Ana']);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});
