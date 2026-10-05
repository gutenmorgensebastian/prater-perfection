// Chat-Nachrichten schreiben (auch für automatische Meldungen, z. B. "Neuer Dienstplan").
import { db } from './db.js';
import { broadcast, pushAll } from './notify.js';

export const MESSAGE_SQL = `SELECT m.*, p.name AS person_name, p.color AS person_color,
  a.original_name AS file_name, a.mime AS file_mime, a.size AS file_size
  FROM messages m LEFT JOIN people p ON p.id = m.person_id LEFT JOIN attachments a ON a.id = m.attachment_id`;
export const getMessage = (id) => db.prepare(`${MESSAGE_SQL} WHERE m.id = ?`).get(id);

export function postMessage(channel, person, body, attachment) {
  const r = db.prepare('INSERT INTO messages (channel_id, person_id, body, attachment_id) VALUES (?, ?, ?, ?)')
    .run(channel.id, person?.id ?? null, body, attachment?.id ?? null);
  const msg = getMessage(r.lastInsertRowid);
  broadcast('message', msg);
  pushAll({
    title: `${channel.name} · ${person?.name ?? 'Pratomat'}`,
    body: body || (attachment ? `📎 ${attachment.original_name}` : ''),
    url: `/#/chat/${channel.id}`,
  }, person?.id ?? null).catch((err) => console.warn(err));
  return msg;
}

// Standard-Gruppe für Meldungen zu Plänen: "Dienstplan", sonst die erste.
export const planChannel = () => db.prepare("SELECT * FROM channels ORDER BY name LIKE '%dienstplan%' DESC, position, id LIMIT 1").get();
