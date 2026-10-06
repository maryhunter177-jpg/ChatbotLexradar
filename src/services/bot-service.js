import crypto from 'node:crypto';
import { uniquePhones, maskPhone } from '../domain/phone.js';
import { buildProfileTemplate, renderTemplate, validateTemplate } from '../domain/template.js';
import { isOptOutMessage, normalizeInboundEvent } from '../domain/inbound.js';
import { isWithinDeliverySchedule, normalizeDeliverySchedule } from '../domain/schedule.js';

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

function assertInfractionLeadReady(lead) {
  if (lead.type !== 'infraction') throw new Error('O perfil de primeiro contato exige um lead de multa.');
  if (!clean(lead.name, 200)) throw new Error('O lead precisa ter nome para gerar a mensagem.');
  if (!clean(lead.infractionDescription, 500)) throw new Error('O lead precisa ter a descricao da multa.');
}

function instanceDefaults(instance, index = 0) {
  return {
    ...instance,
    label: clean(instance.label || instance.name, 80),
    enabled: instance.enabled !== false,
    operationalMode: ['primary', 'standby', 'paused'].includes(instance.operationalMode)
      ? instance.operationalMode
      : (index === 0 ? 'primary' : 'standby'),
    priority: Number.isInteger(instance.priority) ? instance.priority : index,
    dailyLimit: Number.isInteger(instance.dailyLimit) ? instance.dailyLimit : 50,
    sentToday: Number(instance.sentToday) || 0,
    sentDay: instance.sentDay || '',
    lastUsedAt: instance.lastUsedAt || ''
  };
}

function healthy(instance) {
  return instance.enabled && instance.operationalMode !== 'paused' && ['open', 'connected'].includes(instance.state);
}

export class BotService {
  constructor({ store, evolution, dispatchEnabled = false }) {
    this.store = store;
    this.evolution = evolution;
    this.dispatchEnabled = dispatchEnabled;
    this.processing = false;
    const normalized = this.store.state.instances.map(instanceDefaults);
    if (JSON.stringify(normalized) !== JSON.stringify(this.store.state.instances)) {
      this.store.state.instances = normalized;
      this.store.save();
    }
  }

