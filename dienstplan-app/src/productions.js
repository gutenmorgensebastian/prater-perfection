// API für „Produktionen“: ein kleines Wiki pro Produktion, gegliedert in Überblick, Vorbereitung,
// Show und Nachbereitung. Alle außer Gästen dürfen anlegen und bearbeiten.
import { db, getSetting, setSetting } from './db.js';
import { HttpError, intParam, requireWriter } from './http.js';
import { broadcast } from './notify.js';
import { snapshot } from './undo.js';
import { PHASE_KEYS, STATUSES, TEMPLATE, FIRST_PRODUCTIONS } from './production-template.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"; // mit Millisekunden für den Konfliktschutz
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Wiki-Text nicht trimmen: "[ ] " am Ende ist ein leeres Kästchen zum Weiterschreiben.
const bodyText = (v) => String(v ?? '').replace(/\r\n/g, '\n').slice(0, 50000);
const changed = (productionId) => broadcast('productions', { id: productionId });

export function createProduction(name, personId = null, { status = 'vorbereitung', premiere = null } = {}) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM productions').get().p;
  const id = Number(db.prepare('INSERT INTO productions (name, status, premiere, position, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(name, status, premiere, pos, personId).lastInsertRowid);
  const ins = db.prepare('INSERT INTO prod_pages (production_id, phase, title, body, hint, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  TEMPLATE.forEach((t, i) => ins.run(id, t.phase, t.title, t.body || '', t.hint || '', i + 1, personId));
  return id;
}

// Beim ersten Start die ersten Produktionen anlegen (nur einmal, auch wenn sie später gelöscht werden).
export function seedProductions() {
  if (getSetting('productions_seeded')) return;
  if (!db.prepare('SELECT 1 FROM productions').get()) FIRST_PRODUCTIONS.forEach((n) => createProduction(n));
  setSetting('productions_seeded', '1');
}

const getProduction = (id) => {
  const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(intParam(id));
  if (!p) throw new HttpError(404, 'Produktion nicht gefunden');
  return p;
};
const getPage = (id) => {
  const p = db.prepare('SELECT * FROM prod_pages WHERE id = ?').get(intParam(id));
  if (!p) throw new HttpError(404, 'Unterpunkt nicht gefunden');
  return p;
};

// Kommende Termine aus dem Kalender, deren Titel den Namen der Produktion enthält (Spielplan, Proben …).
function upcoming(name) {
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(`SELECT e.id, e.title, e.start, e.end, e.all_day, e.location, e.kind, c.name AS calendar
    FROM events e LEFT JOIN calendars c ON c.id = e.calendar_id
    WHERE e.kind IN ('venue', 'custom') AND e.start >= ? AND instr(lower(e.title), lower(?)) > 0
    ORDER BY e.start LIMIT 6`).all(today, name);
}

function pagesOf(productionId) {
  const files = new Map();
  for (const r of db.prepare(`SELECT ia.item_id, a.id, a.original_name, a.mime, a.size FROM item_attachments ia
    JOIN attachments a ON a.id = ia.attachment_id JOIN prod_pages pg ON pg.id = ia.item_id
    WHERE ia.kind = 'prodpage' AND pg.production_id = ? ORDER BY a.id`).all(productionId)) {
    if (!files.has(r.item_id)) files.set(r.item_id, []);
    files.get(r.item_id).push({ id: r.id, name: r.original_name, mime: r.mime, size: r.size });
  }
  return db.prepare(`SELECT pg.*, u.name AS updated_name FROM prod_pages pg LEFT JOIN people u ON u.id = pg.updated_by
    WHERE pg.production_id = ? ORDER BY pg.position, pg.id`).all(productionId)
    .map((pg) => ({ ...pg, attachments: files.get(pg.id) || [] }));
}

function productionOut(p) {
  return {
    ...p,
    links: db.prepare('SELECT * FROM prod_links WHERE production_id = ? ORDER BY position, id').all(p.id),
    pages: pagesOf(p.id),
    upcoming: upcoming(p.name),
  };
}

function readProduction(b, fallback = {}) {
  const name = text(b.name ?? fallback.name, 80);
  if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben');
  const status = STATUSES[b.status] ? b.status : (fallback.status || 'vorbereitung');
  const premiere = b.premiere === undefined ? (fallback.premiere ?? null) : (DATE_RE.test(b.premiere) ? b.premiere : null);
  const venue = text(b.venue ?? fallback.venue ?? 'Prater', 60);
  return { name, status, premiere, venue };
}

// Links nur mit http(s) – kein javascript: o. Ä.
function readUrl(v) {
  let url = text(v, 2000);
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return u.href;
  } catch { throw new HttpError(400, 'Das ist kein gültiger Link'); }
}

export function registerProductionRoutes(api) {
  api.get('/productions', (req, res) => {
    const rows = db.prepare('SELECT * FROM productions ORDER BY position, id').all();
    res.json(rows.map((p) => ({
      ...p,
      // Nur Unterpunkte zählen, die jemand bearbeitet hat (nicht die unveränderte Vorlage).
      pages: db.prepare("SELECT count(*) AS n FROM prod_pages WHERE production_id = ? AND trim(body) != '' AND updated_by IS NOT NULL").get(p.id).n,
      next: upcoming(p.name)[0] || null,
    })));
  });

  // Volltextsuche über Namen, Unterpunkte und Links.
  api.get('/productions/search', (req, res) => {
    const q = text(req.query.q, 100).toLowerCase();
    if (q.length < 2) return res.json([]);
    const rows = db.prepare(`SELECT pg.id, pg.production_id, pg.phase, pg.title, pg.body, p.name AS production FROM prod_pages pg
      JOIN productions p ON p.id = pg.production_id
      WHERE instr(lower(pg.title), ?) > 0 OR instr(lower(pg.body), ?) > 0 OR instr(lower(p.name), ?) > 0
      ORDER BY p.position, pg.position LIMIT 40`).all(q, q, q);
    res.json(rows.map((r) => {
      const i = r.body.toLowerCase().indexOf(q);
      const snippet = i < 0 ? r.body.slice(0, 120) : `${i > 40 ? '…' : ''}${r.body.slice(Math.max(0, i - 40), i + 80)}`;
      return { id: r.id, production_id: r.production_id, phase: r.phase, title: r.title, production: r.production, snippet };
    }));
  });

  api.get('/productions/:id', (req, res) => res.json(productionOut(getProduction(req.params.id))));

  api.post('/productions', requireWriter, (req, res) => {
    const p = readProduction(req.body || {});
    const id = createProduction(p.name, req.person.id, p);
    db.prepare('UPDATE productions SET venue = ? WHERE id = ?').run(p.venue, id);
    changed(id);
    res.json(productionOut(getProduction(id)));
  });

  api.patch('/productions/:id', requireWriter, (req, res) => {
    const old = getProduction(req.params.id);
    const p = readProduction(req.body || {}, old);
    db.prepare('UPDATE productions SET name = ?, status = ?, premiere = ?, venue = ? WHERE id = ?').run(p.name, p.status, p.premiere, p.venue, old.id);
    changed(old.id);
    res.json(productionOut(getProduction(old.id)));
  });

  // Ganze Produktion löschen: Admins oder wer sie angelegt hat (mit Rückgängig).
  api.delete('/productions/:id', requireWriter, (req, res) => {
    const p = getProduction(req.params.id);
    if (req.person.role !== 'admin' && p.created_by !== req.person.id) throw new HttpError(403, 'Nur Admins oder wer die Produktion angelegt hat, können sie löschen');
    const pages = 'SELECT id FROM prod_pages WHERE production_id = ?';
    const undo = snapshot(req.person.id, [
      { table: 'productions', where: 'id = ?', params: [p.id] },
      { table: 'prod_links', where: 'production_id = ?', params: [p.id] },
      { table: 'prod_pages', where: 'production_id = ?', params: [p.id] },
      { table: 'item_attachments', where: `kind = 'prodpage' AND item_id IN (${pages})`, params: [p.id] },
    ]);
    db.prepare(`DELETE FROM item_attachments WHERE kind = 'prodpage' AND item_id IN (${pages})`).run(p.id);
    db.prepare('DELETE FROM productions WHERE id = ?').run(p.id);
    changed(p.id);
    res.json({ ok: true, undo });
  });

  // --- Wichtige Links (Regiebuch, Lichtplot, Cue-Liste …) ---
  api.post('/productions/:id/links', requireWriter, (req, res) => {
    const p = getProduction(req.params.id);
    const url = readUrl(req.body?.url);
    const title = text(req.body?.title, 100) || new URL(url).hostname;
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM prod_links WHERE production_id = ?').get(p.id).p;
    db.prepare('INSERT INTO prod_links (production_id, title, url, position, created_by) VALUES (?, ?, ?, ?, ?)').run(p.id, title, url, pos, req.person.id);
    changed(p.id);
    res.json({ ok: true });
  });
  api.patch('/prod-links/:id', requireWriter, (req, res) => {
    const l = db.prepare('SELECT * FROM prod_links WHERE id = ?').get(intParam(req.params.id));
    if (!l) throw new HttpError(404, 'Link nicht gefunden');
    const url = req.body?.url !== undefined ? readUrl(req.body.url) : l.url;
    db.prepare('UPDATE prod_links SET title = ?, url = ? WHERE id = ?').run(text(req.body?.title ?? l.title, 100) || l.title, url, l.id);
    changed(l.production_id);
    res.json({ ok: true });
  });
  api.delete('/prod-links/:id', requireWriter, (req, res) => {
    const l = db.prepare('SELECT * FROM prod_links WHERE id = ?').get(intParam(req.params.id));
    if (!l) throw new HttpError(404, 'Link nicht gefunden');
    const undo = snapshot(req.person.id, [{ table: 'prod_links', where: 'id = ?', params: [l.id] }]);
    db.prepare('DELETE FROM prod_links WHERE id = ?').run(l.id);
    changed(l.production_id);
    res.json({ ok: true, undo });
  });

  // --- Unterpunkte ---
  api.post('/productions/:id/pages', requireWriter, (req, res) => {
    const p = getProduction(req.params.id);
    const phase = PHASE_KEYS.includes(req.body?.phase) ? req.body.phase : 'vorbereitung';
    const title = text(req.body?.title, 120);
    if (!title) throw new HttpError(400, 'Bitte einen Titel eingeben');
    const date = DATE_RE.test(req.body?.date || '') ? req.body.date : null;
    // Datierte Notizen (Treffen, Vorstellungen) oben, neue Themen unten.
    const pos = date
      ? db.prepare('SELECT COALESCE(MIN(position), 1) - 1 AS p FROM prod_pages WHERE production_id = ? AND phase = ?').get(p.id, phase).p
      : db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM prod_pages WHERE production_id = ? AND phase = ?').get(p.id, phase).p;
    const id = Number(db.prepare('INSERT INTO prod_pages (production_id, phase, title, body, date, position, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, phase, title, bodyText(req.body?.body), date, pos, req.person.id, req.person.id).lastInsertRowid);
    changed(p.id);
    res.json(pagesOf(p.id).find((x) => x.id === id));
  });

  // Speichern mit Konfliktschutz: base = updated_at beim Öffnen. Hat inzwischen jemand anders
  // gespeichert, gibt es 409 – außer force ist gesetzt.
  api.patch('/prod-pages/:id', requireWriter, (req, res) => {
    const pg = getPage(req.params.id);
    const b = req.body || {};
    if (b.base && b.base !== pg.updated_at && !b.force && b.body !== undefined) {
      const who = db.prepare('SELECT name FROM people WHERE id = ?').get(pg.updated_by)?.name || 'Jemand';
      throw new HttpError(409, `${who} hat diesen Unterpunkt geändert, während du geschrieben hast.`);
    }
    const title = b.title !== undefined ? text(b.title, 120) || pg.title : pg.title;
    const body = b.body !== undefined ? bodyText(b.body) : pg.body;
    const phase = PHASE_KEYS.includes(b.phase) ? b.phase : pg.phase;
    const date = b.date === undefined ? pg.date : (DATE_RE.test(b.date || '') ? b.date : null);
    db.prepare(`UPDATE prod_pages SET title = ?, body = ?, phase = ?, date = ?, updated_by = ?, updated_at = ${NOW} WHERE id = ?`)
      .run(title, body, phase, date, req.person.id, pg.id);
    changed(pg.production_id);
    res.json(pagesOf(pg.production_id).find((x) => x.id === pg.id));
  });

  // Ein Häkchen umschalten, ohne den Rest des Textes anzufassen (sicher bei gleichzeitigen Änderungen).
  api.post('/prod-pages/:id/toggle', requireWriter, (req, res) => {
    const pg = getPage(req.params.id);
    const lines = pg.body.split('\n');
    const i = Number(req.body?.line);
    if (!Number.isInteger(i) || !/^\s*\[( |x|X)\]/.test(lines[i] ?? '')) throw new HttpError(409, 'Der Punkt hat sich inzwischen geändert – bitte neu laden.');
    lines[i] = lines[i].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
    db.prepare(`UPDATE prod_pages SET body = ?, updated_by = ?, updated_at = ${NOW} WHERE id = ?`).run(lines.join('\n'), req.person.id, pg.id);
    changed(pg.production_id);
    res.json(pagesOf(pg.production_id).find((x) => x.id === pg.id));
  });

  // Alle Häkchen entfernen (z. B. Checkliste vor der nächsten Vorstellung).
  api.post('/prod-pages/:id/uncheck', requireWriter, (req, res) => {
    const pg = getPage(req.params.id);
    db.prepare(`UPDATE prod_pages SET body = ?, updated_by = ?, updated_at = ${NOW} WHERE id = ?`)
      .run(pg.body.replace(/^(\s*)\[[xX]\]/gm, '$1[ ]'), req.person.id, pg.id);
    changed(pg.production_id);
    res.json(pagesOf(pg.production_id).find((x) => x.id === pg.id));
  });

  api.delete('/prod-pages/:id', requireWriter, (req, res) => {
    const pg = getPage(req.params.id);
    const undo = snapshot(req.person.id, [
      { table: 'prod_pages', where: 'id = ?', params: [pg.id] },
      { table: 'item_attachments', where: "kind = 'prodpage' AND item_id = ?", params: [pg.id] },
    ]);
    db.prepare("DELETE FROM item_attachments WHERE kind = 'prodpage' AND item_id = ?").run(pg.id);
    db.prepare('DELETE FROM prod_pages WHERE id = ?').run(pg.id);
    changed(pg.production_id);
    res.json({ ok: true, undo });
  });

  // Reihenfolge innerhalb einer Phase (Ziehen am Griff).
  api.post('/productions/:id/reorder', requireWriter, (req, res) => {
    const p = getProduction(req.params.id);
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
    const upd = db.prepare('UPDATE prod_pages SET position = ? WHERE id = ? AND production_id = ?');
    const slots = ids.length ? db.prepare(`SELECT position FROM prod_pages WHERE production_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY position`).all(p.id, ...ids).map((r) => r.position) : [];
    if (slots.length !== ids.length) throw new HttpError(400, 'Unbekannter Unterpunkt in der Reihenfolge');
    for (let k = 1; k < slots.length; k++) if (slots[k] <= slots[k - 1]) slots[k] = slots[k - 1] + 0.001;
    ids.forEach((id, k) => upd.run(slots[k], id, p.id));
    changed(p.id);
    res.json({ ok: true });
  });
}
