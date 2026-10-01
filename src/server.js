import http from 'node:http';
import { getConfig } from './config.js';
import { createHandler } from './app.js';
import { JsonStore } from './infra/json-store.js';
import { EvolutionClient } from './integrations/evolution-client.js';
import { BotService } from './services/bot-service.js';

const config = getConfig();
if (!config.adminToken || !config.bridgeToken) throw new Error('Defina BOT_ADMIN_TOKEN e BOT_BRIDGE_TOKEN no arquivo .env.');
const store = new JsonStore(config.dataDir); store.load();
const evolution = new EvolutionClient({ baseUrl: config.evolutionBaseUrl, apiKey: config.evolutionApiKey, timeoutMs: config.httpTimeoutMs });
const service = new BotService({ store, evolution, dispatchEnabled: config.dispatchEnabled });
const server = http.createServer(createHandler({ service, config }));
const timer = setInterval(() => service.tick().catch(() => {}), config.workerIntervalMs); timer.unref();

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ event: 'server.started', host: config.host, port: config.port, dispatchEnabled: config.dispatchEnabled }));
});

function shutdown(signal) { clearInterval(timer); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); console.log(JSON.stringify({ event: 'server.stopping', signal })); }
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
