// PDF-Import für Dienstplan, Spielplan und Probenplan: Art erkennen, Entwurf anlegen, veröffentlichen.
// Wird von der Verwaltung (Hochladen) und vom E-Mail-Eingang benutzt.
import { db, createPerson, nextColor } from './db.js';
import { broadcast } from './notify.js';
import { postMessage } from './messages.js';
import { gridToEvents, sanitizeGrid, venueEvent, parsePersonCell } from './roster.js';
import { pdfPages, itemsToGrid } from './pdf-text.js';
import { ocrPdfItems, ocrAvailable } from './pdf-ocr.js';
import { PLAN_FIELDS, sameSlot, mergeEdit } from './edits.js';
import { parseRosterPdfClaude, claudeAvailable } from './pdf-claude.js';
import { spielplanFromPages } from './spielplan.js';
import { probenplanFromPages } from './probenplan.js';

export class ImportError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const TYPE_LABELS = { dienstplan: 'Dienstplan', spielplan: 'Spielplan', probenplan: 'Probenplan' };

// Welche Art von PDF ist das? Scans ohne Text gelten als Dienstplan.
export function detectType(pages) {
  const text = pages.flat().map((i) => i.str).join(' ');
  if (/Spielplan/i.test(text) && /Stock\s*&\s*Prater|Gastspiele/i.test(text)) return 'spielplan';
  if (/Dienstplan/i.test(text)) return 'dienstplan';
  if (/(End)?proben|Probenplan|Probebühne/i.test(text)) return 'probenplan';
  return 'dienstplan';
}

const rosterOut = (r) => ({ ...r, grid: JSON.parse(r.grid) });
export const getRoster = (id) => {
  const r = db.prepare('SELECT * FROM rosters WHERE id = ?').get(id);
  return r ? rosterOut(r) : null;
};

const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
export function suggestAssignments(grid) {
  const people = db.prepare('SELECT * FROM people').all();
  return grid.rows.map((row) => {
    if (row.kind !== 'person') return null;
    const key = normName(row.label);
    const hit = people.find((p) => normName(p.roster_name) === key) || people.find((p) => normName(p.name) === key);
    return hit ? hit.id : 'new';
  });
}

// Kalender "Proben" für Probenpläne (wird beim ersten Mal angelegt).
export function probenCalendar() {
  const c = db.prepare("SELECT * FROM calendars WHERE name = 'Proben' COLLATE NOCASE").get();
  if (c) return c;
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM calendars').get().p;
  const r = db.prepare("INSERT INTO calendars (name, color, position) VALUES ('Proben', '#8b5cf6', ?)").run(pos);
  broadcast('calendars');
  return db.prepare('SELECT * FROM calendars WHERE id = ?').get(r.lastInsertRowid);
}

