import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, UPLOAD_DIR, bootstrap, createPerson, newToken, nextColor } from './src/db.js';
import { HttpError, intParam, requireWriter, requireAdmin, upload, saveAttachment } from './src/http.js';
import { registerTeamRoutes } from './src/team.js';
import { gridToEvents, sanitizeGrid, venueEvent } from './src/roster.js';
import { parseRosterPdfText } from './src/pdf-text.js';
import { parseSpielplanPdf } from './src/spielplan.js';
import { parseRosterPdfClaude, claudeAvailable } from './src/pdf-claude.js';
import { buildIcs } from './src/ics.js';
import { liveStream, broadcast, pushAll, saveSubscription, removeSubscription, vapidPublicKey } from './src/notify.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const app = express();
app.set('trust proxy', 'loopback, uniquelocal');
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

const baseUrl = (req) => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// --- Anmeldung über persönlichen Einladungslink -----------------------------
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function personFromRequest(req) {
  const token = readCookie(req, 'sid');
  if (!token) return null;
  return db.prepare("SELECT * FROM people WHERE token = ? AND role != 'none'").get(token) || null;
}

// Anmeldung = Einladungslink öffnen. Das Cookie hält 400 Tage und verlängert sich bei jeder Nutzung.
const setLoginCookie = (req, res, token) => res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 400 * 24 * 3600 * 1000, path: '/' });

app.get('/join/:token', (req, res) => {
  const person = db.prepare("SELECT * FROM people WHERE token = ? AND role != 'none'").get(req.params.token);
  if (!person) return res.status(404).send(page('Link ungültig', 'Dieser Einladungslink ist nicht (mehr) gültig. Bitte frag nach einem neuen Link.'));
  setLoginCookie(req, res, person.token);
  // Kein Weiterleiten: Die Adresse mit dem Link bleibt stehen. Legt man die Seite jetzt auf den
  // Home-Bildschirm, startet die Kachel über den Link – egal ob das Handy die aktuelle Adresse
  // oder die aus dem Manifest nimmt.
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, 'public/index.html'));
});

// Das App-Manifest wird pro Person ausgeliefert: Die Kachel auf dem Home-Bildschirm startet über den
// persönlichen Link. So bleibt man auch auf dem iPhone angemeldet, wo die Kachel eigene Cookies hat.
app.get('/manifest.webmanifest', (req, res) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
  const person = personFromRequest(req);
  if (person) manifest.start_url = `/join/${person.token}?app=1`;
  res.set('Cache-Control', 'no-store');
  res.type('application/manifest+json').send(JSON.stringify(manifest));
});

app.post('/logout', (req, res) => {
  res.clearCookie('sid', { path: '/' });
  res.redirect('/');
});

function page(title, text) {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5"><h1>${title}</h1><p>${text}</p></body></html>`;
}

const requireAuth = (req, res, next) => {
  req.person = personFromRequest(req);
  if (!req.person) return res.status(401).json({ error: 'Nicht angemeldet. Bitte öffne deinen persönlichen Einladungslink.' });
  next();
};
const COLOR_HEX = /^#[0-9a-f]{6}$/i;

// --- Dateien ---------------------------------------------------------------
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// --- Statische Dateien -----------------------------------------------------
app.get('/vendor/fullcalendar.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/fullcalendar/index.global.min.js')));
app.get('/shared/roster.js', (req, res) => res.sendFile(path.join(ROOT, 'src/roster.js')));
app.get('/vendor/sortable.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/sortablejs/Sortable.min.js')));
app.get('/vendor/fullcalendar-de.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/@fullcalendar/core/locales/de.global.min.js')));
app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html' }));

