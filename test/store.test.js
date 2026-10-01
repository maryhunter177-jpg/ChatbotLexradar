import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/infra/json-store.js';

test('persiste estado com troca atomica', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lexbot-'));
  try {
    const store = new JsonStore(root); store.load();
    store.update((state) => state.leads.push({ id: '1' }));
    const restored = new JsonStore(root); restored.load();
    assert.equal(restored.state.leads[0].id, '1');
    assert.equal(fs.existsSync(`${restored.file}.tmp`), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