function saveDraft(type, { title, weekStart, attachmentId, method, data, personId }) {
  const r = db.prepare('INSERT INTO rosters (title, week_start, attachment_id, method, grid, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, weekStart, attachmentId, method, JSON.stringify(data), personId ?? null);
  return getRoster(Number(r.lastInsertRowid));
}

// Hinweise auf wahrscheinliche Lesefehler, z. B. "01:00-17:00" statt "09:00-17:00".
const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
function implausibleShifts(grid) {
  const out = [];
  for (const row of grid.rows.filter((r) => r.kind === 'person')) {
    row.cells.forEach((cell, i) => {
      const p = parsePersonCell(cell);
      if (p.type !== 'shift' || !p.end) return;
      const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      const length = (mins(p.end) - mins(p.start) + 1440) % 1440;
      if (length > 12 * 60 || mins(p.start) < 6 * 60) out.push(`${row.label}, ${WEEKDAY_SHORT[i]}: ${p.start}–${p.end} sieht ungewöhnlich aus – bitte prüfen.`);
    });
  }
  return out;
}

// Liest ein PDF und legt einen Entwurf an. type: auto | dienstplan | spielplan | probenplan
export async function createDraft(buffer, { attachmentId, personId, type = 'auto', method = 'auto' }) {
  let pages = [];
  try { pages = await pdfPages(buffer); } catch (err) { if (type !== 'dienstplan') throw new ImportError(422, `PDF nicht lesbar: ${err.message}`); }
  const kind = type === 'auto' ? detectType(pages) : type;
  const warnings = [];

  if (kind === 'spielplan') {
    const plan = spielplanFromPages(pages);
    if (!plan.month) throw new ImportError(422, 'Spielplan nicht erkannt: Monat fehlt.');
    plan.events = plan.events.map((e) => ({ ...e, include: true }));
    if (!plan.events.length) warnings.push('Im Spielplan wurden keine Prater-Veranstaltungen gefunden.');
    const roster = saveDraft(kind, { title: plan.title, weekStart: `${plan.month}-01`, attachmentId, method: 'spielplan', data: { type: 'spielplan', ...plan }, personId });
    return { type: kind, roster, warnings };
  }

  if (kind === 'probenplan') {
    const plan = probenplanFromPages(pages);
    if (!plan.events.length) throw new ImportError(422, 'Im Probenplan wurden keine Termine gefunden.');
    const data = { type: 'probenplan', ...plan, calendar_id: probenCalendar().id, events: plan.events.map((e) => ({ ...e, include: true })) };
    const roster = saveDraft(kind, { title: plan.title, weekStart: plan.events[0].date, attachmentId, method: 'probenplan', data, personId });
    return { type: kind, roster, warnings };
  }

  // Dienstplan: KI (wenn Schlüssel da), sonst Textebene, sonst leere Woche zum Ausfüllen.
  let wanted = method === 'auto' ? (claudeAvailable() ? 'claude' : 'text') : method;
  let result = null;
  if (wanted === 'claude') {
    try {
      result = await parseRosterPdfClaude(buffer);
    } catch (err) {
      console.warn('KI-Erkennung fehlgeschlagen:', err);
      warnings.push(`KI-Erkennung fehlgeschlagen (${err.message}) – Textebene des PDFs verwendet.`);
      wanted = 'text';
    }
  }
  if (!result && wanted === 'text') {
    try {
      if ((pages[0] || []).length < 10) throw new Error('Das PDF enthält keinen lesbaren Text (reiner Bild-Scan).');
      result = itemsToGrid(pages[0]);
    } catch (err) {
      // Textebene unbrauchbar (Bild-Scan oder Zeichensalat wie bei „Microsoft Print to PDF“) → Bild lesen.
      if (ocrAvailable()) wanted = 'ocr';
      else warnings.push(`${err.message} Bitte die KI-Erkennung nutzen oder den Plan in der Vorschau eintragen.`);
    }
  }
  if (!result && wanted === 'ocr') {
    try {
      result = itemsToGrid(await ocrPdfItems(buffer));
      result.warnings.unshift('Per Texterkennung aus dem Bild gelesen – bitte besonders genau prüfen.');
    } catch (err) {
      console.warn('Texterkennung fehlgeschlagen:', err);
      warnings.push(`Texterkennung fehlgeschlagen: ${err.message}`);
    }
  }
  if (!result) {
    wanted = 'manual';
    const monday = new Date(); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    const dates = Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 864e5).toISOString().slice(0, 10));
    const rows = db.prepare("SELECT roster_name FROM people WHERE roster_name IS NOT NULL AND roster_name != '' ORDER BY name").all()
      .map((p) => ({ label: p.roster_name, kind: 'person', cells: Array(7).fill('') }));
    result = { grid: { title: '', dates, rows }, warnings: [] };
  }
  warnings.push(...result.warnings);
  const grid = sanitizeGrid(result.grid);
  warnings.push(...implausibleShifts(grid));
  const roster = saveDraft('dienstplan', { title: grid.title, weekStart: grid.dates[0], attachmentId, method: wanted, data: grid, personId });
  return { type: 'dienstplan', roster, assignments: suggestAssignments(grid), warnings };
}