// --- Kalender-Abo (ohne Login, eigener geheimer Link pro Person) -------------
app.get('/cal/:feed.ics', (req, res) => {
  const owner = db.prepare("SELECT * FROM people WHERE feed_token = ? AND role != 'none'").get(req.params.feed);
  if (!owner) return res.status(404).send('Unbekannter Kalender');
  const ids = String(req.query.p || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const kinds = [];
  if (ids.length) kinds.push('shift');
  if (ids.length && req.query.off === '1') kinds.push('off');
  const cals = String(req.query.k || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const from = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT e.*, p.name AS person_name FROM events e LEFT JOIN people p ON p.id = e.person_id
    WHERE e.start >= ? ORDER BY e.start`).all(from).filter((e) =>
    (kinds.includes(e.kind) && ids.includes(e.person_id))
    || (e.kind === 'venue' && req.query.v === '1')
    || (e.kind === 'custom' && (e.calendar_id ? cals.includes(e.calendar_id) : req.query.c === '1')));
  const names = db.prepare('SELECT id, name FROM people').all().filter((p) => ids.includes(p.id)).map((p) => p.name);
  const calName = `Dienstplan${names.length ? ` – ${names.length > 3 ? `${names.length} Personen` : names.join(', ')}` : ''}`;
  res.type('text/calendar; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.send(buildIcs(rows, { name: calName, host: req.hostname }));
});

// --- API -------------------------------------------------------------------
const api = express.Router();
app.use('/api', api);
api.use(requireAuth);

const publicPerson = (p) => ({ id: p.id, name: p.name, color: p.color, role: p.role, roster_name: p.roster_name });

api.get('/me', (req, res) => {
  setLoginCookie(req, res, req.person.token); // Anmeldung verlängern
  res.json({
    calendars: db.prepare('SELECT * FROM calendars ORDER BY position, id').all(),
    me: { ...publicPerson(req.person), feed_token: req.person.feed_token },
    people: db.prepare('SELECT * FROM people ORDER BY name COLLATE NOCASE').all().map(publicPerson),
    channels: db.prepare('SELECT * FROM channels ORDER BY position, id').all(),
    vapidPublicKey,
    claude: claudeAvailable(),
    baseUrl: baseUrl(req),
  });
});

api.get('/stream', (req, res) => liveStream(req, res));

api.post('/push/subscribe', (req, res) => { saveSubscription(req.person.id, req.body); res.json({ ok: true }); });
api.post('/push/unsubscribe', (req, res) => { removeSubscription(String(req.body?.endpoint || '')); res.json({ ok: true }); });

// Kalender
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

api.get('/events', (req, res) => {
  const start = String(req.query.start || '').slice(0, 10);
  const end = String(req.query.end || '').slice(0, 10);
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) throw new HttpError(400, 'start/end fehlen');
  res.json(db.prepare(`SELECT * FROM events WHERE start < ? AND COALESCE(end, start) >= ? ORDER BY start`).all(`${end}T99`, start));
});

function readEventBody(body) {
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) throw new HttpError(400, 'Titel fehlt');
  const allDay = body.all_day ? 1 : 0;
  const re = allDay ? DATE_RE : DATETIME_RE;
  const start = String(body.start || '');
  let end = body.end ? String(body.end) : null;
  if (!re.test(start) || (end && !re.test(end))) throw new HttpError(400, 'Datum/Uhrzeit ungültig');
  if (end && end < start) throw new HttpError(400, 'Das Ende liegt vor dem Beginn');
  if (allDay && (!end || end === start)) {
    const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); end = d.toISOString().slice(0, 10);
  }
  const calId = Number(body.calendar_id) || null;
  if (calId && !db.prepare('SELECT 1 FROM calendars WHERE id = ?').get(calId)) throw new HttpError(400, 'Kalender gibt es nicht');
  return { title, start, end, all_day: allDay, location: String(body.location || '').slice(0, 200), notes: String(body.notes || '').slice(0, 2000), calendar_id: calId };
}

api.post('/events', requireWriter, (req, res) => {
  const e = readEventBody(req.body);
  const r = db.prepare(`INSERT INTO events (kind, title, start, end, all_day, location, notes, calendar_id, created_by) VALUES ('custom', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.title, e.start, e.end, e.all_day, e.location, e.notes, e.calendar_id, req.person.id);
  broadcast('events');
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(r.lastInsertRowid));
});

function editableEvent(req) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(intParam(req.params.id));
  if (!ev) throw new HttpError(404, 'Termin nicht gefunden');
  const own = ev.kind === 'custom' && ev.created_by === req.person.id && req.person.role !== 'viewer';
  if (!own && req.person.role !== 'admin') throw new HttpError(403, 'Diesen Termin darfst du nicht ändern');
  return ev;
}

