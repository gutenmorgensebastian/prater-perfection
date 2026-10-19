import { TEMPLATE, PHASE_KEYS, STATUSES, FIRST_PRODUCTIONS } from '../src/production-template.js';
import { PLAN_FIELDS, sameSlot, mergeEdit } from '../src/edits.js';
// Pratomat Lite: ersetzt den Server durch eine Nachbildung im Browser (eine Datei, kein Server nötig).
// Gleiche API wie server.js. Die Daten liegen nur auf diesem Gerät in IndexedDB.
// Abgeleitet aus der Demo; bei Änderungen an der API in server.js hier nachziehen.
import { gridToEvents, sanitizeGrid, venueEvent } from '../src/roster.js';
import { parseRosterPdfText, pdfTextItems } from '../src/pdf-text.js';
import { getPdfjs } from './pdfjs-shim.js';
import { buildIcs } from '../src/ics.js';
import { spielplanFromPages } from '../src/spielplan.js';
import { pdfPages } from '../src/pdf-text.js';
const normTagClient = (t) => String(t ?? '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 30);
import { probenplanFromPages } from '../src/probenplan.js';

const KEY = 'pratomat-lite-v1';
const BASE = 'https://pratomat.lokal';
const LITE_NO_CHAT = true; // kein Chat in der Lite-Version

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const rand = () => Math.random().toString(36).slice(2, 14);

function seed() {
  const db = {
    seq: 100, me: 1, named: false,
    people: [{ id: 1, name: 'Ich', roster_name: '', role: 'admin', color: '#4363d8', token: rand(), feed_token: rand() }],
    channels: [{ id: 1, name: 'Allgemein', position: 0 }],
    attachments: [], messages: [], events: [], rosters: [], todos: [], questions: [], infos: [], orders: [],
    calendars: [],
  };
  seedProductions(db);
  return db;
}

// Produktionen mit Vorlage; bei Perfection ein paar Beispiele.
function addProduction(d, name, by = null, extra = {}) {
  const id = ++d.seq;
  d.productions.push({ id, name, status: 'vorbereitung', premiere: null, venue: 'Prater', position: d.productions.length + 1, created_by: by, created_at: nowIso(), ...extra });
  TEMPLATE.forEach((t, i) => d.prod_pages.push({ id: ++d.seq, production_id: id, phase: t.phase, title: t.title, body: t.body || '', hint: t.hint || '', date: null, position: i + 1, created_by: by, updated_by: null, updated_at: nowIso(), attachments: [] }));
  return id;
}
function seedProductions(d) {
  d.productions = []; d.prod_pages = []; d.prod_links = [];
  FIRST_PRODUCTIONS.forEach((n) => addProduction(d, n));
}

// --- Speicher: IndexedDB (Fallback localStorage) ---------------------------------------
const idb = () => new Promise((resolve, reject) => {
  const r = indexedDB.open('pratomat-lite', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const idbGet = async (k) => { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
const idbSet = async (k, v) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); };
let useIdb = true;
let db;
try {
  const raw = await idbGet(KEY);
  db = raw ? JSON.parse(raw) : null;
} catch { useIdb = false; }
if (!useIdb) { try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; } }
db ||= seed();
if (!db.productions) seedProductions(db);
try { navigator.storage?.persist?.(); } catch { /* egal */ }

let saveTimer = null;
let saveFailed = false;
async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  const json = JSON.stringify(db);
  try {
    if (useIdb) await idbSet(KEY, json); else localStorage.setItem(KEY, json);
    saveFailed = false;
  } catch (err) {
    if (!saveFailed) { saveFailed = true; window.dispatchEvent(new CustomEvent('lite-save-failed', { detail: err })); }
  }
}
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
addEventListener('pagehide', () => { if (saveTimer) flush(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flush(); });
flush();

// Für die Oberfläche (lite-ui.js)
export const liteBackup = () => JSON.stringify(db);
export async function liteRestore(json) {
  const d = JSON.parse(json);
  if (!d || !Array.isArray(d.people) || !Array.isArray(d.events)) throw new Error('Das ist keine Pratomat-Sicherung.');
  db = d; await flush(); location.reload();
}
export async function liteReset() { db = seed(); await flush(); location.reload(); }
export const liteNamed = () => db.named;
export const liteMarkNamed = async () => { db.named = true; await flush(); };
export const liteFlush = flush;
// Kalenderdatei wie der Server-Feed (/cal/….ics)
export function liteIcs({ people = [], venue = false, custom = true, cals = [], off = false }) {
  const kinds = [];
  if (people.length) kinds.push('shift');
  if (people.length && off) kinds.push('off');
  const from = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const rows = db.events.filter((e) => e.start >= from).filter((e) =>
    (kinds.includes(e.kind) && people.includes(e.person_id))
    || (e.kind === 'venue' && venue)
    || (e.kind === 'custom' && (e.calendar_id ? cals.includes(e.calendar_id) : custom)))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((e) => ({ ...e, person_name: db.people.find((p) => p.id === e.person_id)?.name ?? null }));
  return buildIcs(rows, { name: 'Pratomat', host: 'pratomat.lokal' });
}
export const demoPeople = () => db.people.filter((p) => p.role !== 'none');
export const attachmentById = (id) => db.attachments.find((a) => a.id === Number(id));

// --- Live-Updates ------------------------------------------------------------------
const sources = new Set();
class DemoEventSource {
  constructor() { this.l = {}; sources.add(this); }
  addEventListener(t, fn) { (this.l[t] ||= []).push(fn); }
  close() { sources.delete(this); }
}
const broadcast = (type, data = {}) => setTimeout(() => sources.forEach((s) => (s.l[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) }))), 0);

// --- API ---------------------------------------------------------------------------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const me = () => db.people.find((p) => p.id === db.me) || db.people[0];
const pub = (p) => ({ id: p.id, name: p.name, color: p.color, role: p.role, roster_name: p.roster_name });
const adminP = (p) => ({ ...pub(p), invite_link: p.role !== 'none' ? `${BASE}/join/${p.token}` : null });
const person = (id) => db.people.find((p) => p.id === id);
function msgOut(m) {
  const p = person(m.person_id); const a = attachmentById(m.attachment_id);
  return { ...m, person_name: p?.name ?? null, person_color: p?.color ?? null, file_name: a?.original_name ?? null, file_mime: a?.mime ?? null, file_size: a?.size ?? null };
}
const channel = (id) => { const c = db.channels.find((x) => x.id === Number(id)); if (!c) throw new HttpError(404, 'Gruppe nicht gefunden'); return c; };
const writer = () => { if (me().role === 'viewer') throw new HttpError(403, 'Nur Lesezugriff'); };
const adminOnly = () => { if (me().role !== 'admin') throw new HttpError(403, 'Nur für Admins'); };
const fileToAttachment = async (file) => {
  if (!file || !file.size) return null;
  const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const a = { id: ++db.seq, original_name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data };
  db.attachments.push(a);
  return a;
};
const nextColor = () => ['#469990', '#808000', '#000075', '#e76f51', '#9a6324'][db.people.length % 5];

