// „Rückgängig“ für alle Löschungen: Vor dem Löschen werden die betroffenen Zeilen gemerkt
// (auch alles, was per Fremdschlüssel mitgelöscht oder auf NULL gesetzt wird). Die Person,
// die gelöscht hat, kann sie für kurze Zeit über ein Kürzel zurückholen.
import crypto from 'node:crypto';
import { db } from './db.js';

const KEEP_MS = 60_000; // länger als der Knopf sichtbar ist (10 s) – Puffer für langsames Netz
const store = new Map();

// specs: in Reihenfolge Eltern vor Kindern.
//   { table, where, params }                 → Zeilen, die gelöscht werden (werden neu eingefügt)
//   { table, where, params, column }         → Zeilen, in denen `column` auf NULL gesetzt wird (Wert wird zurückgeschrieben)
export function snapshot(personId, specs) {
  const parts = specs.map((s) => ({
    table: s.table,
    column: s.column || null,
    rows: db.prepare(`SELECT * FROM ${s.table} WHERE ${s.where}`).all(...(s.params || [])),
  })).filter((p) => p.rows.length);
  const token = crypto.randomBytes(12).toString('base64url');
  store.set(token, { by: personId, parts });
  setTimeout(() => store.delete(token), KEEP_MS).unref();
  return token;
}

export function restore(token, personId) {
  const entry = store.get(token);
  if (!entry || entry.by !== personId) return null;
  store.delete(token);
  db.exec('BEGIN');
  try {
    for (const part of entry.parts) {
      for (const row of part.rows) {
        if (part.column) {
          db.prepare(`UPDATE ${part.table} SET ${part.column} = ? WHERE id = ?`).run(row[part.column], row.id);
        } else {
          const cols = Object.keys(row);
          db.prepare(`INSERT OR IGNORE INTO ${part.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
            .run(...cols.map((c) => row[c]));
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return entry.parts;
}

// Was beim Löschen einer Person alles mitgeht (gelöscht bzw. auf NULL gesetzt).
export function personSpecs(id) {
  const q = 'from_id = ? OR to_id = ?';
  return [
    { table: 'people', where: 'id = ?', params: [id] },
    { table: 'events', where: 'person_id = ?', params: [id] },
    { table: 'todo_assignees', where: 'person_id = ?', params: [id] },
    { table: 'push_subscriptions', where: 'person_id = ?', params: [id] },
    { table: 'questions', where: q, params: [id, id] },
    { table: 'question_replies', where: `question_id IN (SELECT id FROM questions WHERE ${q})`, params: [id, id] },
    ...[['messages', 'person_id'], ['attachments', 'uploaded_by'], ['rosters', 'uploaded_by'], ['events', 'created_by'],
      ['todos', 'created_by'], ['todos', 'done_by'], ['question_replies', 'person_id'], ['infos', 'created_by'],
      ['orders', 'claimed_by'], ['orders', 'created_by'], ['calendars', 'created_by']]
      .map(([table, column]) => ({ table, column, where: `${column} = ?`, params: [id] })),
  ];
}
