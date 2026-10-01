import fs from 'node:fs';
import { uniquePhones } from '../domain/phone.js';

const COMPLETED = new Set(['Finalizado', 'CPF localizado, sem telefone', 'Reutilizado do historico', 'Reutilizado do histórico']);

export function readLexRadarState(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('A base do LexRadar deve ser um arquivo regular.');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.records) || !parsed.settings) throw new Error('Estrutura do LexRadar nao reconhecida.');
  return parsed;
}

export function extractEligibleLeads(state) {
  const defaultMode = state.settings?.mode || 'demo';
  return state.records.flatMap((record) => {
    const dataMode = record.dataMode || defaultMode;
    const phones = uniquePhones(record.phones || []);
    if (!record.id || dataMode !== 'live' || !COMPLETED.has(record.status) || !phones.length) return [];
    return [{
      schemaVersion: 1,
      sourceId: record.id,
      sourceBatchId: record.batchId || '',
      type: record.type === 'processes' ? 'process' : 'infraction',
      name: String(record.name || '').trim(),
      phones,
      classification: String(record.classification || '').trim(),
      infractionCode: String(record.infractionCode || '').trim(),
      infractionDescription: String(record.infractionDescription || '').trim(),
      processNumber: String(record.processNumber || '').trim(),
      sourceFile: String(record.sourceFile || '').trim(),
      sourceUpdatedAt: record.updatedAt || record.queryCompletedAt || '',
      dataMode
    }];
  });
}