function readEvent(b) {
  const title = String(b.title || '').trim();
  if (!title) throw new HttpError(400, 'Titel fehlt');
  let end = b.end || null;
  if (b.all_day && (!end || end === b.start)) { const d = new Date(`${b.start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); end = iso(d); }
  if (end && end < b.start) throw new HttpError(400, 'Das Ende liegt vor dem Beginn');
  const calendar_id = Number(b.calendar_id) || null;
  if (calendar_id && !db.calendars.some((c) => c.id === calendar_id)) throw new HttpError(400, 'Kalender gibt es nicht');
  return { title, start: b.start, end, all_day: b.all_day ? 1 : 0, location: b.location || '', notes: b.notes || '', calendar_id };
}
function editable(id) {
  const e = db.events.find((x) => x.id === Number(id));
  if (!e) throw new HttpError(404, 'Termin nicht gefunden');
  if (!(me().role === 'admin' || (e.kind === 'custom' && !e.roster_id && e.created_by === me().id && me().role !== 'viewer'))) throw new HttpError(403, 'Diesen Termin darfst du nicht löschen');
  return e;
}
// Bearbeiten wie auf dem Server: Admins alles, sonst eigene Dienste, eingelesene Veranstaltungen/Proben, eigene Termine.
function editableForEdit(id) {
  const e = db.events.find((x) => x.id === Number(id));
  if (!e) throw new HttpError(404, 'Termin nicht gefunden');
  const p = me();
  const ok = p.role === 'admin' || (p.role !== 'viewer' && (e.kind === 'custom' && !e.roster_id ? e.created_by === p.id
    : e.kind === 'shift' || e.kind === 'off' ? e.person_id === p.id : Boolean(e.roster_id)));
  if (!ok) throw new HttpError(403, 'Diesen Termin darfst du nicht ändern');
  return e;
}
// Neue Planfassung: bearbeitete Termine merken, alte entfernen, danach Änderungen übertragen.
function takeEdited(drop) {
  const edited = db.events.filter((e) => drop.has(e.roster_id) && e.original);
  db.events = db.events.filter((e) => !drop.has(e.roster_id));
  return edited;
}
function carryEdits(edited, rosterId) {
  const fresh = db.events.filter((e) => e.roster_id === rosterId);
  const used = new Set();
  for (const old of edited) {
    const t = fresh.find((e) => !used.has(e.id) && sameSlot(old, { notes: '', location: '', ...e }));
    if (!t) continue;
    used.add(t.id);
    const { fields, original } = mergeEdit(old, { notes: '', location: '', ...t });
    if (original) Object.assign(t, fields, { original });
  }
}
function postMessage(ch, p, body, a) {
  if (LITE_NO_CHAT) return null;
  const m = { id: ++db.seq, channel_id: ch.id, person_id: p?.id ?? null, body, attachment_id: a?.id ?? null, pinned: 0, created_at: nowIso() };
  db.messages.push(m);
  broadcast('message', msgOut(m));
  return msgOut(m);
}
const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const suggest = (grid) => grid.rows.map((r) => {
  if (r.kind !== 'person') return null;
  const hit = db.people.find((p) => norm(p.roster_name) === norm(r.label)) || db.people.find((p) => norm(p.name) === norm(r.label));
  return hit ? hit.id : 'new';
});

// Helfer für die neuen Reiter
const CATEGORIES = ['Ansage', 'Sicherheit', 'Anleitung', 'Dokument', 'Allgemein'];
const attOut = (ids) => ids.map(attachmentById).filter(Boolean).map((a) => ({ id: a.id, name: a.original_name, mime: a.mime, size: a.size }));
const todo = (id) => { const t = db.todos.find((x) => x.id === Number(id)); if (!t) throw new HttpError(404, 'To-Do nicht gefunden'); return t; };
const todosOut = () => {
  const sorted = [...db.todos].sort((a, b) => a.position - b.position || a.id - b.id);
  return sorted.filter((t) => !t.parent_id).map((t) => ({ ...t, attachments: attOut(t.attachments), subtasks: sorted.filter((x) => x.parent_id === t.id) }));
};
function reorder(list, ids) {
  const items = ids.map((id) => list.find((x) => x.id === Number(id))).filter(Boolean);
  const slots = items.map((x) => x.position).sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 0.001;
  items.forEach((x, i) => { x.position = slots[i]; });
}
const question = (id) => { const x = db.questions.find((y) => y.id === Number(id)); if (!x || (x.from_id !== me().id && x.to_id !== me().id)) throw new HttpError(404, 'Frage nicht gefunden'); return x; };
function questionsFor(pid) {
  return db.questions.filter((x) => x.from_id === pid || x.to_id === pid)
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.updated_at.localeCompare(a.updated_at) || b.id - a.id)
    .map((x) => {
      const f = person(x.from_id); const t = person(x.to_id);
      const lastBy = x.replies.length ? x.replies[x.replies.length - 1].person_id : x.from_id;
      return { ...x, from_name: f?.name, from_color: f?.color, to_name: t?.name, to_color: t?.color, replies: x.replies.map((r) => ({ ...r, question_id: x.id, person_name: person(r.person_id)?.name })), waiting_for_me: x.status === 'open' && lastBy !== pid };
    });
}
const canSeeInfo = (i) => !i.restricted || me().role === 'admin' || (i.viewers || []).includes(me().id);
const setVisibility = (i, b) => {
  if (me().role !== 'admin' || b.restricted === undefined) return;
  i.restricted = b.restricted ? 1 : 0; i.viewers = b.restricted ? (b.viewers || []).map(Number) : [];
};
const info = (id) => {
  const i = db.infos.find((x) => x.id === Number(id)); if (!i || !canSeeInfo(i)) throw new HttpError(404, 'Info nicht gefunden');
  if (i.restricted && me().role !== 'admin') throw new HttpError(403, 'Vertrauliche Infos können nur Admins ändern');
  if (i.created_by !== me().id && me().role !== 'admin') throw new HttpError(403, 'Nur wer die Info angelegt hat (oder ein Admin) kann sie ändern');
  return i;
};
const infosOut = () => [...db.infos].filter(canSeeInfo).sort((a, b) => a.position - b.position || a.id - b.id).map((i) => ({ ...i, restricted: i.restricted || 0, viewers: i.restricted ? i.viewers || [] : [], author: person(i.created_by)?.name, attachments: attOut(i.attachments) }));
const prod = (id) => { const p = db.productions.find((x) => x.id === Number(id)); if (!p) throw new HttpError(404, 'Produktion nicht gefunden'); return p; };
const prodPage = (id) => { const p = db.prod_pages.find((x) => x.id === Number(id)); if (!p) throw new HttpError(404, 'Unterpunkt nicht gefunden'); return p; };
const pageOut = (pg) => ({ ...pg, updated_name: person(pg.updated_by)?.name ?? null, attachments: attOut(pg.attachments || []) });
function prodUpcoming(name) {
  const today = iso(new Date());
  return db.events.filter((e) => ['venue', 'custom'].includes(e.kind) && e.start >= today && e.title.toLowerCase().includes(name.toLowerCase()))
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6).map((e) => ({ ...e, calendar: db.calendars.find((c) => c.id === e.calendar_id)?.name ?? null }));
}
const prodOut = (p) => ({ ...p, links: db.prod_links.filter((l) => l.production_id === p.id).sort((a, b) => a.position - b.position),
  pages: db.prod_pages.filter((x) => x.production_id === p.id).sort((a, b) => a.position - b.position || a.id - b.id).map(pageOut), upcoming: prodUpcoming(p.name) });
function prodUrl(v) {
  let url = String(v || '').trim(); if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); return u.href; } catch { throw new HttpError(400, 'Das ist kein gültiger Link'); }
}
const ORDER_RANK = (o) => (o.status === 'done' ? 1 : 0);
const ordersOut = () => [...db.orders].sort((a, b) => ORDER_RANK(a) - ORDER_RANK(b) || b.updated_at.localeCompare(a.updated_at) || b.id - a.id)
  .map((o) => ({ ...o, claimed_name: person(o.claimed_by)?.name ?? null, claimed_color: person(o.claimed_by)?.color ?? null, created_name: person(o.created_by)?.name ?? null, attachments: attOut(o.attachments) }));

// Ruft einen anderen Demo-Endpunkt auf (für die gebündelten Import-Wege).
const callRoute = (method, path, body) => {
  for (const [m, re, fn] of routes) { const match = m === method && path.match(re); if (match) return fn(match, new URLSearchParams(), body); }
  throw new HttpError(404, 'Nicht gefunden');
};
function detectType(pages) {
  const text = pages.flat().map((i) => i.str).join(' ');
  if (/Spielplan/i.test(text) && /Stock\s*&\s*Prater|Gastspiele/i.test(text)) return 'spielplan';
  if (/Dienstplan/i.test(text)) return 'dienstplan';
  if (/(End)?proben|Probenplan|Probebühne/i.test(text)) return 'probenplan';
  return 'dienstplan';
}
const typeOf = (r) => (['spielplan', 'probenplan'].includes(r.method) ? r.method : 'dienstplan');
const probenCal = () => {
  let c = db.calendars.find((x) => x.name.toLowerCase() === 'proben');
  if (!c) { c = { id: ++db.seq, name: 'Proben', color: '#8b5cf6', position: db.calendars.length }; db.calendars.push(c); broadcast('calendars'); }
  return c;
};

// Rückgängig: vor jedem DELETE wird der Stand gemerkt; beim Zurückholen kommen die betroffenen Einträge wieder.
const undoStore = new Map();
const UNDO_EVENTS = { people: ['people', 'events'], events: ['events'], calendars: ['calendars', 'events'], channels: ['channels'], messages: ['message-updated'],
  todos: ['todos'], infos: ['infos'], orders: ['orders'], questions: ['questions'], productions: ['productions'], prod_pages: ['productions'], prod_links: ['productions'] };
function undoToken(before) {
  const keys = Object.keys(before).filter((k) => Array.isArray(before[k]) && JSON.stringify(before[k]) !== JSON.stringify(db[k]));
  const token = rand();
  undoStore.set(token, { by: me().id, keys, before });
  setTimeout(() => undoStore.delete(token), 60_000);
  return token;
}

const routes = [
  ['POST', /^\/admin\/import$/, async (m, q, b) => {
    adminOnly(); const file = b.get('file'); if (!file || !file.size) throw new HttpError(400, 'Bitte ein PDF auswählen');
    let type = b.get('type') || 'auto';
    if (type === 'auto') { try { type = detectType(await pdfPages(await file.arrayBuffer())); } catch { type = 'dienstplan'; } }
    if (type === 'spielplan') return { type, ...(await callRoute('POST', '/admin/spielplan', b)) };
    if (type === 'probenplan') {
      const a = await fileToAttachment(file);
      const plan = probenplanFromPages(await pdfPages(await file.arrayBuffer()));
      if (!plan.events.length) throw new HttpError(422, 'Im Probenplan wurden keine Termine gefunden.');
      const r = { id: ++db.seq, title: plan.title, week_start: plan.events[0].date, attachment_id: a.id, method: 'probenplan', status: 'draft', created_at: nowIso(),
        grid: { type: 'probenplan', ...plan, calendar_id: probenCal().id, events: plan.events.map((e) => ({ ...e, include: true })) } };
      db.rosters.push(r);
      return { type, roster: r, warnings: [] };
    }
    return { type: 'dienstplan', ...(await callRoute('POST', '/admin/rosters', b)) };
  }],
  ['POST', /^\/admin\/rosters\/(\d+)\/publish$/, (m, q, b) => {
    adminOnly(); const roster = db.rosters.find((x) => x.id === Number(m[1])); if (!roster) throw new HttpError(404, 'Plan nicht gefunden');
    if (roster.method === 'spielplan') return callRoute('POST', `/admin/spielplan/${roster.id}/publish`, b);
    if (roster.method === 'probenplan') {
      const plan = b.plan; const cal = db.calendars.find((c) => c.id === Number(plan.calendar_id)) || probenCal();
      const prev = db.rosters.filter((x) => x.method === 'probenplan' && x.status === 'published' && x.id !== roster.id && x.grid.key === plan.key);
      const replaced = prev.length > 0 || roster.status === 'published';
      prev.forEach((p) => { p.status = 'replaced'; });
      const drop = new Set([roster.id, ...prev.map((p) => p.id)]);
      const edited = takeEdited(drop);
      let count = 0;
      for (const e of plan.events.filter((x) => x.include !== false && x.title)) {
        const ev = venueEvent(e.date, { ...e, start: e.start || null, end: e.start && e.end ? e.end : null });
        db.events.push({ id: ++db.seq, roster_id: roster.id, created_by: me().id, ...ev, kind: 'custom', calendar_id: cal.id }); count++;
      }
      carryEdits(edited, roster.id);
      Object.assign(roster, { grid: { ...plan, calendar_id: cal.id }, status: 'published', published_at: nowIso() });
      broadcast('events');
      const ch = db.channels.find((c) => c.id === Number(b.announce_channel_id));
      if (ch) postMessage(ch, me(), `🎬 ${replaced ? 'Aktualisierter Probenplan' : 'Neuer Probenplan'}: ${plan.title} – ${count} Termine stehen jetzt im Kalender „${cal.name}“.`, attachmentById(roster.attachment_id));
      return { ok: true, events: count, replaced };
    }
    return callRoute('POST', `/admin/rosters-dienst/${roster.id}/publish`, b);
  }],
  ['GET', /^\/admin\/mail$/, () => ({ configured: false, fromEnv: false, host: '', port: 993, user: '', address: '', intervalMin: 5, lastCheck: null, lastError: null, allowed: '', dienstplanAuto: false, log: [] })],
  ['PATCH', /^\/admin\/mail$/, () => { throw new HttpError(400, 'Der E-Mail-Eingang geht erst auf deinem eigenen Server.'); }],
  ['POST', /^\/admin\/mail\/check$/, () => { throw new HttpError(400, 'Der E-Mail-Eingang geht erst auf deinem eigenen Server.'); }],
  ['GET', /^\/me$/, () => ({ calendars: [...db.calendars].sort((a, b) => a.position - b.position), me: { ...pub(me()), feed_token: me().feed_token }, people: [...db.people].sort((a, b) => a.name.localeCompare(b.name)).map(pub), channels: [...db.channels].sort((a, b) => a.position - b.position), vapidPublicKey: 'demo', claude: false, baseUrl: BASE })],
  ['GET', /^\/events$/, (m, q) => db.events.filter((e) => e.start < `${q.get('end')}T99` && (e.end || e.start) >= q.get('start')).sort((a, b) => a.start.localeCompare(b.start))],
  ['POST', /^\/events$/, (m, q, b) => { writer(); const e = { id: ++db.seq, kind: 'custom', person_id: null, roster_id: null, created_by: me().id, ...readEvent(b) }; db.events.push(e); broadcast('events'); return e; }],
  ['PATCH', /^\/events\/(\d+)$/, (m, q, b) => {
    const e = editableForEdit(m[1]);
    if (e.roster_id && !e.original) e.original = JSON.stringify(Object.fromEntries(PLAN_FIELDS.map((f) => [f, e[f] ?? (f === 'notes' || f === 'location' ? '' : null)])));
    const calendarId = e.calendar_id;
    Object.assign(e, readEvent({ ...e, ...b }));
    if (e.kind !== 'custom') e.calendar_id = calendarId;
    broadcast('events'); return e;
  }],
  ['POST', /^\/events\/(\d+)\/reset$/, (m) => {
    const e = editableForEdit(m[1]);
    if (e.original) { Object.assign(e, JSON.parse(e.original)); e.original = null; }
    broadcast('events'); return e;
  }],
  ['DELETE', /^\/events\/(\d+)$/, (m) => { const e = editable(m[1]); db.events = db.events.filter((x) => x !== e); broadcast('events'); return { ok: true }; }],
  ['POST', /^\/undo\/([\w-]+)$/, (m) => {
    const entry = undoStore.get(m[1]);
    if (!entry || entry.by !== me().id) throw new HttpError(410, 'Zu spät – das lässt sich nicht mehr wiederherstellen.');
    undoStore.delete(m[1]);
    for (const k of entry.keys) {
      entry.before[k].forEach((row, i) => {
        const at = db[k].findIndex((x) => x.id === row.id);
        if (at >= 0) db[k][at] = row; else db[k].splice(Math.min(i, db[k].length), 0, row);
      });
      for (const type of UNDO_EVENTS[k] || []) broadcast(type, type === 'questions' ? { people: db.people.map((p) => p.id) } : {});
    }
    return { ok: true };
  }],
  ['GET', /^\/channels\/(\d+)\/messages$/, (m, q) => { const c = channel(m[1]); const before = Number(q.get('before')) || Infinity; return db.messages.filter((x) => x.channel_id === c.id && x.id < before).slice(-60).map(msgOut); }],
  ['POST', /^\/channels\/(\d+)\/messages$/, async (m, q, b) => {
    writer(); const c = channel(m[1]); const body = String(b.get('body') || '').trim(); const file = b.get('file');
    if (!body && !(file && file.size)) throw new HttpError(400, 'Leere Nachricht');
    if (file && file.size > 8 * 1024 * 1024) throw new HttpError(413, 'In der Demo max. 8 MB pro Datei');
    return postMessage(c, me(), body, await fileToAttachment(file));
  }],
  ['PATCH', /^\/messages\/(\d+)$/, (m, q, b) => { writer(); const x = db.messages.find((y) => y.id === Number(m[1])); if (!x) throw new HttpError(404, 'Nachricht nicht gefunden'); x.pinned = b.pinned ? 1 : 0; broadcast('message-updated', msgOut(x)); return msgOut(x); }],
  ['DELETE', /^\/messages\/(\d+)$/, (m) => {
    const x = db.messages.find((y) => y.id === Number(m[1])); if (!x) throw new HttpError(404, 'Nachricht nicht gefunden');
    if (x.person_id !== me().id && me().role !== 'admin') throw new HttpError(403, 'Nur eigene Nachrichten löschen');
    db.messages = db.messages.filter((y) => y !== x); broadcast('message-deleted', { id: x.id, channel_id: x.channel_id }); return { ok: true };
  }],
  ['GET', /^\/channels\/(\d+)\/library$/, (m) => {
    const c = channel(m[1]); const rows = db.messages.filter((x) => x.channel_id === c.id).reverse().map(msgOut);
    return { pinned: rows.filter((x) => x.pinned), files: rows.filter((x) => x.attachment_id), links: rows.flatMap((x) => (x.body.match(URL_RE) || []).map((url) => ({ url, message: x }))) };
  }],
  ['POST', /^\/push\/(subscribe|unsubscribe)$/, () => { throw new HttpError(400, 'Benachrichtigungen gehen erst auf deinem eigenen Server.'); }],
  ['GET', /^\/admin\/people$/, () => { adminOnly(); return [...db.people].sort((a, b) => a.name.localeCompare(b.name)).map(adminP); }],
  ['POST', /^\/admin\/people$/, (m, q, b) => {
    adminOnly(); const name = String(b.name || '').trim(); if (!name) throw new HttpError(400, 'Name fehlt');
    const p = { id: ++db.seq, name, roster_name: b.roster_name || name, role: 'member', color: nextColor(), token: rand(), feed_token: rand() };
    db.people.push(p); broadcast('people'); return adminP(p);
  }],
  ['PATCH', /^\/admin\/people\/(\d+)$/, (m, q, b) => {
    adminOnly(); const p = person(Number(m[1])); if (!p) throw new HttpError(404, 'Person nicht gefunden');
    for (const k of ['name', 'roster_name', 'color', 'role']) if (b[k] !== undefined && b[k] !== '') p[k] = b[k];
    if (p.id === me().id) p.role = 'admin';
    broadcast('people'); return adminP(p);
  }],
  ['POST', /^\/admin\/people\/(\d+)\/new-link$/, (m) => { adminOnly(); const p = person(Number(m[1])); p.token = rand(); p.feed_token = rand(); return adminP(p); }],
  ['DELETE', /^\/admin\/people\/(\d+)$/, (m) => {
    adminOnly(); const id = Number(m[1]); if (id === me().id) throw new HttpError(400, 'Du kannst dich nicht selbst löschen');
    db.people = db.people.filter((p) => p.id !== id); db.events = db.events.filter((e) => e.person_id !== id);
    broadcast('people'); broadcast('events'); return { ok: true };
  }],
  ['POST', /^\/admin\/channels$/, (m, q, b) => { adminOnly(); const name = String(b.name || '').trim(); if (!name) throw new HttpError(400, 'Name fehlt'); const c = { id: ++db.seq, name, position: db.channels.length }; db.channels.push(c); broadcast('channels'); return c; }],
  ['PATCH', /^\/admin\/channels\/(\d+)$/, (m, q, b) => { adminOnly(); const c = channel(m[1]); c.name = String(b.name || c.name).trim() || c.name; broadcast('channels'); return c; }],
  ['DELETE', /^\/admin\/channels\/(\d+)$/, (m) => {
    adminOnly(); const c = channel(m[1]); if (db.channels.length <= 1) throw new HttpError(400, 'Die letzte Gruppe kann nicht gelöscht werden');
    db.channels = db.channels.filter((x) => x !== c); db.messages = db.messages.filter((x) => x.channel_id !== c.id); broadcast('channels'); return { ok: true };
  }],
  ['POST', /^\/admin\/rosters$/, async (m, q, b) => {
    adminOnly(); const file = b.get('file'); if (!file || !file.size) throw new HttpError(400, 'Bitte ein PDF auswählen');
    const a = await fileToAttachment(file);
    const warnings = []; let result = null; let method = b.get('method') === 'manual' ? 'manual' : 'text';
    if (method === 'text') {
      try { result = await parseRosterPdfText(await file.arrayBuffer()); } catch (err) { warnings.push(err.message); method = 'manual'; }
    }
    if (!result) {
      const mon = new Date(today); mon.setDate(mon.getDate() + ((8 - mon.getDay()) % 7 || 7));
      const dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return iso(d); });
      result = { grid: { title: '', dates, rows: db.people.filter((p) => p.roster_name).map((p) => ({ label: p.roster_name, kind: 'person', cells: Array(7).fill('') })) }, warnings: [] };
    }
    warnings.push(...result.warnings);
    const grid = sanitizeGrid(result.grid);
    const r = { id: ++db.seq, title: grid.title, week_start: grid.dates[0], attachment_id: a.id, method, grid, status: 'draft', created_at: nowIso() };
    db.rosters.push(r);
    return { roster: r, assignments: suggest(grid), warnings };
  }],
  ['GET', /^\/admin\/rosters$/, () => { adminOnly(); return [...db.rosters].reverse(); }],
  ['GET', /^\/admin\/rosters\/(\d+)$/, (m) => { adminOnly(); const r = db.rosters.find((x) => x.id === Number(m[1])); if (!r) throw new HttpError(404, 'Plan nicht gefunden'); return typeOf(r) === 'dienstplan' ? { type: 'dienstplan', roster: r, assignments: suggest(r.grid), warnings: [] } : { type: typeOf(r), roster: r, warnings: [] }; }],
  ['POST', /^\/admin\/rosters-dienst\/(\d+)\/publish$/, (m, q, b) => {
    adminOnly(); const roster = db.rosters.find((x) => x.id === Number(m[1])); if (!roster) throw new HttpError(404, 'Dienstplan nicht gefunden');
    let grid; try { grid = sanitizeGrid(b.grid); } catch (err) { throw new HttpError(400, err.message); }
    const ids = grid.rows.map((r, i) => {
      if (r.kind !== 'person') return null;
      const a = b.assignments?.[i];
      if (a === 'new') {
        const ex = db.people.find((p) => norm(p.roster_name) === norm(r.label));
        if (ex) return ex.id;
        const p = { id: ++db.seq, name: r.label, roster_name: r.label, role: 'none', color: nextColor(), token: null, feed_token: rand() };
        db.people.push(p); return p.id;
      }
      return person(Number(a)) ? Number(a) : null;
    });
    const prev = db.rosters.filter((x) => x.week_start === grid.dates[0] && x.status === 'published' && !['spielplan', 'probenplan'].includes(x.method) && x.id !== roster.id);
    const replaced = prev.length > 0 || roster.status === 'published';
    for (const p of prev) p.status = 'replaced';
    const drop = new Set([roster.id, ...prev.map((p) => p.id)]);
    const edited = takeEdited(drop);
    const evs = gridToEvents(grid, ids);
    for (const e of evs) {
      if (e.kind === 'venue' && db.events.some((x) => x.kind === 'venue' && x.start === e.start && /^Prater/.test(x.location))) continue;
      db.events.push({ id: ++db.seq, roster_id: roster.id, notes: '', created_by: me().id, ...e });
    }
    carryEdits(edited, roster.id);
    Object.assign(roster, { grid, title: grid.title, week_start: grid.dates[0], status: 'published', published_at: nowIso() });
    broadcast('events'); broadcast('people');
    const ch = db.channels.find((c) => c.id === Number(b.announce_channel_id));
    if (ch) {
      const label = grid.title.replace(/^\s*Dienstplan\s*:?\s*/i, '') || `Woche ab ${grid.dates[0].split('-').reverse().join('.')}`;
      postMessage(ch, me(), `📅 ${replaced ? 'Aktualisierter Dienstplan' : 'Neuer Dienstplan'}: ${label} – die Dienste stehen jetzt im Kalender.`, attachmentById(roster.attachment_id));
    }
    return { ok: true, events: evs.length, replaced };
  }],

  // --- Eigene Kalender ---
  ['POST', /^\/admin\/calendars$/, (m, q, b) => {
    adminOnly(); const name = String(b.name || '').trim(); if (!name) throw new HttpError(400, 'Name fehlt');
    const c = { id: ++db.seq, name, color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#0ea5e9', position: db.calendars.length };
    db.calendars.push(c); broadcast('calendars'); return c;
  }],
  ['PATCH', /^\/admin\/calendars\/(\d+)$/, (m, q, b) => {
    adminOnly(); const c = db.calendars.find((x) => x.id === Number(m[1])); if (!c) throw new HttpError(404, 'Kalender nicht gefunden');
    if (b.name !== undefined) c.name = String(b.name).trim() || c.name;
    if (/^#[0-9a-f]{6}$/i.test(b.color)) c.color = b.color;
    broadcast('calendars'); return c;
  }],
  ['DELETE', /^\/admin\/calendars\/(\d+)$/, (m) => {
    adminOnly(); const id = Number(m[1]);
    db.calendars = db.calendars.filter((c) => c.id !== id); db.events = db.events.filter((e) => e.calendar_id !== id);
    broadcast('calendars'); broadcast('events'); return { ok: true };
  }],
  // --- To-Dos ---
  ['GET', /^\/todos$/, () => todosOut()],
  ['POST', /^\/todos$/, (m, q, b) => {
    writer(); const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'Bitte einen Titel eingeben');
    let parent = null;
    if (b.parent_id) { parent = db.todos.find((t) => t.id === Number(b.parent_id)); if (!parent || parent.parent_id) throw new HttpError(400, 'Ungültige Hauptaufgabe'); }
    const tops = db.todos.filter((t) => !t.parent_id);
    const t = { id: ++db.seq, parent_id: parent?.id ?? null, title, notes: b.notes || '', done: 0, flagged: b.flagged ? 1 : 0,
      position: parent ? Math.max(0, ...db.todos.filter((x) => x.parent_id === parent.id).map((x) => x.position)) + 1 : Math.min(0, ...tops.map((x) => x.position)) - 1,
      created_by: me().id, created_at: nowIso(), done_by: null, done_at: null, assignees: parent ? [] : (b.assignees || []).map(Number), tags: parent ? [] : (b.tags || []).map(normTagClient).filter(Boolean), attachments: [] };
    db.todos.push(t); broadcast('todos'); return todosOut().find((x) => x.id === t.id) || t;
  }],
  ['PATCH', /^\/todos\/(\d+)$/, (m, q, b) => {
    writer(); const t = todo(m[1]);
    if (b.title !== undefined) t.title = String(b.title).trim() || t.title;
    if (b.notes !== undefined) t.notes = String(b.notes);
    if (b.flagged !== undefined) t.flagged = b.flagged ? 1 : 0;
    if (b.done !== undefined) Object.assign(t, b.done ? { done: 1, done_by: me().id, done_at: nowIso() } : { done: 0, done_by: null, done_at: null });
    if (!t.parent_id && b.assignees !== undefined) t.assignees = [...new Set(b.assignees.map(Number))];
    if (!t.parent_id && b.tags !== undefined) t.tags = [...new Set(b.tags.map(normTagClient).filter(Boolean))];
    broadcast('todos'); return todosOut().find((x) => x.id === t.id) || t;
  }],
  ['DELETE', /^\/todos\/(\d+)$/, (m) => {
    writer(); const t = todo(m[1]);
    if (!t.parent_id && t.created_by !== me().id && me().role !== 'admin') throw new HttpError(403, 'Nur wer das To-Do angelegt hat (oder ein Admin) kann es löschen');
    db.todos = db.todos.filter((x) => x.id !== t.id && x.parent_id !== t.id); broadcast('todos'); return { ok: true };
  }],
  ['POST', /^\/todos\/reorder$/, (m, q, b) => { writer(); reorder(db.todos, b.ids || []); broadcast('todos'); return { ok: true }; }],
  ['POST', /^\/(todos|infos|orders|prod_pages)\/(\d+)\/attachments$/, async (m, q, b) => {
    writer(); const item = db[m[1]].find((x) => x.id === Number(m[2])); if (!item || (m[1] === 'infos' && !canSeeInfo(item))) throw new HttpError(404, 'Eintrag nicht gefunden');
    if (m[1] === 'infos' && item.restricted && me().role !== 'admin') throw new HttpError(403, 'Vertrauliche Infos können nur Admins ändern');
    const file = b.get('file'); if (file && file.size > 8 * 1024 * 1024) throw new HttpError(413, 'In der Demo max. 8 MB pro Datei');
    const a = await fileToAttachment(file); if (!a) throw new HttpError(400, 'Keine Datei ausgewählt');
    item.attachments.push(a.id); broadcast(m[1] === 'prod_pages' ? 'productions' : m[1]); return { id: a.id, name: a.original_name, mime: a.mime, size: a.size };
  }],
  ['DELETE', /^\/(todos|infos|orders|prod_pages)\/(\d+)\/attachments\/(\d+)$/, (m) => {
    writer(); const item = db[m[1]].find((x) => x.id === Number(m[2])); if (!item || (m[1] === 'infos' && !canSeeInfo(item))) throw new HttpError(404, 'Eintrag nicht gefunden');
    if (m[1] === 'infos' && item.restricted && me().role !== 'admin') throw new HttpError(403, 'Vertrauliche Infos können nur Admins ändern');
    item.attachments = item.attachments.filter((id) => id !== Number(m[3])); broadcast(m[1] === 'prod_pages' ? 'productions' : m[1]); return { ok: true };
  }],
  // --- Fragen ---
  ['GET', /^\/questions$/, () => { const all = questionsFor(me().id); return { incoming: all.filter((x) => x.to_id === me().id), outgoing: all.filter((x) => x.from_id === me().id) }; }],
  ['GET', /^\/counts$/, () => ({ questions: questionsFor(me().id).filter((x) => x.waiting_for_me).length })],
  ['POST', /^\/questions$/, (m, q, b) => {
    writer(); const to = db.people.find((p) => p.id === Number(b.to_id) && p.role !== 'none');
    if (!to) throw new HttpError(400, 'Bitte auswählen, an wen die Frage geht');
    if (to.id === me().id) throw new HttpError(400, 'Fragen an dich selbst gehen nicht');
    if (!String(b.body || '').trim()) throw new HttpError(400, 'Bitte eine Frage eingeben');
    const x = { id: ++db.seq, from_id: me().id, to_id: to.id, body: String(b.body).trim(), status: 'open', created_at: nowIso(), updated_at: nowIso(), replies: [] };
    db.questions.push(x); broadcast('questions', { people: [x.from_id, x.to_id] }); return x;
  }],
  ['POST', /^\/questions\/(\d+)\/replies$/, (m, q, b) => {
    writer(); const x = question(m[1]); if (!String(b.body || '').trim()) throw new HttpError(400, 'Leere Antwort');
    x.replies.push({ id: ++db.seq, person_id: me().id, body: String(b.body).trim(), created_at: nowIso() }); x.status = 'open'; x.updated_at = nowIso();
    broadcast('questions', { people: [x.from_id, x.to_id] }); return { ok: true };
  }],
  ['PATCH', /^\/questions\/(\d+)$/, (m, q, b) => { writer(); const x = question(m[1]); x.status = b.status === 'done' ? 'done' : 'open'; x.updated_at = nowIso(); broadcast('questions', { people: [x.from_id, x.to_id] }); return { ok: true }; }],
  ['DELETE', /^\/questions\/(\d+)$/, (m) => {
    writer(); const x = question(m[1]); if (x.from_id !== me().id) throw new HttpError(403, 'Nur wer gefragt hat, kann die Frage löschen');
    db.questions = db.questions.filter((y) => y !== x); broadcast('questions', { people: [x.from_id, x.to_id] }); return { ok: true };
  }],
  // --- Infos ---
  ['GET', /^\/infos$/, () => ({ categories: CATEGORIES, infos: infosOut() })],
  ['POST', /^\/infos$/, (m, q, b) => {
    writer(); const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'Bitte einen Titel eingeben');
    const i = { id: ++db.seq, category: CATEGORIES.includes(b.category) ? b.category : 'Allgemein', title, body: b.body || '', position: Math.min(0, ...db.infos.map((x) => x.position)) - 1, created_by: me().id, updated_at: nowIso(), attachments: [], restricted: 0, viewers: [] };
    setVisibility(i, b); db.infos.push(i); broadcast('infos'); return infosOut().find((x) => x.id === i.id);
  }],
  ['PATCH', /^\/infos\/(\d+)$/, (m, q, b) => {
    writer(); const i = info(m[1]);
    if (b.title !== undefined) i.title = String(b.title).trim() || i.title;
    if (CATEGORIES.includes(b.category)) i.category = b.category;
    if (b.body !== undefined) i.body = String(b.body);
    setVisibility(i, b);
    i.updated_at = nowIso(); broadcast('infos'); return infosOut().find((x) => x.id === i.id);
  }],
  ['DELETE', /^\/infos\/(\d+)$/, (m) => { writer(); const i = info(m[1]); db.infos = db.infos.filter((x) => x !== i); broadcast('infos'); return { ok: true }; }],
  ['POST', /^\/infos\/reorder$/, (m, q, b) => { writer(); reorder(db.infos, b.ids || []); broadcast('infos'); return { ok: true }; }],
  // --- Bestellwünsche ---
  ['GET', /^\/orders$/, () => ordersOut()],
  ['POST', /^\/orders$/, (m, q, b) => {
    writer(); const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'Bitte eintragen, was gebraucht wird');
    const o = { id: ++db.seq, title, quantity: b.quantity || '', notes: b.notes || '', status: 'open', claimed_by: null, created_by: me().id, created_at: nowIso(), updated_at: nowIso(), attachments: [] };
    db.orders.push(o); broadcast('orders'); return ordersOut().find((x) => x.id === o.id);
  }],
  ['PATCH', /^\/orders\/(\d+)$/, (m, q, b) => {
    writer(); const o = db.orders.find((x) => x.id === Number(m[1])); if (!o) throw new HttpError(404, 'Bestellwunsch nicht gefunden');
    const mine = o.claimed_by === me().id || me().role === 'admin';
    if (b.action === 'claim') {
      if (o.claimed_by && o.claimed_by !== me().id && o.status !== 'open') throw new HttpError(409, `${person(o.claimed_by)?.name} kümmert sich schon darum`);
      Object.assign(o, { status: 'claimed', claimed_by: me().id });
    } else if (b.action === 'release') {
      if (!mine) throw new HttpError(403, 'Nur wer sich kümmert, kann den Eintrag wieder abgeben'); Object.assign(o, { status: 'open', claimed_by: null });
    } else if (b.action === 'ordered' || b.action === 'done') {
      if (o.claimed_by && !mine) throw new HttpError(403, `${person(o.claimed_by)?.name} kümmert sich darum`); Object.assign(o, { status: b.action, claimed_by: o.claimed_by || me().id });
    } else if (b.action === 'reopen') Object.assign(o, { status: 'open', claimed_by: null });
    else { o.title = String(b.title ?? o.title).trim() || o.title; o.quantity = b.quantity ?? o.quantity; o.notes = b.notes ?? o.notes; }
    o.updated_at = nowIso(); broadcast('orders'); return ordersOut().find((x) => x.id === o.id);
  }],
  ['DELETE', /^\/orders\/(\d+)$/, (m) => { writer(); db.orders = db.orders.filter((x) => x.id !== Number(m[1])); broadcast('orders'); return { ok: true }; }],
  // --- Produktionen ---
  ['GET', /^\/productions$/, () => [...db.productions].sort((a, b) => a.position - b.position).map((p) => ({ ...p,
    pages: db.prod_pages.filter((x) => x.production_id === p.id && x.body.trim() && x.updated_by).length, next: prodUpcoming(p.name)[0] || null }))],
  ['GET', /^\/productions\/search$/, (m, q) => {
    const t = String(q.get('q') || '').trim().toLowerCase(); if (t.length < 2) return [];
    return db.prod_pages.map((pg) => ({ pg, p: db.productions.find((x) => x.id === pg.production_id) })).filter(({ pg, p }) => p && [pg.title, pg.body, p.name].some((v) => v.toLowerCase().includes(t)))
      .slice(0, 40).map(({ pg, p }) => { const i = pg.body.toLowerCase().indexOf(t); return { id: pg.id, production_id: p.id, phase: pg.phase, title: pg.title, production: p.name, snippet: i < 0 ? pg.body.slice(0, 120) : `${i > 40 ? '…' : ''}${pg.body.slice(Math.max(0, i - 40), i + 80)}` }; });
  }],
  ['GET', /^\/productions\/(\d+)$/, (m) => prodOut(prod(m[1]))],
  ['POST', /^\/productions$/, (m, q, b) => {
    writer(); const name = String(b.name || '').trim(); if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben');
    const id = addProduction(db, name, me().id, { status: STATUSES[b.status] ? b.status : 'vorbereitung', premiere: /^\d{4}-\d{2}-\d{2}$/.test(b.premiere || '') ? b.premiere : null, venue: String(b.venue ?? 'Prater') });
    broadcast('productions', { id }); return prodOut(prod(id));
  }],
  ['PATCH', /^\/productions\/(\d+)$/, (m, q, b) => {
    writer(); const p = prod(m[1]);
    if (b.name !== undefined) p.name = String(b.name).trim() || p.name;
    if (STATUSES[b.status]) p.status = b.status;
    if (b.premiere !== undefined) p.premiere = /^\d{4}-\d{2}-\d{2}$/.test(b.premiere) ? b.premiere : null;
    if (b.venue !== undefined) p.venue = String(b.venue);
    broadcast('productions', { id: p.id }); return prodOut(p);
  }],
  ['DELETE', /^\/productions\/(\d+)$/, (m) => {
    writer(); const p = prod(m[1]);
    if (me().role !== 'admin' && p.created_by !== me().id) throw new HttpError(403, 'Nur Admins oder wer die Produktion angelegt hat, können sie löschen');
    db.productions = db.productions.filter((x) => x !== p); db.prod_pages = db.prod_pages.filter((x) => x.production_id !== p.id); db.prod_links = db.prod_links.filter((x) => x.production_id !== p.id);
    broadcast('productions', { id: p.id }); return { ok: true };
  }],
  ['POST', /^\/productions\/(\d+)\/links$/, (m, q, b) => {
    writer(); const p = prod(m[1]); const url = prodUrl(b.url);
    db.prod_links.push({ id: ++db.seq, production_id: p.id, title: String(b.title || '').trim() || new URL(url).hostname, url, position: db.prod_links.length + 1, created_by: me().id });
    broadcast('productions', { id: p.id }); return { ok: true };
  }],
  ['PATCH', /^\/prod-links\/(\d+)$/, (m, q, b) => {
    writer(); const l = db.prod_links.find((x) => x.id === Number(m[1])); if (!l) throw new HttpError(404, 'Link nicht gefunden');
    if (b.url !== undefined) l.url = prodUrl(b.url); if (b.title !== undefined) l.title = String(b.title).trim() || l.title;
    broadcast('productions', { id: l.production_id }); return { ok: true };
  }],
  ['DELETE', /^\/prod-links\/(\d+)$/, (m) => {
    writer(); const l = db.prod_links.find((x) => x.id === Number(m[1])); if (!l) throw new HttpError(404, 'Link nicht gefunden');
    db.prod_links = db.prod_links.filter((x) => x !== l); broadcast('productions', { id: l.production_id }); return { ok: true };
  }],
  ['POST', /^\/productions\/(\d+)\/pages$/, (m, q, b) => {
    writer(); const p = prod(m[1]); const phase = PHASE_KEYS.includes(b.phase) ? b.phase : 'vorbereitung';
    const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'Bitte einen Titel eingeben');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
    const same = db.prod_pages.filter((x) => x.production_id === p.id && x.phase === phase).map((x) => x.position);
    const pg = { id: ++db.seq, production_id: p.id, phase, title, body: String(b.body || ''), hint: '', date, position: date ? Math.min(1, ...same) - 1 : Math.max(0, ...same) + 1, created_by: me().id, updated_by: me().id, updated_at: new Date().toISOString(), attachments: [] };
    db.prod_pages.push(pg); broadcast('productions', { id: p.id }); return pageOut(pg);
  }],
  ['PATCH', /^\/prod-pages\/(\d+)$/, (m, q, b) => {
    writer(); const pg = prodPage(m[1]);
    if (b.base && b.base !== pg.updated_at && !b.force && b.body !== undefined) throw new HttpError(409, `${person(pg.updated_by)?.name || 'Jemand'} hat diesen Unterpunkt geändert, während du geschrieben hast.`);
    if (b.title !== undefined) pg.title = String(b.title).trim() || pg.title;
    if (b.body !== undefined) pg.body = String(b.body);
    if (PHASE_KEYS.includes(b.phase)) pg.phase = b.phase;
    if (b.date !== undefined) pg.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
    Object.assign(pg, { updated_by: me().id, updated_at: new Date().toISOString() });
    broadcast('productions', { id: pg.production_id }); return pageOut(pg);
  }],
  ['POST', /^\/prod-pages\/(\d+)\/toggle$/, (m, q, b) => {
    writer(); const pg = prodPage(m[1]); const lines = pg.body.split('\n'); const i = Number(b.line);
    if (!/^\s*\[( |x|X)\]/.test(lines[i] ?? '')) throw new HttpError(409, 'Der Punkt hat sich inzwischen geändert – bitte neu laden.');
    lines[i] = lines[i].replace(/\[( |x|X)\]/, (x) => (x === '[ ]' ? '[x]' : '[ ]'));
    Object.assign(pg, { body: lines.join('\n'), updated_by: me().id, updated_at: new Date().toISOString() });
    broadcast('productions', { id: pg.production_id }); return pageOut(pg);
  }],
  ['POST', /^\/prod-pages\/(\d+)\/uncheck$/, (m) => {
    writer(); const pg = prodPage(m[1]);
    Object.assign(pg, { body: pg.body.replace(/^(\s*)\[[xX]\]/gm, '$1[ ]'), updated_by: me().id, updated_at: new Date().toISOString() });
    broadcast('productions', { id: pg.production_id }); return pageOut(pg);
  }],
  ['DELETE', /^\/prod-pages\/(\d+)$/, (m) => {
    writer(); const pg = prodPage(m[1]); db.prod_pages = db.prod_pages.filter((x) => x !== pg);
    broadcast('productions', { id: pg.production_id }); return { ok: true };
  }],
  ['POST', /^\/productions\/(\d+)\/reorder$/, (m, q, b) => {
    writer(); const p = prod(m[1]); const ids = (b.ids || []).map(Number);
    const slots = db.prod_pages.filter((x) => x.production_id === p.id && ids.includes(x.id)).map((x) => x.position).sort((a, c) => a - c);
    ids.forEach((id, k) => { const pg = db.prod_pages.find((x) => x.id === id); if (pg) pg.position = slots[k]; });
    broadcast('productions', { id: p.id }); return { ok: true };
  }],
  // --- Spielplan ---
  ['POST', /^\/admin\/spielplan$/, async (m, q, b) => {
    adminOnly(); const file = b.get('file'); if (!file || !file.size) throw new HttpError(400, 'Bitte ein PDF auswählen');
    const a = await fileToAttachment(file);
    let plan;
    try { plan = spielplanFromPages(await pdfPages(await file.arrayBuffer())); } catch (err) { throw new HttpError(422, `Spielplan nicht erkannt: ${err.message}`); }
    if (!plan.month) throw new HttpError(422, 'Spielplan nicht erkannt: Monat fehlt');
    plan = { type: 'spielplan', ...plan, events: plan.events.map((e) => ({ ...e, include: true })) };
    const r = { id: ++db.seq, title: plan.title, week_start: `${plan.month}-01`, attachment_id: a.id, method: 'spielplan', grid: plan, status: 'draft', created_at: nowIso() };
    db.rosters.push(r);
    return { roster: r, warnings: plan.events.length ? [] : ['Im Spielplan wurden keine Prater-Veranstaltungen gefunden.'] };
  }],
  ['POST', /^\/admin\/spielplan\/(\d+)\/publish$/, (m, q, b) => {
    adminOnly(); const roster = db.rosters.find((x) => x.id === Number(m[1]) && x.method === 'spielplan'); if (!roster) throw new HttpError(404, 'Spielplan nicht gefunden');
    const plan = b.plan;
    const prev = db.rosters.filter((x) => x.method === 'spielplan' && x.week_start === `${plan.month}-01` && x.status === 'published' && x.id !== roster.id);
    const replaced = prev.length > 0 || roster.status === 'published';
    prev.forEach((p) => { p.status = 'replaced'; });
    const drop = new Set([roster.id, ...prev.map((p) => p.id)]);
    const edited = takeEdited(drop);
    let count = 0;
    for (const e of plan.events.filter((x) => x.include !== false && x.title)) {
      const ev = venueEvent(e.date, { ...e, start: e.start || null, end: e.start && e.end ? e.end : null });
      if (db.events.some((x) => x.kind === 'venue' && x.start === ev.start && /^Prater/.test(x.location))) continue;
      db.events.push({ id: ++db.seq, roster_id: roster.id, created_by: me().id, ...ev }); count++;
    }
    carryEdits(edited, roster.id);
    Object.assign(roster, { grid: plan, title: plan.title, status: 'published', published_at: nowIso() });
    broadcast('events');
    const ch = db.channels.find((c) => c.id === Number(b.announce_channel_id));
    if (ch) postMessage(ch, me(), `🎭 ${replaced ? 'Aktualisierter Spielplan' : 'Neuer Spielplan'}: ${plan.title} – ${count} Prater-Veranstaltungen stehen jetzt im Kalender.`, attachmentById(roster.attachment_id));
    return { ok: true, events: count, replaced };
  }],
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, opts);
  const path = url.pathname.slice(4);
  const method = (opts.method || 'GET').toUpperCase();
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  for (const [m, re, fn] of routes) {
    const match = m === method && path.match(re);
    if (!match) continue;
    try {
      const body = opts.body instanceof FormData ? opts.body : opts.body ? JSON.parse(opts.body) : {};
      const before = method === 'DELETE' ? JSON.parse(JSON.stringify(db)) : null;
      let data = await fn(match, url.searchParams, body);
      if (before) data = { ...data, undo: undoToken(before) };
      save();
      return json(200, data);
    } catch (err) {
      return json(err.status || 500, { error: err.status ? err.message : `Fehler: ${err.message}` });
    }
  }
  return json(404, { error: 'Nicht gefunden' });
};
window.EventSource = DemoEventSource;
export { getPdfjs, pdfTextItems };
