import { getConfig } from './config.js';
import { extractEligibleLeads, readLexRadarState } from './integrations/lexradar.js';

const config = getConfig();
if (!config.bridgeToken) throw new Error('Defina BOT_BRIDGE_TOKEN no arquivo .env.');

async function sync() {
  const state = readLexRadarState(config.lexradarStatePath);
  const leads = extractEligibleLeads(state);
  const response = await fetch(`${config.botRemoteUrl}/api/v1/leads/import`, {
    method: 'POST', headers: { authorization: `Bearer ${config.bridgeToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ leads }), signal: AbortSignal.timeout(config.httpTimeoutMs)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Bot respondeu HTTP ${response.status}.`);
  console.log(JSON.stringify({ event: 'bridge.synced', eligible: leads.length, ...result }));
}

if (process.argv.includes('--once')) await sync();
else {
  await sync();
  setInterval(() => sync().catch((error) => console.error(JSON.stringify({ event: 'bridge.failed', error: error.message }))), config.bridgeIntervalMs);
}
