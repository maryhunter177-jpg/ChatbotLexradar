import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'x-content-type-options': 'nosniff' });
  res.end(body);
}

export async function readBody(req, limit = 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw Object.assign(new Error('Payload muito grande.'), { status: 413 }); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  let json = {};
  if (raw) { try { json = JSON.parse(raw); } catch { throw Object.assign(new Error('JSON invalido.'), { status: 400 }); } }
  return { raw, json };
}

export function tokenMatches(provided, expected) {
  const left = Buffer.from(String(provided || '')); const right = Buffer.from(String(expected || ''));
  return Boolean(expected && left.length === right.length && crypto.timingSafeEqual(left, right));
}

export function bearer(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }

export function serveIndex(res) {
  const file = path.resolve('public/index.html');
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'", 'x-content-type-options': 'nosniff' });
  res.end(body);
}
