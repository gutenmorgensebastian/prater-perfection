import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pratomat-prod-'));
const { db } = await import('../src/db.js');
const { seedProductions, createProduction } = await import('../src/productions.js');
const { TEMPLATE, PHASE_KEYS } = await import('../src/production-template.js');

test('Erste Produktionen werden genau einmal angelegt', () => {
  seedProductions();
  seedProductions();
  assert.deepEqual(db.prepare('SELECT name FROM productions ORDER BY position').all().map((r) => r.name), ['Perfection', 'Voguing Ball', 'OMSK']);
  // auch nach dem Löschen nicht wieder
  db.prepare('DELETE FROM productions').run();
  seedProductions();
  assert.equal(db.prepare('SELECT count(*) AS n FROM productions').get().n, 0);
});

test('Neue Produktion bekommt die Gliederung aus der Vorlage', () => {
  const id = createProduction('Testprojekt');
  const pages = db.prepare('SELECT * FROM prod_pages WHERE production_id = ? ORDER BY position').all(id);
  assert.equal(pages.length, TEMPLATE.length);
  assert.ok(pages.every((p) => PHASE_KEYS.includes(p.phase)));
  assert.ok(pages.find((p) => p.title === 'Checkliste vor der Vorstellung').body.startsWith('[ ] '));
});
