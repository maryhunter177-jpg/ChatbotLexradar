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

test('campanha fora da janela nao bloqueia outra campanha elegivel', async () => {
  const ctx = fixture(true);
  try {
    await ctx.service.addInstance('principal');
    const instance = ctx.store.state.instances[0]; instance.state = 'open'; ctx.store.save();
    ctx.service.importLeads([
      { schemaVersion: 1, sourceId: 'agenda-1', dataMode: 'live', phones: ['11999991001'], name: 'Primeiro' },
      { schemaVersion: 1, sourceId: 'agenda-2', dataMode: 'live', phones: ['11999991002'], name: 'Segundo' }
    ]);
    const [firstLead, secondLead] = ctx.store.state.leads;
    ctx.service.setLeadPermission([firstLead.id, secondLead.id], 'approved', 'Fixture');
    const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date());
    const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayName];
    const blocked = ctx.service.createCampaign({
      name: 'Fora da janela', template: 'Primeira', instanceIds: [instance.id],
      deliverySchedule: { enabled: true, weekdays: [(weekday + 1) % 7], start: '00:00', end: '23:59' }
    });
    const allowed = ctx.service.createCampaign({ name: 'Permitida', template: 'Segunda', instanceIds: [instance.id] });
    ctx.service.activateCampaign(blocked.id, [firstLead.id]);
    ctx.service.activateCampaign(allowed.id, [secondLead.id]);
    assert.equal(await ctx.service.tick(), true);
    assert.equal(ctx.store.state.campaigns.find((item) => item.id === blocked.id).runtimeStatus, 'waiting_schedule');
    assert.equal(ctx.store.state.jobs.find((job) => job.campaignId === blocked.id).status, 'queued');
    assert.equal(ctx.store.state.jobs.find((job) => job.campaignId === allowed.id).status, 'sent');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('campanha aprovada usa linha principal e registra envio', async () => {
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

test('failover manual aguarda quando a linha principal esta indisponivel', async () => {
  const ctx = fixture(true);
  try {
    await ctx.service.addInstance('principal');
    await ctx.service.addInstance('reserva');
    const [principal, reserva] = ctx.store.state.instances;
    principal.state = 'unavailable'; reserva.state = 'open'; ctx.store.save();
    ctx.service.importLeads([{ schemaVersion: 1, sourceId: 'r2', dataMode: 'live', phones: ['11999990001'], name: 'Lead Teste' }]);
    const lead = ctx.store.state.leads[0]; ctx.service.setLeadPermission([lead.id], 'approved', 'Fixture');
    const campaign = ctx.service.createCampaign({
      name: 'Failover manual', template: 'Ola {{primeiro_nome}}', instanceIds: [principal.id, reserva.id],
      primaryInstanceId: principal.id, fallbackInstanceIds: [reserva.id], failoverMode: 'manual'
    });
    ctx.service.activateCampaign(campaign.id, [lead.id]);
    assert.equal(await ctx.service.tick(), false);
    assert.equal(ctx.calls.length, 0);
    assert.equal(ctx.store.state.campaigns[0].runtimeStatus, 'waiting_instance');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('failover automatico usa a primeira contingencia saudavel', async () => {
  const ctx = fixture(true);
  try {
    await ctx.service.addInstance('principal');
    await ctx.service.addInstance('reserva');
    const [principal, reserva] = ctx.store.state.instances;
    principal.state = 'unavailable'; reserva.state = 'open'; ctx.store.save();
    ctx.service.importLeads([{ schemaVersion: 1, sourceId: 'r3', dataMode: 'live', phones: ['11999990002'], name: 'Lead Teste' }]);
    const lead = ctx.store.state.leads[0]; ctx.service.setLeadPermission([lead.id], 'approved', 'Fixture');
    const campaign = ctx.service.createCampaign({
      name: 'Failover automatico', template: 'Ola {{primeiro_nome}}', instanceIds: [principal.id, reserva.id],
      primaryInstanceId: principal.id, fallbackInstanceIds: [reserva.id], failoverMode: 'automatic'
    });
    ctx.service.activateCampaign(campaign.id, [lead.id]);
    assert.equal(await ctx.service.tick(), true);
    assert.equal(ctx.store.state.jobs[0].status, 'sent');
    assert.equal(ctx.store.state.jobs[0].instanceId, reserva.id);
    assert.equal(ctx.store.state.campaigns[0].runtimeStatus, 'using_fallback');
    assert.equal(ctx.calls[0][0], 'reserva');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('promover uma linha para principal rebaixa a anterior para contingencia', async () => {
  const ctx = fixture();
  try {
    await ctx.service.addInstance('chip_1');
    await ctx.service.addInstance('chip_2');
    const [, second] = ctx.store.state.instances;
    ctx.service.setPrimaryInstance(second.id);
    assert.equal(ctx.store.state.instances[0].operationalMode, 'standby');
    assert.equal(ctx.store.state.instances[1].operationalMode, 'primary');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('campanha de multa usa abertura padrao e nome do atendente', async () => {
  const ctx = fixture(true);
  try {
    await ctx.service.addInstance('principal');
    const instance = ctx.store.state.instances[0]; instance.state = 'open'; ctx.store.save();
    ctx.service.importLeads([{
      schemaVersion: 1, sourceId: 'multa-1', dataMode: 'live', phones: ['11999990003'],
      name: 'Ana Silva', infractionDescription: 'por avançar o sinal vermelho'
    }]);
    const lead = ctx.store.state.leads[0]; ctx.service.setLeadPermission([lead.id], 'approved', 'Fixture');
    const campaign = ctx.service.createCampaign({
      name: 'Multas', messageProfile: 'infraction_first_contact', senderName: 'Mariana',
      continuationTemplate: 'Se desejar mais informações, responda esta mensagem.', instanceIds: [instance.id]
    });
    ctx.service.activateCampaign(campaign.id, [lead.id]);
    assert.equal(await ctx.service.tick(), true);
    assert.equal(ctx.calls[0][2], 'Olá Ana, meu nome é Mariana. Identificamos através do Diário Oficial a multa por avançar o sinal vermelho.\n\nSe desejar mais informações, responda esta mensagem.');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('pedido de descadastro bloqueia lead, cancela fila e impede nova aprovacao', async () => {
  const ctx = fixture(false);
  try {
    ctx.service.importLeads([{
      schemaVersion: 1, sourceId: 'optout-1', dataMode: 'live', phones: ['11999990004'],
      name: 'Ana Silva', infractionDescription: 'por avançar o sinal vermelho'
    }]);
    const lead = ctx.store.state.leads[0];
    ctx.store.state.jobs.push({ id: 'job-optout', leadId: lead.id, status: 'queued' });
    ctx.store.save();
    const event = {
      event: 'messages.upsert', instance: 'principal',
      data: { key: { id: 'msg-optout', fromMe: false, remoteJid: '5511999990004@s.whatsapp.net' }, message: { conversation: 'Não quero receber' } }
    };
    const result = ctx.service.recordWebhook(JSON.stringify(event), event);
    assert.equal(result.optOut.leadsBlocked, 1);
    assert.equal(result.optOut.jobsCancelled, 1);
    assert.equal(ctx.store.state.leads[0].contactPermission, 'blocked');
    assert.equal(ctx.store.state.jobs[0].status, 'cancelled');
    assert.throws(() => ctx.service.setLeadPermission([lead.id], 'approved', 'Tentativa'), /descadastro/);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('gera previa de multa sem enviar nem criar job', () => {
  const ctx = fixture(false);
  try {
    ctx.service.importLeads([{
      schemaVersion: 1, sourceId: 'previa-1', dataMode: 'live', phones: ['11999990004'],
      name: 'Ana Silva', infractionDescription: 'por avancar o sinal vermelho'
    }]);
    const lead = ctx.store.state.leads[0];
    const result = ctx.service.previewMessage(lead.id, 'Mariana', 'Podemos explicar as opcoes para voce.');
    assert.equal(result.leadId, lead.id);
    assert.equal(result.messageProfile, 'infraction_first_contact');
    assert.match(result.message, /Ana/);
    assert.match(result.message, /Mariana/);
    assert.match(result.message, /por avancar o sinal vermelho/);
    assert.match(result.message, /Podemos explicar as opcoes para voce/);
    assert.equal(result.characterCount, result.message.length);
    assert.equal(ctx.store.state.jobs.length, 0);
    assert.equal(ctx.calls.length, 0);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('previa de multa exige lead completo', () => {
  const ctx = fixture(false);
  try {
    ctx.service.importLeads([{
      schemaVersion: 1, sourceId: 'previa-incompleta', dataMode: 'live', phones: ['11999990005'], name: 'Ana'
    }]);
    const lead = ctx.store.state.leads[0];
    assert.throws(() => ctx.service.previewMessage(lead.id, 'Mariana', ''), /descricao da multa/);
    assert.throws(() => ctx.service.previewMessage('inexistente', 'Mariana', ''), /Lead nao encontrado/);
    assert.equal(ctx.calls.length, 0);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('ativacao congela a mensagem revisada no job', async () => {
  const ctx = fixture(true);
  try {
    await ctx.service.addInstance('principal');
    const instance = ctx.store.state.instances[0]; instance.state = 'open'; ctx.store.save();
    ctx.service.importLeads([{
      schemaVersion: 1, sourceId: 'snapshot-1', dataMode: 'live', phones: ['11999990006'],
      name: 'Ana Silva', infractionDescription: 'original'
    }]);
    const lead = ctx.store.state.leads[0]; ctx.service.setLeadPermission([lead.id], 'approved', 'Fixture');
    const campaign = ctx.service.createCampaign({
      name: 'Snapshot', messageProfile: 'infraction_first_contact', senderName: 'Mariana', instanceIds: [instance.id]
    });
    ctx.service.activateCampaign(campaign.id, [lead.id]);
    const approvedMessage = ctx.store.state.jobs[0].message;
    lead.infractionDescription = 'alterada depois da aprovacao'; ctx.store.save();
    await ctx.service.tick();
    assert.equal(ctx.calls[0][2], approvedMessage);
    assert.match(approvedMessage, /original/);
    assert.doesNotMatch(approvedMessage, /alterada depois/);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});
