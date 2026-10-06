import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uniquePhones } from '../domain/phone.js';

const COMPLETED = new Set(['finalizado', 'cpf localizado, sem telefone', 'reutilizado do historico']);

function clean(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function canonical(value) {
  return clean(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const STATE_RELATIVE_PATH = path.join('data', 'lexradar-data.json');

function validRoot(value, pathApi = path) {
  const raw = String(value || '').trim();
  return raw && !raw.includes('\0') && !/[*?]/.test(raw) && pathApi.isAbsolute(raw) ? pathApi.resolve(raw) : '';
}

export function discoverLexRadarStatePath({
  explicitPath = '', platform = process.platform, appData = process.env.APPDATA || '',
  homeDir = os.homedir(), fsApi = fs, pathApi = path
} = {}) {
  if (explicitPath) return pathApi.resolve(explicitPath);
  if (platform !== 'win32') throw new Error('Defina LEXRADAR_STATE_PATH neste sistema operacional.');

  const marker = appData ? pathApi.join(appData, 'lexradar', 'data-root-location.json') : '';
  if (marker && fsApi.existsSync(marker)) {
    let selectedRoot = '';
    try {
      const parsed = JSON.parse(fsApi.readFileSync(marker, 'utf8'));
      selectedRoot = validRoot(parsed?.dataRoot, pathApi);
    } catch (error) {
      throw new Error(`Nao foi possivel ler o local de dados informado pelo LexRadar: ${error.message}.`);
    }
    if (!selectedRoot) throw new Error('O LexRadar informou um local de dados invalido.');
    return pathApi.join(selectedRoot, STATE_RELATIVE_PATH);
  }

  const candidates = [
    'D:\\LexRadar-Dados',
    homeDir && pathApi.join(homeDir, 'Documents', 'LexRadar-Dados'),
    appData && pathApi.join(appData, 'lexradar', 'Dados')
  ].filter(Boolean).map((root) => pathApi.join(root, STATE_RELATIVE_PATH));
  const found = candidates.find((candidate) => {
    try { return fsApi.existsSync(candidate); } catch { return false; }
  });
  if (found) return found;
  throw new Error('Base do LexRadar nao localizada. Abra o LexRadar uma vez ou defina LEXRADAR_STATE_PATH.');
}

export function readLexRadarState(file, { maxBytes = 50 * 1024 * 1024, discovery = {} } = {}) {
  const selectedFile = discoverLexRadarStatePath({ ...discovery, explicitPath: file });
  const stat = fs.lstatSync(selectedFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('A base do LexRadar deve ser um arquivo regular.');
  if (stat.size > maxBytes) throw new Error('A base do LexRadar excede o limite configurado.');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(selectedFile, 'utf8')); }
  catch (error) {
    const reason = error instanceof SyntaxError ? 'JSON invalido ou escrita ainda em andamento' : error.message;
    throw new Error(`Nao foi possivel ler a base do LexRadar: ${reason}.`);
  }
  if (!parsed || !Array.isArray(parsed.records) || !parsed.settings) throw new Error('Estrutura do LexRadar nao reconhecida.');
  return parsed;
}

export function extractEligibleLeads(state, { maxLeads = 10000 } = {}) {
  const defaultMode = state.settings?.mode || 'demo';
  const leads = state.records.flatMap((record) => {
    const dataMode = record.dataMode || defaultMode;
    const phones = uniquePhones(record.phones || []);
    if (!record.id || dataMode !== 'live' || !COMPLETED.has(canonical(record.status)) || !phones.length) return [];
    return [{
      schemaVersion: 1,
      sourceId: clean(record.id, 200),
      sourceBatchId: clean(record.batchId, 200),
      type: record.type === 'processes' ? 'process' : 'infraction',
      name: clean(record.name, 300),
      phones,
      classification: clean(record.classification),
      infractionCode: clean(record.infractionCode, 100),
      infractionDescription: clean(record.infractionDescription, 2000),
      processNumber: clean(record.processNumber, 200),
      sourceFile: clean(record.sourceFile, 500),
      sourceUpdatedAt: clean(record.updatedAt || record.queryCompletedAt, 100),
      dataMode
    }];
  });
  if (leads.length > maxLeads) throw new Error(`A ponte encontrou ${leads.length} leads; limite configurado: ${maxLeads}.`);
  return leads;
}