// Trägt einen Eintrag ein. Prater-Veranstaltungen, die schon aus einer anderen Quelle (Dienst- bzw.
// Spielplan) mit gleicher Anfangszeit im Kalender stehen, werden nicht doppelt angelegt.
function insertEvent(e, rosterId, personId) {
  if (e.kind === 'venue' && db.prepare("SELECT 1 FROM events WHERE kind = 'venue' AND start = ? AND roster_id IS NOT ? AND location LIKE 'Prater%'").get(e.start, rosterId)) return 0;
  db.prepare('INSERT INTO events (kind, person_id, roster_id, calendar_id, title, location, notes, start, end, all_day, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.kind, e.person_id ?? null, rosterId, e.calendar_id ?? null, e.title, e.location || '', e.notes || '', e.start, e.end, e.all_day, personId ?? null);
  return 1;
}

// Ältere veröffentlichte Fassungen ersetzen ("Änderungen vorbehalten", "aktualisierter Spielplan").
const DIENSTPLAN_METHODS = ['claude', 'text', 'ocr', 'manual'];
// Gibt zurück, ob ersetzt wurde, und die von Hand bearbeiteten Termine der alten Fassungen.
function replacePrevious(roster, sameVersion) {
  const family = DIENSTPLAN_METHODS.includes(roster.method) ? DIENSTPLAN_METHODS : [roster.method];
  const previous = db.prepare(`SELECT * FROM rosters WHERE status = 'published' AND id != ? AND method IN (${family.map(() => '?').join(',')})`)
    .all(roster.id, ...family).map(rosterOut).filter(sameVersion);
  const ids = [...previous.map((p) => p.id), roster.id];
  const edited = db.prepare(`SELECT * FROM events WHERE original IS NOT NULL AND roster_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  for (const p of previous) {
    db.prepare('DELETE FROM events WHERE roster_id = ?').run(p.id);
    db.prepare("UPDATE rosters SET status = 'replaced' WHERE id = ?").run(p.id);
  }
  db.prepare('DELETE FROM events WHERE roster_id = ?').run(roster.id);
  return { replaced: previous.length > 0 || roster.status === 'published', edited };
}

// Änderungen von Hand (längerer Dienst, Notizen …) auf die neu eingelesenen Termine übertragen.
function carryOverEdits(edited, rosterId) {
  if (!edited.length) return 0;
  const fresh = db.prepare('SELECT * FROM events WHERE roster_id = ?').all(rosterId);
  const used = new Set();
  let kept = 0;
  for (const old of edited) {
    const target = fresh.find((e) => !used.has(e.id) && sameSlot(old, e));
    if (!target) continue;
    used.add(target.id);
    const { fields, original } = mergeEdit(old, target);
    if (!original) continue;
    db.prepare(`UPDATE events SET ${PLAN_FIELDS.map((f) => `${f} = ?`).join(', ')}, original = ? WHERE id = ?`)
      .run(...PLAN_FIELDS.map((f) => fields[f]), original, target.id);
    kept++;
  }
  return kept;
}

export const typeOf = (roster) => (['spielplan', 'probenplan'].includes(roster.method) ? roster.method : 'dienstplan');

function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
}

function announce(channelId, person, text, roster) {
  const channel = channelId && db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!channel) return;
  const attachment = roster.attachment_id && db.prepare('SELECT * FROM attachments WHERE id = ?').get(roster.attachment_id);
  postMessage(channel, person, text, attachment);
}

export function publishDienstplan(roster, gridInput, assignments, person, announceChannelId) {
  let grid;
  try { grid = sanitizeGrid(gridInput); } catch (err) { throw new ImportError(400, err.message); }
  const { count, replaced } = transaction(() => {
    // Personenzeilen zuordnen; unbekannte Namen werden als Person ohne App-Zugang angelegt.
    const personIds = grid.rows.map((row, i) => {
      if (row.kind !== 'person') return null;
      const a = assignments?.[i];
      if (a === 'new') {
        const existing = db.prepare('SELECT id FROM people WHERE roster_name = ? COLLATE NOCASE').get(row.label);
        return existing ? existing.id : createPerson({ name: row.label, rosterName: row.label, role: 'none', color: nextColor() }).id;
      }
      const id = Number(a);
      return Number.isInteger(id) && db.prepare('SELECT 1 FROM people WHERE id = ?').get(id) ? id : null;
    });
    const { replaced: rep, edited } = replacePrevious(roster, (p) => p.week_start === grid.dates[0]);
    let n = 0;
    for (const e of gridToEvents(grid, personIds)) n += insertEvent(e, roster.id, person?.id);
    carryOverEdits(edited, roster.id);
    db.prepare("UPDATE rosters SET grid = ?, title = ?, week_start = ?, status = 'published', published_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(grid), grid.title, grid.dates[0], roster.id);
    return { count: n, replaced: rep };
  });
  broadcast('events');
  broadcast('people');
  const label = grid.title.replace(/^\s*Dienstplan\s*:?\s*/i, '') || `Woche ab ${grid.dates[0].split('-').reverse().join('.')}`;
  announce(announceChannelId, person, `📅 ${replaced ? 'Aktualisierter Dienstplan' : 'Neuer Dienstplan'}: ${label} – die Dienste stehen jetzt im Kalender.`, roster);
  return { events: count, replaced };
}

const TIME = /^\d{2}:\d{2}$/;
function sanitizeEvents(list) {
  return (Array.isArray(list) ? list : []).slice(0, 500).map((e) => ({
    date: String(e.date || ''), start: TIME.test(e.start) ? e.start : null, end: TIME.test(e.end) && TIME.test(e.start) ? e.end : null,
    title: String(e.title || '').trim().slice(0, 300), notes: String(e.notes || '').slice(0, 2000),
    location: String(e.location || 'Prater').slice(0, 60), include: e.include !== false,
  })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title);
}

export function publishSpielplan(roster, input, person, announceChannelId) {
  const month = String(input?.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ImportError(400, 'Monat fehlt');
  const plan = { type: 'spielplan', title: String(input.title || '').slice(0, 200), month, events: sanitizeEvents(input.events) };
  const { count, replaced } = transaction(() => {
    const { replaced: rep, edited } = replacePrevious(roster, (p) => p.week_start === `${month}-01`);
    let n = 0;
    for (const e of plan.events.filter((x) => x.include)) n += insertEvent(venueEvent(e.date, e), roster.id, person?.id);
    carryOverEdits(edited, roster.id);
    db.prepare("UPDATE rosters SET grid = ?, title = ?, week_start = ?, status = 'published', published_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(plan), plan.title, `${month}-01`, roster.id);
    return { count: n, replaced: rep };
  });
  broadcast('events');
  announce(announceChannelId, person, `🎭 ${replaced ? 'Aktualisierter Spielplan' : 'Neuer Spielplan'}: ${plan.title} – ${count} Prater-Veranstaltungen stehen jetzt im Kalender.`, roster);
  return { events: count, replaced };
}

export function publishProbenplan(roster, input, person, announceChannelId) {
  const calendar = db.prepare('SELECT * FROM calendars WHERE id = ?').get(Number(input?.calendar_id)) || probenCalendar();
  const plan = { type: 'probenplan', title: String(input?.title || '').slice(0, 200), key: String(input?.key || roster.grid.key || ''), calendar_id: calendar.id, events: sanitizeEvents(input?.events) };
  if (!plan.events.length) throw new ImportError(400, 'Keine Termine ausgewählt');
  const { count, replaced } = transaction(() => {
    // Neue Fassung desselben Plans (gleiche Überschrift) ersetzt die alte.
    const { replaced: rep, edited } = replacePrevious(roster, (p) => p.grid.key && p.grid.key === plan.key);
    let n = 0;
    for (const e of plan.events.filter((x) => x.include)) {
      const ev = venueEvent(e.date, e);
      n += insertEvent({ ...ev, kind: 'custom', calendar_id: calendar.id }, roster.id, person?.id);
    }
    carryOverEdits(edited, roster.id);
    db.prepare("UPDATE rosters SET grid = ?, title = ?, week_start = ?, status = 'published', published_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(plan), plan.title, plan.events[0].date, roster.id);
    return { count: n, replaced: rep };
  });
  broadcast('events');
  announce(announceChannelId, person, `🎬 ${replaced ? 'Aktualisierter Probenplan' : 'Neuer Probenplan'}: ${plan.title} – ${count} Termine stehen jetzt im Kalender „${calendar.name}“.`, roster);
  return { events: count, replaced };
}

export function publishDraft(roster, body, person, announceChannelId) {
  if (roster.method === 'spielplan') return publishSpielplan(roster, body.plan, person, announceChannelId);
  if (roster.method === 'probenplan') return publishProbenplan(roster, body.plan, person, announceChannelId);
  return publishDienstplan(roster, body.grid, body.assignments, person, announceChannelId);
}
