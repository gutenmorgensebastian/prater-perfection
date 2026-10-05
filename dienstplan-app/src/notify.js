// Live-Updates (Server-Sent Events) für offene Browserfenster und Push-Benachrichtigungen aufs Handy.
import webpush from 'web-push';
import { db, getSetting, setSetting } from './db.js';

// --- Live-Updates ---------------------------------------------------------
const clients = new Set();

export function liveStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { res, personId: req.person.id };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(client); });
}

export function broadcast(type, data = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.res.write(payload);
}

// --- Web Push -------------------------------------------------------------
let vapidPublicKey = getSetting('vapid_public');
if (!vapidPublicKey) {
  const keys = webpush.generateVAPIDKeys();
  setSetting('vapid_public', keys.publicKey);
  setSetting('vapid_private', keys.privateKey);
  vapidPublicKey = keys.publicKey;
}
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || `mailto:${process.env.ADMIN_EMAIL || 'admin@example.org'}`,
  vapidPublicKey,
  getSetting('vapid_private'),
);
export { vapidPublicKey };

export function saveSubscription(personId, sub) {
  if (!sub?.endpoint || !sub?.keys) throw new Error('Ungültiges Push-Abo');
  db.prepare(`INSERT INTO push_subscriptions (endpoint, person_id, keys) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET person_id = excluded.person_id, keys = excluded.keys`)
    .run(sub.endpoint, personId, JSON.stringify(sub.keys));
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

// Benachrichtigt alle Abos außer denen der Person exceptPersonId.
export function pushAll(message, exceptPersonId = null) {
  const subs = db.prepare(`SELECT s.* FROM push_subscriptions s JOIN people p ON p.id = s.person_id
    WHERE p.role != 'none' AND p.token IS NOT NULL AND s.person_id IS NOT ?`).all(exceptPersonId);
  return send(subs, message);
}

// Benachrichtigt nur bestimmte Personen (z. B. wem eine Aufgabe oder Frage gilt).
export function pushTo(personIds, message) {
  const ids = [...new Set(personIds)].filter(Boolean);
  if (!ids.length) return Promise.resolve();
  const subs = db.prepare(`SELECT s.* FROM push_subscriptions s JOIN people p ON p.id = s.person_id
    WHERE p.role != 'none' AND p.token IS NOT NULL AND s.person_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return send(subs, message);
}

async function send(subs, { title, body, url = '/' }) {
  const payload = JSON.stringify({ title, body: String(body).slice(0, 180), url });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, payload, { TTL: 3600 });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint); // Abo abgelaufen
      else console.warn('Push fehlgeschlagen:', err.statusCode || err.message);
    }
  }));
}
