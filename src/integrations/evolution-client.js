export class EvolutionClient {
  constructor({ baseUrl, apiKey, webhookUrl = '', webhookSecret = '', timeoutMs = 15000, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.webhookUrl = webhookUrl;
    this.webhookSecret = webhookSecret;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  configured() { return Boolean(this.baseUrl && this.apiKey); }

  async request(method, route, body) {
    if (!this.configured()) throw Object.assign(new Error('Evolution API nao configurada.'), { permanent: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${route}`, {
        method,
        headers: { apikey: this.apiKey, 'content-type': 'application/json', origin: 'http://127.0.0.1:3100' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
      if (!response.ok) {
        const error = new Error(`Evolution API respondeu HTTP ${response.status}.`);
        error.status = response.status;
        error.permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
        error.details = data;
        throw error;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  createInstance(name) {
    const payload = { instanceName: name, qrcode: true, integration: 'WHATSAPP-BAILEYS' };
    if (this.webhookUrl) {
      payload.webhook = {
        enabled: true,
        url: this.webhookUrl,
        byEvents: false,
        base64: false,
        events: ['QRCODE_UPDATED', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE_UPDATE', 'CONNECTION_UPDATE'],
        headers: this.webhookSecret ? { 'x-webhook-secret': this.webhookSecret } : {}
      };
      // Compatibilidade com o contrato anterior da linha 2.3.
      payload.webhookUrl = this.webhookUrl;
      payload.webhookByEvents = false;
      payload.webhookEvents = payload.webhook.events;
    }
    return this.request('POST', '/instance/create', payload);
  }
  connect(name) { return this.request('GET', `/instance/connect/${encodeURIComponent(name)}`); }
  connectionState(name) { return this.request('GET', `/instance/connectionState/${encodeURIComponent(name)}`); }
  sendText(name, number, text) { return this.request('POST', `/message/sendText/${encodeURIComponent(name)}`, { number, text }); }
}
