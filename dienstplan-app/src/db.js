import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'dienstplan.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  roster_name TEXT,               -- Name, wie er im Dienstplan-PDF steht
  color TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',  -- admin | member | viewer | none (nur im Dienstplan, kein Zugang)
  token TEXT UNIQUE,              -- Einladungslink / Login
  feed_token TEXT UNIQUE NOT NULL, -- nur für Kalender-Abos
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, id);
CREATE TABLE IF NOT EXISTS rosters (
  id INTEGER PRIMARY KEY,
  title TEXT,
  week_start TEXT,                -- Montag der Woche (YYYY-MM-DD)
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  method TEXT NOT NULL,           -- claude | text | manual
  grid TEXT NOT NULL,             -- JSON, siehe roster.js
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published | replaced
  uploaded_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,             -- shift | off | venue | custom
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  roster_id INTEGER REFERENCES rosters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL,            -- Ortszeit Berlin: YYYY-MM-DD oder YYYY-MM-DDTHH:MM
  end TEXT,                       -- exklusiv; bei ganztägig das Folgedatum
  all_day INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS events_start ON events(start);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  keys TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// To-Dos, Fragen, Infos, Bestellwünsche
db.exec(`
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES todos(id) ON DELETE CASCADE, -- gesetzt = Unteraufgabe
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,  -- rotes Fähnchen
  position REAL NOT NULL DEFAULT 0,    -- gemeinsame Reihenfolge
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  done_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS todo_assignees (
  todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (todo_id, person_id)
);
CREATE TABLE IF NOT EXISTS todo_tags (
  todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (todo_id, tag)
);
-- Anhänge an To-Dos, Infos und Bestellwünsche (kind = todo | info | order)
CREATE TABLE IF NOT EXISTS item_attachments (
  kind TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  PRIMARY KEY (kind, item_id, attachment_id)
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  from_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  to_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | done
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS question_replies (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS infos (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'Allgemein',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', -- open | claimed | ordered | done
  claimed_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`);

// Eigene Kalender (von Admins angelegt). Termine ohne calendar_id gehören zu "Termine".
db.exec(`
CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL
);
`);
if (!db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'calendar_id')) {
  db.exec('ALTER TABLE events ADD COLUMN calendar_id INTEGER REFERENCES calendars(id) ON DELETE CASCADE');
}
// Eingelesene Termine lassen sich bearbeiten; "original" merkt sich die Werte laut Plan (JSON), NULL = unverändert.
if (!db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'original')) {
  db.exec('ALTER TABLE events ADD COLUMN original TEXT');
}

// Vertrauliche Infos (z. B. Zugangscodes): nur für ausgewählte Personen sichtbar, Admins sehen immer alles.
if (!db.prepare('PRAGMA table_info(infos)').all().some((c) => c.name === 'restricted')) {
  db.exec('ALTER TABLE infos ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
CREATE TABLE IF NOT EXISTS info_viewers (
  info_id INTEGER NOT NULL REFERENCES infos(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (info_id, person_id)
);
`);

export const newToken = () => crypto.randomBytes(24).toString('base64url');

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#2a9d8f', '#f032e6', '#9a6324', '#808000', '#000075', '#e76f51', '#469990'];
export function nextColor() {
  const used = new Set(db.prepare('SELECT color FROM people').all().map((r) => r.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[db.prepare('SELECT count(*) AS n FROM people').get().n % PALETTE.length];
}

export function createPerson({ name, rosterName = null, role = 'member', color = null }) {
  const token = role === 'none' ? null : newToken();
  const res = db.prepare('INSERT INTO people (name, roster_name, color, role, token, feed_token) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, rosterName ?? name, color || nextColor(), role, token, newToken());
  return db.prepare('SELECT * FROM people WHERE id = ?').get(res.lastInsertRowid);
}

// Erststart: Admin-Person und Standard-Kanäle anlegen.
export function bootstrap() {
  let created = null;
  if (!db.prepare('SELECT 1 FROM people WHERE role = ?').get('admin')) {
    created = createPerson({ name: process.env.ADMIN_NAME || 'Admin', role: 'admin' });
  }
  if (!db.prepare('SELECT 1 FROM channels').get()) {
    const ins = db.prepare('INSERT INTO channels (name, position) VALUES (?, ?)');
    ['Allgemein', 'Dienstplan', 'Technik-Infos'].forEach((n, i) => ins.run(n, i));
  }
  return created;
}
