import { pathToFileURL } from 'node:url';
import { getConfig } from './config.js';
import { extractEligibleLeads, readLexRadarState } from './integrations/lexradar.js';

export function assertSafeDestination(rawUrl, allowRemote = false) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('BOT_REMOTE_URL invalida.'); }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (!allowRemote && (!loopback || url.protocol !== 'http:')) {
    throw new Error('BOT_REMOTE_URL deve apontar para o tunel local HTTP. Use BRIDGE_ALLOW_REMOTE=true somente para um endpoint HTTPS deliberadamente publicado.');
  }
  if (allowRemote && url.protocol !== 'https:' && !loopback) throw new Error('Endpoint remoto da ponte deve usar HTTPS.');
  return url;
}

export async function syncBridge(config, { dryRun = false, fetchImpl = fetch } = {}) {
  if (!dryRun && !config.bridgeToken) throw new Error('Defina BOT_BRIDGE_TOKEN no arquivo .env local.');
  const state = readLexRadarState(config.lexradarStatePath, { maxBytes: config.bridgeMaxStateBytes });
  const leads = extractEligibleLeads(state, { maxLeads: config.bridgeMaxLeads });
  const destination = assertSafeDestination(config.botRemoteUrl, config.bridgeAllowRemote);
  const summary = { event: dryRun ? 'bridge.validated' : 'bridge.synced', eligible: leads.length };
  if (dryRun) return summary;

  const response = await fetchImpl(new URL('/api/v1/leads/import', destination), {
    method: 'POST',
    headers: { authorization: `Bearer ${config.bridgeToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ leads }),
    signal: AbortSignal.timeout(config.httpTimeoutMs)
  });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(result.error || `Bot respondeu HTTP ${response.status}.`);
  return { ...summary, ...result };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runBridge(config, { once = false, dryRun = false } = {}) {
  do {
    try { console.log(JSON.stringify(await syncBridge(config, { dryRun }))); }
    catch (error) {
      console.error(JSON.stringify({ event: 'bridge.failed', error: error.message }));
      if (once || dryRun) throw error;
    }
    if (!once && !dryRun) await sleep(config.bridgeIntervalMs);
  } while (!once && !dryRun);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = new Set(process.argv.slice(2));
  await runBridge(getConfig(), { once: args.has('--once'), dryRun: args.has('--dry-run') });
}
