import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function request(port, requestPath, host = '127.0.0.1:' + port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, headers: { host } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('proxy local injeta autenticacao, limita host e nao aceita destino absoluto', async (t) => {
  let receivedAuthorization = '';
  const upstream = http.createServer((req, res) => {
    receivedAuthorization = req.headers.authorization || '';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => upstream.close());

  const reservation = http.createServer();
  const proxyPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-proxy-'));
  const statusFile = path.join(dir, 'status.json');
  fs.writeFileSync(statusFile, JSON.stringify({ tunnelConnected: true, lexradarDetected: true, eligibleCount: 7 }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const child = spawn(process.execPath, ['client/connector-proxy.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      CONNECTOR_PANEL_PORT: String(proxyPort),
      CONNECTOR_UPSTREAM_URL: 'http://127.0.0.1:' + upstreamPort,
      CONNECTOR_STATUS_FILE: statusFile,
      CONNECTOR_VERSION: 'test',
      BOT_ADMIN_TOKEN: 'admin-secret-test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('proxy nao iniciou')), 5000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('exit', (code) => reject(new Error('proxy encerrou: ' + code)));
  });

  const status = await request(proxyPort, '/connector/status');
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), {
    ready: true, tunnelConnected: true, lexradarDetected: true,
    lastSyncAt: null, eligibleCount: 7, connectorVersion: 'test'
  });

  const api = await request(proxyPort, '/api/status');
  assert.equal(api.status, 200);
  assert.equal(receivedAuthorization, 'Bearer admin-secret-test');
  assert.equal((await request(proxyPort, '/connector/status', 'malicioso.example')).status, 400);
  assert.equal((await request(proxyPort, 'http://malicioso.example/api/status')).status, 400);
});
