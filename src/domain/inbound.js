import { normalizeBrazilianMobile } from './phone.js';

function text(value) {
  return String(value || '').trim();
}

export function normalizeInboundEvent(event) {
  const name = text(event?.event).toLowerCase().replace(/_/g, '.');
  if (name !== 'messages.upsert') return null;
  const data = event?.data || {};
  const key = data.key || {};
  if (key.fromMe || !text(key.remoteJid).endsWith('@s.whatsapp.net')) return null;
  const message = data.message || {};
  const body = text(
    message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || message.videoMessage?.caption
  );
  if (!body) return null;
  const phone = normalizeBrazilianMobile(text(key.remoteJid).replace(/@.*$/, ''));
  if (!phone) return null;
  return { phone, body, messageId: text(key.id), pushName: text(data.pushName) };
}

export function isOptOutMessage(value) {
  const normalized = text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(sair|pare|parar|remover|cancelar|descadastrar|nao quero|nao quero receber|nao tenho interesse)$/.test(normalized);
}
