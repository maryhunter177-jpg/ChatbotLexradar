import fs from 'node:fs';
import path from 'node:path';

function initialState() {
  return { schemaVersion: 1, revision: 0, instances: [], leads: [], campaigns: [], jobs: [], webhookEvents: [], audit: [] };
}

export class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'bot-state.json');
    this.state = initialState();
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) return this.save();
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.leads) || !Array.isArray(parsed.jobs)) throw new Error('Estado persistente do bot invalido.');
    this.state = { ...initialState(), ...parsed };
    return this.state;
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.state.revision = Number(this.state.revision || 0) + 1;
    const temporary = `${this.file}.tmp`;
    const handle = fs.openSync(temporary, 'w');
    try { fs.writeFileSync(handle, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8'); fs.fsyncSync(handle); }
    finally { fs.closeSync(handle); }
    fs.renameSync(temporary, this.file);
    return this.state;
  }

  update(mutator) {
    const result = mutator(this.state);
    this.save();
    return result;
  }
}
