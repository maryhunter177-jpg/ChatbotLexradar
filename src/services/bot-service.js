import crypto from 'node:crypto';
import { uniquePhones, maskPhone } from '../domain/phone.js';
import { renderTemplate, validateTemplate } from '../domain/template.js';

const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const clean = (value, max = 300) => String(value || '').trim().slice(0, max);

function audit(state, action, details = {}) {
  state.audit.unshift({ id: id(), at: nowIso(), action, ...details });
  state.audit = state.audit.slice(0, 2000);
}

function publicLead(lead) {
  return { ...lead, phones: lead.phones.map(maskPhone) };
}

export class BotService {
  constructor({ store, evolution, dispatchEnabled = false }) {
    this.store = store;
    this.evolution = evolution;
    this.dispatchEnabled = dispatchEnabled;
    this.processing = false;
  }

  status() {
    const state = this.store.state;
    const counts = (items, field) => Object.fromEntries([...new Set(items.map((item) => item[field]))].map((key) => [key, items.filter((item) => item[field] === key).length]));
    return {
      dispatchEnabled: this.dispatchEnabled,
      evolutionConfigured: this.evolution.configured(),
      instances: state.instances,
      leads: { total: state.leads.length, byPermission: counts(state.leads, 'contactPermission') },
      campaigns: state.campaigns,
      jobs: counts(state.jobs, 'status'),
      recentAudit: state.audit.slice(0, 25)
    };
  }

  listLeads() { return this.store.state.leads.map(publicLead); }

  importLeads(items) {
    if (!Array.isArray(items) || items.length > 10000) throw new Error('Envie uma lista de ate 10000 leads.');
    let inserted = 0; let updated = 0; let ignored = 0;
    this.store.update((state) => {
      for (const item of items) {
        if (item?.schemaVersion !== 1 || item?.dataMode !== 'live' || !clean(item.sourceId, 100)) { ignored += 1; continue; }
        const phones = uniquePhones(item.phones || []);
        if (!phones.length) { ignored += 1; continue; }
        const sourceKey = `lexradar:${clean(item.sourceId, 100)}`;
        const existing = state.leads.find((lead) => lead.sourceKey === sourceKey);
        const common = {
          sourceKey, sourceId: clean(item.sourceId, 100), sourceBatchId: clean(item.sourceBatchId, 100),
          type: item.type === 'process' ? 'process' : 'infraction', name: clean(item.name, 200), phones,
          classification: clean(item.classification, 50), infractionCode: clean(item.infractionCode, 50),
          infractionDescription: clean(item.infractionDescription, 500), processNumber: clean(item.processNumber, 100),
          sourceFile: clean(item.sourceFile, 260), sourceUpdatedAt: clean(item.sourceUpdatedAt, 50), dataMode: 'live', updatedAt: nowIso()
        };
        if (existing) { Object.assign(existing, common); updated += 1; }
        else { state.leads.push({ id: id(), ...common, contactPermission: 'pending_review', permissionReason: '', createdAt: nowIso() }); inserted += 1; }
      }
      audit(state, 'leads.imported', { inserted, updated, ignored });
    });
    return { inserted, updated, ignored };
  }

  setLeadPermission(ids, permission, reason) {
    if (!['approved', 'blocked', 'pending_review'].includes(permission)) throw new Error('Permissao invalida.');
    if (!Array.isArray(ids) || !ids.length) throw new Error('Selecione ao menos um lead.');
    let changed = 0;
    this.store.update((state) => {
      for (const lead of state.leads) if (ids.includes(lead.id)) { lead.contactPermission = permission; lead.permissionReason = clean(reason, 500); lead.permissionUpdatedAt = nowIso(); changed += 1; }
      audit(state, 'leads.permission-changed', { permission, changed });
    });
    return { changed };
  }

  async addInstance(name) {
    const safeName = clean(name, 60);
    if (!/^[a-zA-Z0-9_-]{2,60}$/.test(safeName)) throw new Error('Nome de instancia invalido.');
    if (this.store.state.instances.some((item) => item.name === safeName)) throw new Error('Instancia ja cadastrada.');
    const response = await this.evolution.createInstance(safeName);
    const instance = { id: id(), name: safeName, enabled: true, state: 'created', dailyLimit: 50, sentToday: 0, sentDay: '', lastUsedAt: '', createdAt: nowIso() };
    this.store.update((state) => { state.instances.push(instance); audit(state, 'instance.created', { instance: safeName }); });
    return { instance, evolution: response };
  }

  async qr(name) { return this.evolution.connect(name); }

  async refreshInstances() {
    const results = [];
    for (const instance of this.store.state.instances) {
      try {
        const response = await this.evolution.connectionState(instance.name);
        const state = response?.instance?.state || response?.state || 'unknown';
        instance.state = state; instance.lastHealthAt = nowIso(); instance.lastError = '';
        results.push({ name: instance.name, state });
      } catch (error) {
        instance.state = 'unavailable'; instance.lastHealthAt = nowIso(); instance.lastError = error.message;
        results.push({ name: instance.name, state: 'unavailable' });
      }
    }
    this.store.save();
    return results;
  }