api.patch('/events/:id', (req, res) => {
  const ev = editableEvent(req);
  const e = readEventBody({ ...ev, ...req.body });
  db.prepare(`UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, location = ?, notes = ?, calendar_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .run(e.title, e.start, e.end, e.all_day, e.location, e.notes, ev.kind === 'custom' ? e.calendar_id : ev.calendar_id, ev.id);
  broadcast('events');
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id));
});

api.delete('/events/:id', (req, res) => {
  const ev = editableEvent(req);
  db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
  broadcast('events');
  res.json({ ok: true });
});

// Chat
const MESSAGE_SQL = `SELECT m.*, p.name AS person_name, p.color AS person_color,
  a.original_name AS file_name, a.mime AS file_mime, a.size AS file_size
  FROM messages m LEFT JOIN people p ON p.id = m.person_id LEFT JOIN attachments a ON a.id = m.attachment_id`;
const getMessage = (id) => db.prepare(`${MESSAGE_SQL} WHERE m.id = ?`).get(id);
const getChannel = (id) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(intParam(id));
  if (!ch) throw new HttpError(404, 'Gruppe nicht gefunden');
  return ch;
};

api.get('/channels/:id/messages', (req, res) => {
  const ch = getChannel(req.params.id);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = db.prepare(`${MESSAGE_SQL} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 60`).all(ch.id, before);
  res.json(rows.reverse());
});

function postMessage(channel, person, body, attachment) {
  const r = db.prepare('INSERT INTO messages (channel_id, person_id, body, attachment_id) VALUES (?, ?, ?, ?)')
    .run(channel.id, person?.id ?? null, body, attachment?.id ?? null);
  const msg = getMessage(r.lastInsertRowid);
  broadcast('message', msg);
  pushAll({
    title: `${channel.name} · ${person?.name ?? 'Dienstplan'}`,
    body: body || (attachment ? `📎 ${attachment.original_name}` : ''),
    url: `/#/chat/${channel.id}`,
  }, person?.id ?? null).catch((err) => console.warn(err));
  return msg;
}

api.post('/channels/:id/messages', requireWriter, upload.single('file'), (req, res) => {
  const ch = getChannel(req.params.id);
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  if (!body && !req.file) throw new HttpError(400, 'Leere Nachricht');
  const attachment = req.file ? saveAttachment(req.file, req.person.id) : null;
  res.json(postMessage(ch, req.person, body, attachment));
});

api.patch('/messages/:id', requireWriter, (req, res) => {
  const msg = getMessage(intParam(req.params.id));
  if (!msg) throw new HttpError(404, 'Nachricht nicht gefunden');
  db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(req.body?.pinned ? 1 : 0, msg.id);
  const updated = getMessage(msg.id);
  broadcast('message-updated', updated);
  res.json(updated);
});

api.delete('/messages/:id', (req, res) => {
  const msg = getMessage(intParam(req.params.id));
  if (!msg) throw new HttpError(404, 'Nachricht nicht gefunden');
  if (msg.person_id !== req.person.id && req.person.role !== 'admin') throw new HttpError(403, 'Nur eigene Nachrichten löschen');
  db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
  broadcast('message-deleted', { id: msg.id, channel_id: msg.channel_id });
  res.json({ ok: true });
});

// Ablage einer Gruppe: angepinnte Nachrichten, Dateien und Links
const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
api.get('/channels/:id/library', (req, res) => {
  const ch = getChannel(req.params.id);
  const rows = db.prepare(`${MESSAGE_SQL} WHERE m.channel_id = ? AND (m.pinned = 1 OR m.attachment_id IS NOT NULL OR m.body LIKE '%http%') ORDER BY m.id DESC`).all(ch.id);
  const links = rows.flatMap((m) => (m.body.match(URL_RE) || []).map((url) => ({ url, message: m })));
  res.json({ pinned: rows.filter((m) => m.pinned), files: rows.filter((m) => m.attachment_id), links });
});

api.get('/files/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(intParam(req.params.id));
  if (!a) throw new HttpError(404, 'Datei nicht gefunden');
  const inline = INLINE_TYPES.has(a.mime);
  res.set('Content-Type', inline ? a.mime : 'application/octet-stream');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox");
  res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
});