  status() {
    const state = this.store.state;
    const counts = (items, field) => Object.fromEntries([...new Set(items.map((item) => item[field]))].map((key) => [key, items.filter((item) => item[field] === key).length]));
    const lastImport = state.audit.find((item) => item.action === 'leads.imported');
    return {
      dispatchEnabled: this.dispatchEnabled,
      evolutionConfigured: this.evolution.configured(),
      lexradarIntegration: {
        synchronized: Boolean(lastImport),
        lastSyncAt: lastImport?.at || '',
        inserted: Number(lastImport?.inserted) || 0,
        updated: Number(lastImport?.updated) || 0,
        ignored: Number(lastImport?.ignored) || 0
      },
      instances: state.instances,
      leads: { total: state.leads.length, byPermission: counts(state.leads, 'contactPermission') },
      campaigns: state.campaigns,
      jobs: counts(state.jobs, 'status'),
      suppressedPhones: state.suppressedPhones.length,
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
        const suppressed = phones.some((phone) => state.suppressedPhones.includes(phone));
        if (existing) {
          Object.assign(existing, common);
          if (suppressed) { existing.contactPermission = 'blocked'; existing.permissionReason = 'Descadastro solicitado pelo telefone.'; }
          updated += 1;
        } else {
          state.leads.push({
            id: id(), ...common,
            contactPermission: suppressed ? 'blocked' : 'pending_review',
            permissionReason: suppressed ? 'Descadastro solicitado pelo telefone.' : '', createdAt: nowIso()
          });
          inserted += 1;
        }
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
      if (permission === 'approved' && state.leads.some((lead) => ids.includes(lead.id) && lead.phones.some((phone) => state.suppressedPhones.includes(phone)))) throw new Error('Lead com descadastro nao pode ser aprovado.');
      for (const lead of state.leads) if (ids.includes(lead.id)) { lead.contactPermission = permission; lead.permissionReason = clean(reason, 500); lead.permissionUpdatedAt = nowIso(); changed += 1; }
      audit(state, 'leads.permission-changed', { permission, changed });
    });
    return { changed };
  }

  previewMessage(leadId, senderName, continuationTemplate = '') {
    const lead = this.store.state.leads.find((item) => item.id === leadId);
    if (!lead) throw new Error('Lead nao encontrado.');
    assertInfractionLeadReady(lead);
    const template = buildProfileTemplate('infraction_first_contact', senderName, continuationTemplate);
    const message = renderTemplate(template, lead, { senderName: clean(senderName, 80) });
    return {
      leadId: lead.id,
      messageProfile: 'infraction_first_contact',
      template,
      message,
      characterCount: message.length
    };
  }

  async addInstance(name) {
    const safeName = clean(name, 60);
    if (!/^[a-zA-Z0-9_-]{2,60}$/.test(safeName)) throw new Error('Nome de instancia invalido.');
    if (this.store.state.instances.some((item) => item.name === safeName)) throw new Error('Instancia ja cadastrada.');
    const response = await this.evolution.createInstance(safeName);
    const hasPrimary = this.store.state.instances.some((item) => item.operationalMode === 'primary');
    const instance = {
      id: id(), name: safeName, label: safeName, enabled: true, state: 'created',
      operationalMode: hasPrimary ? 'standby' : 'primary', priority: this.store.state.instances.length,
      dailyLimit: 50, sentToday: 0, sentDay: '', lastUsedAt: '', createdAt: nowIso()
    };
    this.store.update((state) => { state.instances.push(instance); audit(state, 'instance.created', { instance: safeName }); });
    return { instance, evolution: response };
  }

  async qr(name) { return this.evolution.connect(name); }

  updateInstance(instanceId, input = {}) {
    let result;
    this.store.update((state) => {
      const instance = state.instances.find((item) => item.id === instanceId);
      if (!instance) throw new Error('Instancia nao encontrada.');
      if (input.label !== undefined) instance.label = clean(input.label, 80) || instance.name;
      if (input.enabled !== undefined) instance.enabled = Boolean(input.enabled);
      if (input.dailyLimit !== undefined) {
        const dailyLimit = Number(input.dailyLimit);
        if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) throw new Error('Limite diario invalido.');
        instance.dailyLimit = dailyLimit;
      }
      if (input.priority !== undefined) {
        const priority = Number(input.priority);
        if (!Number.isInteger(priority) || priority < 0 || priority > 999) throw new Error('Prioridade invalida.');
        instance.priority = priority;
      }
      if (input.operationalMode !== undefined) {
        if (!['primary', 'standby', 'paused'].includes(input.operationalMode)) throw new Error('Modo operacional invalido.');
        if (input.operationalMode === 'primary') {
          for (const item of state.instances) if (item.id !== instance.id && item.operationalMode === 'primary') item.operationalMode = 'standby';
        }
        instance.operationalMode = input.operationalMode;
      }
      instance.updatedAt = nowIso();
      audit(state, 'instance.configured', { instance: instance.name, operationalMode: instance.operationalMode });
      result = { ...instance };
    });
    return result;
  }

  setPrimaryInstance(instanceId) {
    return this.updateInstance(instanceId, { operationalMode: 'primary', enabled: true });
  }

  async refreshInstances() {
    const results = [];
    let providerInstances = [];
    if (typeof this.evolution.fetchInstances === 'function') {
      try { providerInstances = await this.evolution.fetchInstances(); } catch { providerInstances = []; }
    }
    for (const instance of this.store.state.instances) {
      try {
        const response = await this.evolution.connectionState(instance.name);
        const state = response?.instance?.state || response?.state || 'unknown';
        const provider = providerInstances.find((item) => item?.name === instance.name || item?.instance?.instanceName === instance.name);
        const owner = provider?.ownerJid || provider?.number || provider?.instance?.owner || '';
        instance.state = state; instance.lastHealthAt = nowIso(); instance.lastError = '';
        if (owner) instance.phoneNumber = clean(String(owner).replace(/@.*$/, ''), 30);
        results.push({ name: instance.name, state, phoneNumber: instance.phoneNumber || '' });
      } catch (error) {
        instance.state = 'unavailable'; instance.lastHealthAt = nowIso(); instance.lastError = error.message;
        results.push({ name: instance.name, state: 'unavailable' });
      }
    }
    this.store.save();
    return results;
  }

  createCampaign(input) {
    const messageProfile = input?.messageProfile || 'custom';
    const senderName = clean(input?.senderName, 80);
    const rawContinuationTemplate = String(input?.continuationTemplate || '').trim();
    if (rawContinuationTemplate.length > 3500) throw new Error('A continuacao excede 3500 caracteres.');
    const continuationTemplate = rawContinuationTemplate;
    if (!['custom', 'infraction_first_contact'].includes(messageProfile)) throw new Error('Perfil de mensagem desconhecido.');
    const template = messageProfile === 'infraction_first_contact'
      ? buildProfileTemplate(messageProfile, senderName, continuationTemplate)
      : validateTemplate(input?.template);
    const minDelayMs = Math.max(1000, Number(input?.minDelayMs) || 30000);
    const maxDelayMs = Math.max(minDelayMs, Number(input?.maxDelayMs) || 90000);
    if (maxDelayMs > 86400000) throw new Error('Delay maximo excede 24 horas.');
    const instanceIds = Array.isArray(input?.instanceIds) ? input.instanceIds : [];
    if (!instanceIds.length) throw new Error('Selecione ao menos uma instancia.');
    if (instanceIds.some((value) => !this.store.state.instances.some((instance) => instance.id === value))) throw new Error('Instancia desconhecida.');
    const primaryInstanceId = input?.primaryInstanceId || instanceIds[0];
    if (!instanceIds.includes(primaryInstanceId)) throw new Error('Instancia principal deve participar da campanha.');
    const fallbackInstanceIds = [...new Set(Array.isArray(input?.fallbackInstanceIds)
      ? input.fallbackInstanceIds
      : instanceIds.filter((value) => value !== primaryInstanceId))];
    if (fallbackInstanceIds.includes(primaryInstanceId) || fallbackInstanceIds.some((value) => !instanceIds.includes(value))) throw new Error('Contingencia invalida.');
    const failoverMode = input?.failoverMode || 'manual';
    if (!['manual', 'automatic'].includes(failoverMode)) throw new Error('Modo de failover invalido.');
    const deliverySchedule = normalizeDeliverySchedule(input?.deliverySchedule || { enabled: false });
    const campaign = {
      id: id(), name: clean(input.name, 120) || 'Campanha sem nome', template, minDelayMs, maxDelayMs,
      messageProfile, senderName, continuationTemplate,
      instanceIds, primaryInstanceId, fallbackInstanceIds, failoverMode,
      deliverySchedule,
      status: 'draft', runtimeStatus: 'ready', createdAt: nowIso(), nextDispatchAt: ''
    };
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
        if (campaign.messageProfile === 'infraction_first_contact') {
          try { assertInfractionLeadReady(lead); } catch { continue; }
        }
        const phone = lead.phones[0];
        const key = `${campaign.id}:${lead.id}:${phone}`;
        if (state.jobs.some((job) => job.idempotencyKey === key)) continue;
        const message = renderTemplate(campaign.template, lead, { senderName: campaign.senderName });
        state.jobs.push({
          id: id(), idempotencyKey: key, campaignId: campaign.id, leadId: lead.id, phone,
          message, messageProfile: campaign.messageProfile,
          status: 'queued', attempts: 0, availableAt: nowIso(), createdAt: nowIso()
        });
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

  setCampaignRouting(campaignId, input = {}) {
    let result;
    this.store.update((state) => {
      const campaign = state.campaigns.find((item) => item.id === campaignId);
      if (!campaign) throw new Error('Campanha nao encontrada.');
      const primaryInstanceId = input.primaryInstanceId || campaign.primaryInstanceId || campaign.instanceIds[0];
      const fallbackInstanceIds = [...new Set(Array.isArray(input.fallbackInstanceIds) ? input.fallbackInstanceIds : (campaign.fallbackInstanceIds || []))];
      const allIds = [primaryInstanceId, ...fallbackInstanceIds];
      if (allIds.some((value) => !state.instances.some((instance) => instance.id === value))) throw new Error('Instancia desconhecida.');
      if (fallbackInstanceIds.includes(primaryInstanceId)) throw new Error('A linha principal nao pode ser contingencia.');
      const failoverMode = input.failoverMode || campaign.failoverMode || 'manual';
      if (!['manual', 'automatic'].includes(failoverMode)) throw new Error('Modo de failover invalido.');
      campaign.primaryInstanceId = primaryInstanceId;
      campaign.fallbackInstanceIds = fallbackInstanceIds;
      campaign.instanceIds = allIds;
      campaign.failoverMode = failoverMode;
      campaign.runtimeStatus = 'ready';
      campaign.routingUpdatedAt = nowIso();
      audit(state, 'campaign.routing-configured', { campaignId, failoverMode, primaryInstanceId, fallbackCount: fallbackInstanceIds.length });
      result = { ...campaign };
    });
    return result;
  }

  chooseInstance(campaign) {
    const day = new Date().toISOString().slice(0, 10);
    const primaryId = campaign.primaryInstanceId || campaign.instanceIds[0];
    const fallbackIds = campaign.fallbackInstanceIds || campaign.instanceIds.filter((value) => value !== primaryId);
    const orderedIds = [primaryId, ...fallbackIds];
    const candidates = orderedIds.map((instanceId) => this.store.state.instances.find((item) => item.id === instanceId)).filter(Boolean);
    for (const item of candidates) if (item.sentDay !== day) { item.sentDay = day; item.sentToday = 0; }
    const available = (item) => healthy(item) && item.sentToday < item.dailyLimit;
    if (available(candidates[0])) return { instance: candidates[0], usedFallback: false };
    if ((campaign.failoverMode || 'manual') !== 'automatic') return undefined;
    const fallback = candidates.slice(1).find(available);
    return fallback ? { instance: fallback, usedFallback: true } : undefined;
  }

  async tick() {
    if (this.processing || !this.dispatchEnabled) return false;
    const current = new Date();
    let due; let campaign; let stateChanged = false;
    for (const job of this.store.state.jobs) {
      if (job.status !== 'queued' || new Date(job.availableAt).getTime() > current.getTime()) continue;
      const candidate = this.store.state.campaigns.find((item) => item.id === job.campaignId);
      if (!candidate || candidate.status !== 'active' || (candidate.nextDispatchAt && new Date(candidate.nextDispatchAt).getTime() > current.getTime())) continue;
      if (!isWithinDeliverySchedule(current, candidate.deliverySchedule || { enabled: false })) {
        if (candidate.runtimeStatus !== 'waiting_schedule') {
          candidate.runtimeStatus = 'waiting_schedule';
          audit(this.store.state, 'campaign.waiting-schedule', { campaignId: candidate.id });
          stateChanged = true;
        }
        continue;
      }
      due = job; campaign = candidate; break;
    }
    if (stateChanged) this.store.save();
    if (!due || !campaign) return false;
    const lead = this.store.state.leads.find((item) => item.id === due.leadId);
    if (!lead || lead.contactPermission !== 'approved') { due.status = 'blocked'; due.error = 'Lead sem permissao vigente.'; this.store.save(); return true; }
    const route = this.chooseInstance(campaign);
    if (!route) {
      if (campaign.runtimeStatus !== 'waiting_instance') {
        campaign.runtimeStatus = 'waiting_instance'; campaign.lastRoutingIssueAt = nowIso();
        audit(this.store.state, 'campaign.waiting-instance', { campaignId: campaign.id, failoverMode: campaign.failoverMode || 'manual' });
        this.store.save();
      }
      return false;
    }
    const { instance, usedFallback } = route;
    campaign.runtimeStatus = usedFallback ? 'using_fallback' : 'ready';
    this.processing = true;
    due.status = 'sending'; due.instanceId = instance.id; due.attempts += 1; due.startedAt = nowIso(); this.store.save();
    try {
      const message = due.message || renderTemplate(campaign.template, lead, { senderName: campaign.senderName });
      const response = await this.evolution.sendText(instance.name, due.phone, message);
      due.status = 'sent'; due.sentAt = nowIso(); due.providerMessageId = clean(response?.key?.id || response?.messageId, 200);
      instance.sentToday += 1; instance.lastUsedAt = nowIso();
      const delay = campaign.minDelayMs + Math.floor(Math.random() * (campaign.maxDelayMs - campaign.minDelayMs + 1));
      campaign.nextDispatchAt = new Date(Date.now() + delay).toISOString();
      audit(this.store.state, 'message.sent', { jobId: due.id, campaignId: campaign.id, instance: instance.name });
      if (usedFallback) audit(this.store.state, 'campaign.failover-used', { campaignId: campaign.id, instance: instance.name });
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
    let optOut = null;
    this.store.update((state) => {
      state.webhookEvents.unshift({ id: eventId, at: nowIso(), event: clean(event?.event, 100), instance: clean(event?.instance, 100) });
      state.webhookEvents = state.webhookEvents.slice(0, 5000);
      audit(state, 'webhook.received', { eventId, event: clean(event?.event, 100) });
      const inbound = normalizeInboundEvent(event);
      if (inbound && isOptOutMessage(inbound.body)) {
        if (!state.suppressedPhones.includes(inbound.phone)) state.suppressedPhones.push(inbound.phone);
        let leadsBlocked = 0; let jobsCancelled = 0;
        for (const lead of state.leads) {
          if (!lead.phones.includes(inbound.phone)) continue;
          lead.contactPermission = 'blocked'; lead.permissionReason = 'Descadastro solicitado pelo WhatsApp.'; lead.optOutAt = nowIso();
          leadsBlocked += 1;
          for (const job of state.jobs) if (job.leadId === lead.id && job.status === 'queued') { job.status = 'cancelled'; job.error = 'Descadastro solicitado antes do envio.'; jobsCancelled += 1; }
        }
        optOut = { phone: maskPhone(inbound.phone), leadsBlocked, jobsCancelled };
        audit(state, 'contact.opted-out', { phone: maskPhone(inbound.phone), leadsBlocked, jobsCancelled });
      }
    });
    return { duplicate: false, optOut };
  }
}