  createCampaign(input) {
    const template = validateTemplate(input?.template);
    const minDelayMs = Math.max(1000, Number(input?.minDelayMs) || 30000);
    const maxDelayMs = Math.max(minDelayMs, Number(input?.maxDelayMs) || 90000);
    if (maxDelayMs > 86400000) throw new Error('Delay maximo excede 24 horas.');
    const instanceIds = Array.isArray(input?.instanceIds) ? input.instanceIds : [];
    if (!instanceIds.length) throw new Error('Selecione ao menos uma instancia.');
    if (instanceIds.some((value) => !this.store.state.instances.some((instance) => instance.id === value))) throw new Error('Instancia desconhecida.');
    const campaign = { id: id(), name: clean(input.name, 120) || 'Campanha sem nome', template, minDelayMs, maxDelayMs, instanceIds, status: 'draft', createdAt: nowIso(), nextDispatchAt: '' };
    this.store.update((state) => { state.campaigns.push(campaign); audit(state, 'campaign.created', { campaignId: campaign.id }); });
    return campaign;
  }

  activateCampaign(campaignId, leadIds) {
    let created = 0;
    this.store.update((state) => {
      const campaign = state.campaigns.find((item) => item.id === campaignId);
      if (!campaign) throw new Error('Campanha nao encontrada.');
      const selected = new Set(Array.isArray(leadIds) ? leadIds : []);
      for (const lead of state.leads) {
        if ((selected.size && !selected.has(lead.id)) || lead.contactPermission !== 'approved') continue;
        const phone = lead.phones[0];
        const key = `${campaign.id}:${lead.id}:${phone}`;
        if (state.jobs.some((job) => job.idempotencyKey === key)) continue;
        state.jobs.push({ id: id(), idempotencyKey: key, campaignId: campaign.id, leadId: lead.id, phone, status: 'queued', attempts: 0, availableAt: nowIso(), createdAt: nowIso() });
        created += 1;
      }
      if (!created) throw new Error('Nenhum lead aprovado e inedito foi selecionado.');
      campaign.status = 'active'; campaign.activatedAt = nowIso();
      audit(state, 'campaign.activated', { campaignId, jobs: created });
    });
    return { created };
  }

  pauseCampaign(campaignId) {
    this.store.update((state) => { const campaign = state.campaigns.find((item) => item.id === campaignId); if (!campaign) throw new Error('Campanha nao encontrada.'); campaign.status = 'paused'; audit(state, 'campaign.paused', { campaignId }); });
  }

  chooseInstance(campaign) {
    const day = new Date().toISOString().slice(0, 10);
    const candidates = this.store.state.instances.filter((item) => campaign.instanceIds.includes(item.id) && item.enabled && ['open', 'connected'].includes(item.state));
    for (const item of candidates) if (item.sentDay !== day) { item.sentDay = day; item.sentToday = 0; }
    return candidates.filter((item) => item.sentToday < item.dailyLimit).sort((a, b) => String(a.lastUsedAt).localeCompare(String(b.lastUsedAt)))[0];
  }

  async tick() {
    if (this.processing || !this.dispatchEnabled) return false;
    const due = this.store.state.jobs.find((job) => job.status === 'queued' && new Date(job.availableAt).getTime() <= Date.now());
    if (!due) return false;
    const campaign = this.store.state.campaigns.find((item) => item.id === due.campaignId);
    if (!campaign || campaign.status !== 'active' || (campaign.nextDispatchAt && new Date(campaign.nextDispatchAt).getTime() > Date.now())) return false;
    const lead = this.store.state.leads.find((item) => item.id === due.leadId);
    if (!lead || lead.contactPermission !== 'approved') { due.status = 'blocked'; due.error = 'Lead sem permissao vigente.'; this.store.save(); return true; }
    const instance = this.chooseInstance(campaign);
    if (!instance) return false;
    this.processing = true;
    due.status = 'sending'; due.instanceId = instance.id; due.attempts += 1; due.startedAt = nowIso(); this.store.save();
    try {
      const message = renderTemplate(campaign.template, lead);
      const response = await this.evolution.sendText(instance.name, due.phone, message);
      due.status = 'sent'; due.sentAt = nowIso(); due.providerMessageId = clean(response?.key?.id || response?.messageId, 200);
      instance.sentToday += 1; instance.lastUsedAt = nowIso();
      const delay = campaign.minDelayMs + Math.floor(Math.random() * (campaign.maxDelayMs - campaign.minDelayMs + 1));
      campaign.nextDispatchAt = new Date(Date.now() + delay).toISOString();
      audit(this.store.state, 'message.sent', { jobId: due.id, campaignId: campaign.id, instance: instance.name });
    } catch (error) {
      due.error = clean(error.message, 500);
      if (error.permanent || due.attempts >= 3) due.status = 'failed';
      else { due.status = 'queued'; due.availableAt = new Date(Date.now() + (30000 * (2 ** (due.attempts - 1)))).toISOString(); }
      audit(this.store.state, 'message.failed', { jobId: due.id, permanent: Boolean(error.permanent) });
    } finally { this.store.save(); this.processing = false; }
    return true;
  }

  recordWebhook(raw, event) {
    const eventId = crypto.createHash('sha256').update(raw).digest('hex');
    if (this.store.state.webhookEvents.some((item) => item.id === eventId)) return { duplicate: true };
    this.store.update((state) => {
      state.webhookEvents.unshift({ id: eventId, at: nowIso(), event: clean(event?.event, 100), instance: clean(event?.instance, 100) });
      state.webhookEvents = state.webhookEvents.slice(0, 5000);
      audit(state, 'webhook.received', { eventId, event: clean(event?.event, 100) });
    });
    return { duplicate: false };
  }
}