registerTeamRoutes(api);

// --- Admin -----------------------------------------------------------------
const admin = express.Router();
api.use('/admin', requireAdmin, admin);

const adminPerson = (req, p) => ({ ...publicPerson(p), invite_link: p.token ? `${baseUrl(req)}/join/${p.token}` : null });
const ROLES = ['admin', 'member', 'viewer', 'none'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;

admin.get('/people', (req, res) => {
  res.json(db.prepare('SELECT * FROM people ORDER BY name COLLATE NOCASE').all().map((p) => adminPerson(req, p)));
});

admin.post('/people', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Name fehlt');
  const role = ROLES.includes(req.body.role) ? req.body.role : 'member';
  const p = createPerson({ name, rosterName: String(req.body.roster_name || name).trim(), role, color: COLOR_RE.test(req.body.color) ? req.body.color : null });
  broadcast('people');
  res.json(adminPerson(req, p));
});

admin.patch('/people/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(intParam(req.params.id));
  if (!p) throw new HttpError(404, 'Person nicht gefunden');
  const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 80) || p.name : p.name;
  const rosterName = req.body.roster_name !== undefined ? String(req.body.roster_name).trim().slice(0, 80) : p.roster_name;
  const color = COLOR_RE.test(req.body.color) ? req.body.color : p.color;
  let role = ROLES.includes(req.body.role) ? req.body.role : p.role;
  if (p.id === req.person.id) role = 'admin'; // sich nicht selbst aussperren
  const token = role === 'none' ? null : (p.token || newToken());
  db.prepare('UPDATE people SET name = ?, roster_name = ?, color = ?, role = ?, token = ? WHERE id = ?').run(name, rosterName, color, role, token, p.id);
  broadcast('people');
  res.json(adminPerson(req, db.prepare('SELECT * FROM people WHERE id = ?').get(p.id)));
});

// Neuer Einladungs- und Kalenderlink, die alten werden ungültig (z. B. wenn ein Link in falsche Hände geraten ist).
admin.post('/people/:id/new-link', (req, res) => {
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(intParam(req.params.id));
  if (!p) throw new HttpError(404, 'Person nicht gefunden');
  db.prepare('UPDATE people SET token = ?, feed_token = ? WHERE id = ?').run(p.role === 'none' ? null : newToken(), newToken(), p.id);
  res.json(adminPerson(req, db.prepare('SELECT * FROM people WHERE id = ?').get(p.id)));
});

admin.delete('/people/:id', (req, res) => {
  const id = intParam(req.params.id);
  if (id === req.person.id) throw new HttpError(400, 'Du kannst dich nicht selbst löschen');
  db.prepare('DELETE FROM people WHERE id = ?').run(id);
  broadcast('people');
  broadcast('events');
  res.json({ ok: true });
});

// Eigene Kalender: anlegen, umbenennen, Farbe, löschen (nur Admins). Eintragen dürfen alle außer Gästen.
admin.post('/calendars', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'Name fehlt');
  const color = COLOR_HEX.test(req.body?.color) ? req.body.color : '#0ea5e9';
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM calendars').get().p;
  const r = db.prepare('INSERT INTO calendars (name, color, position, created_by) VALUES (?, ?, ?, ?)').run(name, color, pos, req.person.id);
  broadcast('calendars');
  res.json(db.prepare('SELECT * FROM calendars WHERE id = ?').get(r.lastInsertRowid));
});

admin.patch('/calendars/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM calendars WHERE id = ?').get(intParam(req.params.id));
  if (!c) throw new HttpError(404, 'Kalender nicht gefunden');
  const name = String(req.body?.name ?? c.name).trim().slice(0, 60) || c.name;
  const color = COLOR_HEX.test(req.body?.color) ? req.body.color : c.color;
  db.prepare('UPDATE calendars SET name = ?, color = ? WHERE id = ?').run(name, color, c.id);
  broadcast('calendars');
  res.json(db.prepare('SELECT * FROM calendars WHERE id = ?').get(c.id));
});

