import { URL } from 'node:url';
import { bearer, readBody, sendJson, serveIndex, tokenMatches } from './http.js';

export function createHandler({ service, config }) {
  const admin = (req, res) => {
    if (!tokenMatches(bearer(req), config.adminToken)) { sendJson(res, 401, { error: 'Nao autorizado.' }); return false; }
    return true;
  };
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') return serveIndex(res);
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'lexradar-whatsapp-bot' });
      if (req.method === 'POST' && url.pathname === '/webhooks/evolution') {
        const { raw, json } = await readBody(req);
        if (!tokenMatches(req.headers['x-webhook-secret'], config.evolutionWebhookSecret)) return sendJson(res, 401, { error: 'Webhook nao autorizado.' });
        return sendJson(res, 202, service.recordWebhook(raw, json));
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/leads/import') {
        if (!tokenMatches(bearer(req), config.bridgeToken)) return sendJson(res, 401, { error: 'Ponte nao autorizada.' });
        const { json } = await readBody(req, 5 * 1024 * 1024);
        return sendJson(res, 200, service.importLeads(json.leads));
      }
      if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Rota nao encontrada.' });
      if (!admin(req, res)) return;
      if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, service.status());
      if (req.method === 'GET' && url.pathname === '/api/leads') return sendJson(res, 200, service.listLeads());
      if (req.method === 'POST' && url.pathname === '/api/messages/preview') {
        const { json } = await readBody(req);
        return sendJson(res, 200, service.previewMessage(json.leadId, json.senderName, json.continuationTemplate));
      }
      if (req.method === 'POST' && url.pathname === '/api/leads/permission') { const { json } = await readBody(req); return sendJson(res, 200, service.setLeadPermission(json.ids, json.permission, json.reason)); }
      if (req.method === 'POST' && url.pathname === '/api/instances') { const { json } = await readBody(req); return sendJson(res, 201, await service.addInstance(json.name)); }
      if (req.method === 'POST' && url.pathname === '/api/instances/refresh') return sendJson(res, 200, await service.refreshInstances());
      let match = url.pathname.match(/^\/api\/instances\/([^/]+)\/qr$/);
      if (req.method === 'GET' && match) return sendJson(res, 200, await service.qr(decodeURIComponent(match[1])));
      match = url.pathname.match(/^\/api\/instances\/([^/]+)\/configure$/);
      if (req.method === 'POST' && match) { const { json } = await readBody(req); return sendJson(res, 200, service.updateInstance(match[1], json)); }
      match = url.pathname.match(/^\/api\/instances\/([^/]+)\/primary$/);
      if (req.method === 'POST' && match) return sendJson(res, 200, service.setPrimaryInstance(match[1]));
      if (req.method === 'POST' && url.pathname === '/api/campaigns') { const { json } = await readBody(req); return sendJson(res, 201, service.createCampaign(json)); }
      match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/activate$/);
      if (req.method === 'POST' && match) { const { json } = await readBody(req); return sendJson(res, 200, service.activateCampaign(match[1], json.leadIds)); }
      match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/pause$/);
      if (req.method === 'POST' && match) { service.pauseCampaign(match[1]); return sendJson(res, 200, { ok: true }); }
      match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/routing$/);
      if (req.method === 'POST' && match) { const { json } = await readBody(req); return sendJson(res, 200, service.setCampaignRouting(match[1], json)); }
      return sendJson(res, 404, { error: 'Rota nao encontrada.' });
    } catch (error) {
      const status = Number(error.status) || (String(error.message).includes('nao encontrad') ? 404 : 400);
      return sendJson(res, status, { error: error.message || 'Erro interno.' });
    }
  };
}
