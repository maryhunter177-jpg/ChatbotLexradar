import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(file = path.resolve('.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function integer(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} invalido.`);
  return value;
}

export function getConfig() {
  loadDotEnv();
  return Object.freeze({
    host: process.env.HOST || '127.0.0.1',
    port: integer('PORT', 3100, 1, 65535),
    dataDir: path.resolve(process.env.BOT_DATA_DIR || './data'),
    adminToken: process.env.BOT_ADMIN_TOKEN || '',
    bridgeToken: process.env.BOT_BRIDGE_TOKEN || '',
    evolutionBaseUrl: String(process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, ''),
    evolutionApiKey: process.env.EVOLUTION_API_KEY || '',
    evolutionWebhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET || '',
    evolutionWebhookUrl: process.env.EVOLUTION_WEBHOOK_URL || 'http://bot:3100/webhooks/evolution',
    dispatchEnabled: /^true$/i.test(process.env.DISPATCH_ENABLED || 'false'),
    workerIntervalMs: integer('WORKER_INTERVAL_MS', 1000, 250, 60000),
    httpTimeoutMs: integer('HTTP_TIMEOUT_MS', 15000, 1000, 120000),
    lexradarStatePath: process.env.LEXRADAR_STATE_PATH ? path.resolve(process.env.LEXRADAR_STATE_PATH) : '',
    botRemoteUrl: String(process.env.BOT_REMOTE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, ''),
    bridgeIntervalMs: integer('BRIDGE_INTERVAL_MS', 30000, 5000, 3600000),
    bridgeMaxStateBytes: integer('BRIDGE_MAX_STATE_BYTES', 50 * 1024 * 1024, 1024, 250 * 1024 * 1024),
    bridgeMaxLeads: integer('BRIDGE_MAX_LEADS', 10000, 1, 100000),
    bridgeAllowRemote: /^true$/i.test(process.env.BRIDGE_ALLOW_REMOTE || 'false')
  });
}