admin.delete('/calendars/:id', (req, res) => {
  const id = intParam(req.params.id);
  db.prepare('DELETE FROM events WHERE calendar_id = ?').run(id);
  db.prepare('DELETE FROM calendars WHERE id = ?').run(id);
  broadcast('calendars');
  broadcast('events');
  res.json({ ok: true });
});

admin.post('/channels', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'Name fehlt');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels').get().p;
  const r = db.prepare('INSERT INTO channels (name, position) VALUES (?, ?)').run(name, pos);
  broadcast('channels');
  res.json(db.prepare('SELECT * FROM channels WHERE id = ?').get(r.lastInsertRowid));
});

admin.patch('/channels/:id', (req, res) => {
  const ch = getChannel(req.params.id);
  const name = String(req.body?.name ?? ch.name).trim().slice(0, 60) || ch.name;
  const position = Number.isInteger(req.body?.position) ? req.body.position : ch.position;
  db.prepare('UPDATE channels SET name = ?, position = ? WHERE id = ?').run(name, position, ch.id);
  broadcast('channels');
  res.json(db.prepare('SELECT * FROM channels WHERE id = ?').get(ch.id));
});

admin.delete('/channels/:id', (req, res) => {
  const ch = getChannel(req.params.id);
  if (db.prepare('SELECT count(*) AS n FROM channels').get().n <= 1) throw new HttpError(400, 'Die letzte Gruppe kann nicht gelöscht werden');
  db.prepare('DELETE FROM channels WHERE id = ?').run(ch.id);
  broadcast('channels');
  res.json({ ok: true });
});

// Dienstplan-Import
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

function suggestAssignments(grid) {
  const people = db.prepare('SELECT * FROM people').all();
  return grid.rows.map((row) => {
    if (row.kind !== 'person') return null;
    const key = normName(row.label);
    const hit = people.find((p) => normName(p.roster_name) === key) || people.find((p) => normName(p.name) === key);
    return hit ? hit.id : 'new';
  });
}

const rosterOut = (r) => ({ ...r, grid: JSON.parse(r.grid) });

admin.post('/rosters', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Bitte ein PDF auswählen');
  const attachment = saveAttachment(req.file, req.person.id);
  const buffer = fs.readFileSync(req.file.path);
  let wanted = String(req.body?.method || 'auto');
  if (wanted === 'auto') wanted = claudeAvailable() ? 'claude' : 'text';
  const warnings = [];
  let result = null;
  let method = wanted;
  if (wanted === 'claude') {
    try {
      result = await parseRosterPdfClaude(buffer);
    } catch (err) {
      console.warn('KI-Erkennung fehlgeschlagen:', err);
      warnings.push(`KI-Erkennung fehlgeschlagen (${err.message}) – Textebene des PDFs verwendet.`);
      method = 'text';
    }
  }
  if (!result && method === 'text') {
    try {
      result = await parseRosterPdfText(buffer);
    } catch (err) {
      warnings.push(err.message);
    }
  }
  if (!result) {
    // Nichts erkannt: leere Woche zum Ausfüllen anbieten (mit bekannten Namen).
    method = 'manual';
    const monday = new Date(); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    const dates = Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 864e5).toISOString().slice(0, 10));
    const rows = db.prepare("SELECT roster_name FROM people WHERE roster_name IS NOT NULL AND roster_name != '' ORDER BY name").all()
      .map((p) => ({ label: p.roster_name, kind: 'person', cells: Array(7).fill('') }));
    result = { grid: { title: '', dates, rows }, warnings: [] };
  }
  warnings.push(...result.warnings);
  const grid = sanitizeGrid(result.grid);
  const r = db.prepare('INSERT INTO rosters (title, week_start, attachment_id, method, grid, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(grid.title, grid.dates[0], attachment.id, method, JSON.stringify(grid), req.person.id);
  res.json({ roster: rosterOut(db.prepare('SELECT * FROM rosters WHERE id = ?').get(r.lastInsertRowid)), assignments: suggestAssignments(grid), warnings });
});

