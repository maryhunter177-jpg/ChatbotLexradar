import fs from 'node:fs';
import http from 'node:http';

const listenHost = '127.0.0.1';
const listenPort = Number(process.env.CONNECTOR_PANEL_PORT || 3100);
const upstream = new URL(process.env.CONNECTOR_UPSTREAM_URL || 'http://127.0.0.1:3199');
const adminToken = process.env.BOT_ADMIN_TOKEN || '';
const statusFile = process.env.CONNECTOR_STATUS_FILE || '';
const connectorVersion = process.env.CONNECTOR_VERSION || 'development';
const maxBodyBytes = 10 * 1024 * 1024;

if (!adminToken) throw new Error('BOT_ADMIN_TOKEN nao foi fornecido ao proxy local.');
if (!['127.0.0.1', 'localhost', '::1'].includes(upstream.hostname) || upstream.protocol !== 'http:') {
  throw new Error('CONNECTOR_UPSTREAM_URL deve usar HTTP no loopback local.');
}

const hopByHop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error('Corpo da requisicao excede o limite.'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    request.on('error', reject);
  });
}

function safeStatus() {
  let stored = {};
  try { if (statusFile) stored = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}
  return {
    ready: stored.tunnelConnected === true,
    tunnelConnected: stored.tunnelConnected === true,
    lexradarDetected: stored.lexradarDetected === true,
    lastSyncAt: stored.lastSyncAt || null,
    eligibleCount: Number.isFinite(Number(stored.eligibleCount)) ? Number(stored.eligibleCount) : null,
    connectorVersion
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const host = String(request.headers.host || '').toLowerCase();
    if (!['127.0.0.1:' + listenPort, 'localhost:' + listenPort].includes(host)) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'Host local invalido.' }));
      return;
    }
    if (request.url === '/connector/status') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(safeStatus()));
      return;
    }
    if (!String(request.url || '').startsWith('/') || String(request.url || '').startsWith('//')) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'Destino de proxy invalido.' }));
      return;
    }
    const destination = new URL(request.url || '/', upstream);
    if (destination.origin !== upstream.origin) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'Destino de proxy invalido.' }));
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (!hopByHop.has(name.toLowerCase()) && name.toLowerCase() !== 'host' && value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    if (destination.pathname.startsWith('/api/')) headers.set('authorization', 'Bearer ' + adminToken);
    const method = request.method || 'GET';
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(request);
    const upstreamResponse = await fetch(destination, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const outputHeaders = {};
    upstreamResponse.headers.forEach((value, name) => {
      if (!hopByHop.has(name.toLowerCase()) && !['content-length', 'content-encoding'].includes(name.toLowerCase())) outputHeaders[name] = value;
    });
    response.writeHead(upstreamResponse.status, outputHeaders);
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  } catch (error) {
    const status = error.statusCode || 502;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: status === 502 ? 'Conector temporariamente indisponivel.' : error.message }));
  }
});

server.listen(listenPort, listenHost, () => console.log(JSON.stringify({ event: 'connector.proxy.ready', url: 'http://' + listenHost + ':' + listenPort })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