// Trägt einen Eintrag ein. Veranstaltungen, die schon aus einer anderen Quelle (Dienstplan bzw.
// Spielplan) mit gleicher Anfangszeit im Kalender stehen, werden nicht doppelt angelegt.
function insertEvent(e, rosterId, personId) {
  if (e.kind === 'venue' && db.prepare("SELECT 1 FROM events WHERE kind = 'venue' AND start = ? AND roster_id IS NOT ? AND location LIKE 'Prater%'").get(e.start, rosterId)) return 0;
  db.prepare('INSERT INTO events (kind, person_id, roster_id, title, location, notes, start, end, all_day, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.kind, e.person_id, rosterId, e.title, e.location, e.notes || '', e.start, e.end, e.all_day, personId);
  return 1;
}

// Spielplan (Monatsübersicht) einlesen: nur Veranstaltungen im Prater.
const SP_TIME = /^\d{2}:\d{2}$/;
function sanitizePlan(input) {
  const month = String(input?.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Monat fehlt');
  const events = (Array.isArray(input.events) ? input.events : []).slice(0, 500).map((e) => ({
    date: String(e.date || ''), start: SP_TIME.test(e.start) ? e.start : null, end: SP_TIME.test(e.end) && SP_TIME.test(e.start) ? e.end : null,
    title: String(e.title || '').trim().slice(0, 300), notes: String(e.notes || '').slice(0, 2000),
    location: String(e.location || 'Prater').slice(0, 60), include: e.include !== false,
  })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title);
  return { type: 'spielplan', title: String(input.title || '').slice(0, 200), month, events };
}

admin.post('/spielplan', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Bitte ein PDF auswählen');
  const attachment = saveAttachment(req.file, req.person.id);
  let plan;
  try {
    plan = sanitizePlan(await parseSpielplanPdf(fs.readFileSync(req.file.path)));
  } catch (err) {
    throw new HttpError(422, `Spielplan nicht erkannt: ${err.message}`);
  }
  const r = db.prepare("INSERT INTO rosters (title, week_start, attachment_id, method, grid, uploaded_by) VALUES (?, ?, ?, 'spielplan', ?, ?)")
    .run(plan.title, `${plan.month}-01`, attachment.id, JSON.stringify(plan), req.person.id);
  const warnings = plan.events.length ? [] : ['Im Spielplan wurden keine Prater-Veranstaltungen gefunden.'];
  res.json({ roster: rosterOut(db.prepare('SELECT * FROM rosters WHERE id = ?').get(r.lastInsertRowid)), warnings });
});

admin.post('/spielplan/:id/publish', (req, res) => {
  const roster = db.prepare("SELECT * FROM rosters WHERE id = ? AND method = 'spielplan'").get(intParam(req.params.id));
  if (!roster) throw new HttpError(404, 'Spielplan nicht gefunden');
  const plan = sanitizePlan(req.body?.plan);
  let count = 0;
  let replaced = false;
  db.exec('BEGIN');
  try {
    // Ältere Fassungen desselben Monats ersetzen ("aktualisierter Spielplan").
    const previous = db.prepare("SELECT id FROM rosters WHERE week_start = ? AND status = 'published' AND method = 'spielplan' AND id != ?").all(`${plan.month}-01`, roster.id);
    for (const p of previous) {
      db.prepare('DELETE FROM events WHERE roster_id = ?').run(p.id);
      db.prepare("UPDATE rosters SET status = 'replaced' WHERE id = ?").run(p.id);
    }
    db.prepare('DELETE FROM events WHERE roster_id = ?').run(roster.id);
    for (const e of plan.events.filter((x) => x.include)) count += insertEvent(venueEvent(e.date, e), roster.id, req.person.id);
    db.prepare("UPDATE rosters SET grid = ?, title = ?, week_start = ?, status = 'published', published_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(plan), plan.title, `${plan.month}-01`, roster.id);
    db.exec('COMMIT');
    replaced = previous.length > 0 || roster.status === 'published';
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  broadcast('events');
  const channel = Number(req.body?.announce_channel_id) && db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(req.body.announce_channel_id));
  if (channel) {
    const attachment = roster.attachment_id && db.prepare('SELECT * FROM attachments WHERE id = ?').get(roster.attachment_id);
    postMessage(channel, req.person, `🎭 ${replaced ? 'Aktualisierter Spielplan' : 'Neuer Spielplan'}: ${plan.title} – ${count} Prater-Veranstaltungen stehen jetzt im Kalender.`, attachment);
  }
  res.json({ ok: true, events: count, replaced });
});

admin.get('/rosters', (req, res) => {
  res.json(db.prepare(`SELECT r.id, r.title, r.week_start, r.method, r.status, r.created_at, r.published_at, r.attachment_id
    FROM rosters r ORDER BY r.id DESC LIMIT 50`).all());
});

admin.get('/rosters/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM rosters WHERE id = ?').get(intParam(req.params.id));
  if (!r) throw new HttpError(404, 'Dienstplan nicht gefunden');
  const roster = rosterOut(r);
  if (r.method === 'spielplan') return res.json({ roster, warnings: [] });
  res.json({ roster, assignments: suggestAssignments(roster.grid), warnings: [] });
});

admin.post('/rosters/:id/publish', (req, res) => {
  const roster = db.prepare('SELECT * FROM rosters WHERE id = ?').get(intParam(req.params.id));
  if (!roster) throw new HttpError(404, 'Dienstplan nicht gefunden');
  let grid;
  try { grid = sanitizeGrid(req.body?.grid); } catch (err) { throw new HttpError(400, err.message); }
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  const announceId = Number(req.body?.announce_channel_id) || null;

  let count = 0;
  let replaced = false;
  db.exec('BEGIN');
  try {
    // Personenzeilen zuordnen; unbekannte Namen werden als Person ohne App-Zugang angelegt.
    const personIds = grid.rows.map((row, i) => {
      if (row.kind !== 'person') return null;
      const a = assignments[i];
      if (a === 'new') {
        const existing = db.prepare('SELECT id FROM people WHERE roster_name = ? COLLATE NOCASE').get(row.label);
        return existing ? existing.id : createPerson({ name: row.label, rosterName: row.label, role: 'none', color: nextColor() }).id;
      }
      const id = Number(a);
      return Number.isInteger(id) && db.prepare('SELECT 1 FROM people WHERE id = ?').get(id) ? id : null;
    });
    // Ältere Fassungen derselben Woche ersetzen ("Änderungen vorbehalten").
    const previous = db.prepare("SELECT id FROM rosters WHERE week_start = ? AND status = 'published' AND method != 'spielplan' AND id != ?").all(grid.dates[0], roster.id);
    for (const p of previous) {
      db.prepare('DELETE FROM events WHERE roster_id = ?').run(p.id);
      db.prepare("UPDATE rosters SET status = 'replaced' WHERE id = ?").run(p.id);
    }
    db.prepare('DELETE FROM events WHERE roster_id = ?').run(roster.id);
    for (const e of gridToEvents(grid, personIds)) count += insertEvent(e, roster.id, req.person.id);
    db.prepare("UPDATE rosters SET grid = ?, title = ?, week_start = ?, status = 'published', published_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(grid), grid.title, grid.dates[0], roster.id);
    db.exec('COMMIT');
    replaced = previous.length > 0 || roster.status === 'published';
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  broadcast('events');
  broadcast('people');
  const label = grid.title.replace(/^\s*Dienstplan\s*:?\s*/i, '') || `Woche ab ${grid.dates[0].split('-').reverse().join('.')}`;
  const channel = announceId && db.prepare('SELECT * FROM channels WHERE id = ?').get(announceId);
  if (channel) {
    const attachment = roster.attachment_id && db.prepare('SELECT * FROM attachments WHERE id = ?').get(roster.attachment_id);
    postMessage(channel, req.person, `📅 ${replaced ? 'Aktualisierter Dienstplan' : 'Neuer Dienstplan'}: ${label} – die Dienste stehen jetzt im Kalender.`, attachment);
  }
  res.json({ ok: true, events: count, replaced });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Serverfehler' : err.code === 'LIMIT_FILE_SIZE' ? 'Datei zu groß (max. 25 MB)' : err.message });
});

const admin0 = bootstrap();
app.listen(PORT, () => {
  console.log(`Dienstplan-App läuft auf http://localhost:${PORT}`);
  if (admin0) {
    console.log(`\nErster Start – dein Admin-Link (geheim halten!):\n  ${(process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '')}/join/${admin0.token}\n`);
  }
});
