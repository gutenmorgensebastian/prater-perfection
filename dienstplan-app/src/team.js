// API für To-Dos, „Fragen an“, Infos und Bestellwünsche.
import { db } from './db.js';
import { HttpError, intParam, requireWriter, upload, saveAttachment } from './http.js';
import { broadcast, pushTo, pushAll } from './notify.js';
import { snapshot } from './undo.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const nameOf = (id) => db.prepare('SELECT name FROM people WHERE id = ?').get(id)?.name ?? '';
const isAdmin = (req) => req.person.role === 'admin';
const notify = (fn) => fn.catch((err) => console.warn(err));

export const normTag = (t) => String(t ?? '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 30);

function attachmentsByItem(kind) {
  const map = new Map();
  const rows = db.prepare(`SELECT ia.item_id, a.id, a.original_name, a.mime, a.size FROM item_attachments ia
    JOIN attachments a ON a.id = ia.attachment_id WHERE ia.kind = ? ORDER BY a.id`).all(kind);
  for (const r of rows) {
    if (!map.has(r.item_id)) map.set(r.item_id, []);
    map.get(r.item_id).push({ id: r.id, name: r.original_name, mime: r.mime, size: r.size });
  }
  return map;
}

// Neue Positionen für eine umsortierte Teilmenge: die Plätze bleiben, nur die Reihenfolge ändert sich.
function reorder(table, ids) {
  const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!clean.length) return;
  const rows = db.prepare(`SELECT id, position FROM ${table} WHERE id IN (${clean.map(() => '?').join(',')})`).all(...clean);
  if (rows.length !== clean.length) throw new HttpError(400, 'Unbekannter Eintrag in der Reihenfolge');
  const slots = rows.map((r) => r.position).sort((a, b) => a - b);
  // Doppelte Positionen auflösen, damit die neue Reihenfolge eindeutig ist.
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 0.001;
  const upd = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  clean.forEach((id, i) => upd.run(slots[i], id));
}

// Vertrauliche Infos: sichtbar für Admins und die freigegebenen Personen.
export function canSeeInfo(info, person) {
  if (!info.restricted || person.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM info_viewers WHERE info_id = ? AND person_id = ?').get(info.id, person.id);
}

// Darf die Person diese Datei sehen? Nein, wenn sie nur an vertraulichen Infos hängt, die nicht für sie sind.
export function canSeeAttachment(attachmentId, person) {
  if (person.role === 'admin') return true;
  const infos = db.prepare(`SELECT i.* FROM item_attachments ia JOIN infos i ON i.id = ia.item_id
    WHERE ia.kind = 'info' AND ia.attachment_id = ?`).all(attachmentId);
  if (!infos.length || infos.some((i) => canSeeInfo(i, person))) return true;
  // Hängt die Datei zusätzlich irgendwo anders (Chat, To-Do, Bestellwunsch, Plan), bleibt sie dort sichtbar.
  return !!(db.prepare("SELECT 1 FROM item_attachments WHERE attachment_id = ? AND kind != 'info'").get(attachmentId)
    || db.prepare('SELECT 1 FROM messages WHERE attachment_id = ?').get(attachmentId)
    || db.prepare('SELECT 1 FROM rosters WHERE attachment_id = ?').get(attachmentId));
}

export function registerTeamRoutes(api) {
  // --- To-Dos -------------------------------------------------------------------
  function listTodos() {
    const rows = db.prepare('SELECT * FROM todos ORDER BY position, id').all();
    const assignees = db.prepare('SELECT * FROM todo_assignees').all();
    const tags = db.prepare('SELECT * FROM todo_tags ORDER BY tag').all();
    const files = attachmentsByItem('todo');
    return rows.filter((t) => !t.parent_id).map((t) => ({
      ...t,
      assignees: assignees.filter((a) => a.todo_id === t.id).map((a) => a.person_id),
      tags: tags.filter((g) => g.todo_id === t.id).map((g) => g.tag),
      attachments: files.get(t.id) || [],
      subtasks: rows.filter((s) => s.parent_id === t.id),
    }));
  }
  const getTodo = (id) => {
    const t = db.prepare('SELECT * FROM todos WHERE id = ?').get(intParam(id));
    if (!t) throw new HttpError(404, 'To-Do nicht gefunden');
    return t;
  };
  const todoOut = (id) => listTodos().find((t) => t.id === id) || db.prepare('SELECT * FROM todos WHERE id = ?').get(id);

  function setAssignees(todoId, ids) {
    const valid = [...new Set((Array.isArray(ids) ? ids : []).map(Number))]
      .filter((id) => db.prepare('SELECT 1 FROM people WHERE id = ?').get(id));
    const before = db.prepare('SELECT person_id FROM todo_assignees WHERE todo_id = ?').all(todoId).map((r) => r.person_id);
    db.prepare('DELETE FROM todo_assignees WHERE todo_id = ?').run(todoId);
    const ins = db.prepare('INSERT INTO todo_assignees (todo_id, person_id) VALUES (?, ?)');
    valid.forEach((id) => ins.run(todoId, id));
    return valid.filter((id) => !before.includes(id)); // neu zugeordnet
  }
  function setTags(todoId, tags) {
    db.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(todoId);
    const ins = db.prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag) VALUES (?, ?)');
    (Array.isArray(tags) ? tags : []).map(normTag).filter(Boolean).slice(0, 20).forEach((t) => ins.run(todoId, t));
  }
  const pushAssigned = (req, ids, title) => notify(pushTo(ids.filter((id) => id !== req.person.id),
    { title: `To-Do von ${req.person.name}`, body: title, url: '/#/todos' }));

  api.get('/todos', (req, res) => res.json(listTodos()));

  api.post('/todos', requireWriter, (req, res) => {
    const title = text(req.body?.title, 300);
    if (!title) throw new HttpError(400, 'Bitte einen Titel eingeben');
    let parentId = null;
    let position;
    if (req.body.parent_id) {
      const parent = getTodo(req.body.parent_id);
      if (parent.parent_id) throw new HttpError(400, 'Unteraufgaben können keine eigenen Unteraufgaben haben');
      parentId = parent.id;
      position = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM todos WHERE parent_id = ?').get(parentId).p;
    } else {
      position = db.prepare('SELECT COALESCE(MIN(position), 0) - 1 AS p FROM todos WHERE parent_id IS NULL').get().p; // neue oben
    }
    const r = db.prepare('INSERT INTO todos (parent_id, title, notes, flagged, position, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(parentId, title, text(req.body.notes, 5000), req.body.flagged ? 1 : 0, position, req.person.id);
    const id = Number(r.lastInsertRowid);
    if (!parentId) {
      pushAssigned(req, setAssignees(id, req.body.assignees), title);
      setTags(id, req.body.tags);
    }
    broadcast('todos');
    res.json(todoOut(id));
  });

  api.patch('/todos/:id', requireWriter, (req, res) => {
    const t = getTodo(req.params.id);
    const b = req.body || {};
    const title = b.title !== undefined ? text(b.title, 300) || t.title : t.title;
    const notes = b.notes !== undefined ? text(b.notes, 5000) : t.notes;
    const flagged = b.flagged !== undefined ? (b.flagged ? 1 : 0) : t.flagged;
    db.prepare('UPDATE todos SET title = ?, notes = ?, flagged = ? WHERE id = ?').run(title, notes, flagged, t.id);
    if (b.done !== undefined) {
      if (b.done) db.prepare(`UPDATE todos SET done = 1, done_by = ?, done_at = ${NOW} WHERE id = ?`).run(req.person.id, t.id);
      else db.prepare('UPDATE todos SET done = 0, done_by = NULL, done_at = NULL WHERE id = ?').run(t.id);
    }
    if (!t.parent_id && b.assignees !== undefined) pushAssigned(req, setAssignees(t.id, b.assignees), title);
    if (!t.parent_id && b.tags !== undefined) setTags(t.id, b.tags);
    broadcast('todos');
    res.json(todoOut(t.id));
  });

  api.delete('/todos/:id', requireWriter, (req, res) => {
    const t = getTodo(req.params.id);
    if (!t.parent_id && t.created_by !== req.person.id && !isAdmin(req)) throw new HttpError(403, 'Nur wer das To-Do angelegt hat (oder ein Admin) kann es löschen');
    const undo = snapshot(req.person.id, [
      { table: 'todos', where: 'id = ?', params: [t.id] },
      { table: 'todos', where: 'parent_id = ?', params: [t.id] },
      { table: 'todo_assignees', where: 'todo_id = ?', params: [t.id] },
      { table: 'todo_tags', where: 'todo_id = ?', params: [t.id] },
      { table: 'item_attachments', where: "kind = 'todo' AND item_id = ?", params: [t.id] },
    ]);
    db.prepare("DELETE FROM item_attachments WHERE kind = 'todo' AND item_id = ?").run(t.id);
    db.prepare('DELETE FROM todos WHERE id = ?').run(t.id);
    broadcast('todos');
    res.json({ ok: true, undo });
  });

  api.post('/todos/reorder', requireWriter, (req, res) => {
    reorder('todos', Array.isArray(req.body?.ids) ? req.body.ids : []);
    broadcast('todos');
    res.json({ ok: true });
  });

  // --- Anhänge an To-Dos, Infos, Bestellwünsche ---------------------------------------
  for (const [kind, table] of [['todo', 'todos'], ['info', 'infos'], ['order', 'orders']]) {
    const exists = (id, req) => {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(intParam(id));
      if (!row || (kind === 'info' && !canSeeInfo(row, req.person))) throw new HttpError(404, 'Eintrag nicht gefunden');
      if (kind === 'info' && row.restricted && !isAdmin(req)) throw new HttpError(403, 'Vertrauliche Infos können nur Admins ändern');
      return Number(id);
    };
    api.post(`/${table}/:id/attachments`, requireWriter, upload.single('file'), (req, res) => {
      const id = exists(req.params.id, req);
      if (!req.file) throw new HttpError(400, 'Keine Datei ausgewählt');
      const a = saveAttachment(req.file, req.person.id);
      db.prepare('INSERT INTO item_attachments (kind, item_id, attachment_id) VALUES (?, ?, ?)').run(kind, id, a.id);
      broadcast(table);
      res.json({ id: a.id, name: a.original_name, mime: a.mime, size: a.size });
    });
    api.delete(`/${table}/:id/attachments/:aid`, requireWriter, (req, res) => {
      const where = 'kind = ? AND item_id = ? AND attachment_id = ?';
      const params = [kind, exists(req.params.id, req), intParam(req.params.aid)];
      const undo = snapshot(req.person.id, [{ table: 'item_attachments', where, params }]);
      db.prepare(`DELETE FROM item_attachments WHERE ${where}`).run(...params);
      broadcast(table);
      res.json({ ok: true, undo });
    });
  }

  // --- Fragen an … ---------------------------------------------------------------
  // Eine Frage sehen nur die beiden Beteiligten – auch Admins sehen fremde Fragen nicht.
  function questionsFor(personId) {
    const rows = db.prepare(`SELECT q.*, f.name AS from_name, f.color AS from_color, t.name AS to_name, t.color AS to_color
      FROM questions q LEFT JOIN people f ON f.id = q.from_id LEFT JOIN people t ON t.id = q.to_id
      WHERE q.from_id = ? OR q.to_id = ? ORDER BY q.status = 'done', q.updated_at DESC, q.id DESC`).all(personId, personId);
    const replies = rows.length ? db.prepare(`SELECT r.*, p.name AS person_name FROM question_replies r LEFT JOIN people p ON p.id = r.person_id
      WHERE r.question_id IN (${rows.map(() => '?').join(',')}) ORDER BY r.id`).all(...rows.map((q) => q.id)) : [];
    return rows.map((q) => {
      const rs = replies.filter((r) => r.question_id === q.id);
      const lastBy = rs.length ? rs[rs.length - 1].person_id : q.from_id;
      // Wartet auf mich: offen und das letzte Wort hat die andere Person.
      return { ...q, replies: rs, waiting_for_me: q.status === 'open' && lastBy !== personId };
    });
  }
  const getQuestion = (req) => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(intParam(req.params.id));
    if (!q || (q.from_id !== req.person.id && q.to_id !== req.person.id)) throw new HttpError(404, 'Frage nicht gefunden');
    return q;
  };
  const questionsChanged = (q) => broadcast('questions', { people: [q.from_id, q.to_id] });

  api.get('/questions', (req, res) => {
    const all = questionsFor(req.person.id);
    res.json({ incoming: all.filter((q) => q.to_id === req.person.id), outgoing: all.filter((q) => q.from_id === req.person.id) });
  });

  api.get('/counts', (req, res) => {
    res.json({ questions: questionsFor(req.person.id).filter((q) => q.waiting_for_me).length });
  });

  api.post('/questions', requireWriter, (req, res) => {
    const body = text(req.body?.body, 3000);
    const to = db.prepare("SELECT * FROM people WHERE id = ? AND role != 'none'").get(Number(req.body?.to_id));
    if (!to) throw new HttpError(400, 'Bitte auswählen, an wen die Frage geht');
    if (to.id === req.person.id) throw new HttpError(400, 'Fragen an dich selbst gehen nicht');
    if (!body) throw new HttpError(400, 'Bitte eine Frage eingeben');
    const r = db.prepare('INSERT INTO questions (from_id, to_id, body) VALUES (?, ?, ?)').run(req.person.id, to.id, body);
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(r.lastInsertRowid);
    questionsChanged(q);
    notify(pushTo([to.id], { title: `Frage von ${req.person.name}`, body, url: '/#/fragen' }));
    res.json(q);
  });

  api.post('/questions/:id/replies', requireWriter, (req, res) => {
    const q = getQuestion(req);
    const body = text(req.body?.body, 3000);
    if (!body) throw new HttpError(400, 'Leere Antwort');
    db.prepare('INSERT INTO question_replies (question_id, person_id, body) VALUES (?, ?, ?)').run(q.id, req.person.id, body);
    db.prepare(`UPDATE questions SET status = 'open', updated_at = ${NOW} WHERE id = ?`).run(q.id);
    questionsChanged(q);
    const other = q.from_id === req.person.id ? q.to_id : q.from_id;
    notify(pushTo([other], { title: `Antwort von ${req.person.name}`, body, url: '/#/fragen' }));
    res.json({ ok: true });
  });

  api.patch('/questions/:id', requireWriter, (req, res) => {
    const q = getQuestion(req);
    const status = req.body?.status === 'done' ? 'done' : 'open';
    db.prepare(`UPDATE questions SET status = ?, updated_at = ${NOW} WHERE id = ?`).run(status, q.id);
    questionsChanged(q);
    res.json({ ok: true });
  });

  api.delete('/questions/:id', requireWriter, (req, res) => {
    const q = getQuestion(req);
    if (q.from_id !== req.person.id) throw new HttpError(403, 'Nur wer gefragt hat, kann die Frage löschen');
    const undo = snapshot(req.person.id, [
      { table: 'questions', where: 'id = ?', params: [q.id] },
      { table: 'question_replies', where: 'question_id = ?', params: [q.id] },
    ]);
    db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
    questionsChanged(q);
    res.json({ ok: true, undo });
  });

  // --- Infos -----------------------------------------------------------------------
  const CATEGORIES = ['Ansage', 'Sicherheit', 'Anleitung', 'Dokument', 'Allgemein'];
  const listInfos = (person) => {
    const files = attachmentsByItem('info');
    const viewers = new Map();
    for (const v of db.prepare('SELECT info_id, person_id FROM info_viewers').all()) {
      if (!viewers.has(v.info_id)) viewers.set(v.info_id, []);
      viewers.get(v.info_id).push(v.person_id);
    }
    return db.prepare('SELECT i.*, p.name AS author FROM infos i LEFT JOIN people p ON p.id = i.created_by ORDER BY i.position, i.id').all()
      .filter((i) => !i.restricted || person.role === 'admin' || viewers.get(i.id)?.includes(person.id))
      .map((i) => ({ ...i, viewers: i.restricted ? viewers.get(i.id) || [] : [], attachments: files.get(i.id) || [] }));
  };
  const editableInfo = (req) => {
    const i = db.prepare('SELECT * FROM infos WHERE id = ?').get(intParam(req.params.id));
    if (!i || !canSeeInfo(i, req.person)) throw new HttpError(404, 'Info nicht gefunden');
    if (i.restricted && !isAdmin(req)) throw new HttpError(403, 'Vertrauliche Infos können nur Admins ändern');
    if (i.created_by !== req.person.id && !isAdmin(req)) throw new HttpError(403, 'Nur wer die Info angelegt hat (oder ein Admin) kann sie ändern');
    return i;
  };
  // Sichtbarkeit festlegen dürfen nur Admins; bei allen anderen bleibt sie, wie sie ist.
  const setVisibility = (req, infoId) => {
    const b = req.body || {};
    if (!isAdmin(req) || b.restricted === undefined) return;
    const ids = b.restricted && Array.isArray(b.viewers) ? b.viewers.map(Number).filter(Number.isInteger) : [];
    db.prepare('UPDATE infos SET restricted = ? WHERE id = ?').run(b.restricted ? 1 : 0, infoId);
    db.prepare('DELETE FROM info_viewers WHERE info_id = ?').run(infoId);
    const add = db.prepare('INSERT OR IGNORE INTO info_viewers (info_id, person_id) SELECT ?, id FROM people WHERE id = ?');
    for (const id of ids) add.run(infoId, id);
  };
  // Ansagen per Push: vertrauliche nur an die Freigegebenen und ohne Inhalt (Codes gehören nicht auf den Sperrbildschirm).
  const announce = (req, infoId) => {
    const i = db.prepare('SELECT * FROM infos WHERE id = ?').get(infoId);
    if (i.category !== 'Ansage') return;
    if (!i.restricted) {
      notify(pushAll({ title: `📢 ${i.title}`, body: i.body || `Neue Ansage von ${req.person.name}`, url: '/#/infos' }, req.person.id));
      return;
    }
    const ids = db.prepare("SELECT person_id AS id FROM info_viewers WHERE info_id = ? UNION SELECT id FROM people WHERE role = 'admin'").all(i.id)
      .map((r) => r.id).filter((id) => id !== req.person.id);
    notify(pushTo(ids, { title: `🔒 ${i.title}`, body: 'Vertrauliche Info – im Pratomat ansehen', url: '/#/infos' }));
  };
  const readInfo = (b, fallback = {}) => {
    const title = text(b.title ?? fallback.title, 200);
    if (!title) throw new HttpError(400, 'Bitte einen Titel eingeben');
    const category = CATEGORIES.includes(b.category) ? b.category : (fallback.category || 'Allgemein');
    return { title, category, body: text(b.body ?? fallback.body, 20000) };
  };

  api.get('/infos', (req, res) => res.json({ categories: CATEGORIES, infos: listInfos(req.person) }));

  api.post('/infos', requireWriter, (req, res) => {
    const i = readInfo(req.body || {});
    const position = db.prepare('SELECT COALESCE(MIN(position), 0) - 1 AS p FROM infos').get().p;
    const r = db.prepare('INSERT INTO infos (category, title, body, position, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(i.category, i.title, i.body, position, req.person.id);
    const id = Number(r.lastInsertRowid);
    setVisibility(req, id);
    broadcast('infos');
    announce(req, id);
    res.json(listInfos(req.person).find((x) => x.id === id));
  });

  api.patch('/infos/:id', requireWriter, (req, res) => {
    const old = editableInfo(req);
    const i = readInfo(req.body || {}, old);
    db.prepare(`UPDATE infos SET category = ?, title = ?, body = ?, updated_at = ${NOW} WHERE id = ?`).run(i.category, i.title, i.body, old.id);
    setVisibility(req, old.id);
    broadcast('infos');
    if (i.category === 'Ansage' && old.category !== 'Ansage') announce(req, old.id);
    res.json(listInfos(req.person).find((x) => x.id === old.id));
  });

  api.delete('/infos/:id', requireWriter, (req, res) => {
    const i = editableInfo(req);
    const undo = snapshot(req.person.id, [
      { table: 'infos', where: 'id = ?', params: [i.id] },
      { table: 'info_viewers', where: 'info_id = ?', params: [i.id] },
      { table: 'item_attachments', where: "kind = 'info' AND item_id = ?", params: [i.id] },
    ]);
    db.prepare("DELETE FROM item_attachments WHERE kind = 'info' AND item_id = ?").run(i.id);
    db.prepare('DELETE FROM infos WHERE id = ?').run(i.id);
    broadcast('infos');
    res.json({ ok: true, undo });
  });

  api.post('/infos/reorder', requireWriter, (req, res) => {
    reorder('infos', Array.isArray(req.body?.ids) ? req.body.ids : []);
    broadcast('infos');
    res.json({ ok: true });
  });

  // --- Bestellwünsche --------------------------------------------------------------
  const listOrders = () => {
    const files = attachmentsByItem('order');
    return db.prepare(`SELECT o.*, c.name AS claimed_name, c.color AS claimed_color, p.name AS created_name FROM orders o
      LEFT JOIN people c ON c.id = o.claimed_by LEFT JOIN people p ON p.id = o.created_by
      ORDER BY o.status = 'done', o.updated_at DESC, o.id DESC`).all().map((o) => ({ ...o, attachments: files.get(o.id) || [] }));
  };
  const getOrder = (id) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(intParam(id));
    if (!o) throw new HttpError(404, 'Bestellwunsch nicht gefunden');
    return o;
  };

  api.get('/orders', (req, res) => res.json(listOrders()));

  api.post('/orders', requireWriter, (req, res) => {
    const title = text(req.body?.title, 200);
    if (!title) throw new HttpError(400, 'Bitte eintragen, was gebraucht wird');
    const r = db.prepare('INSERT INTO orders (title, quantity, notes, created_by) VALUES (?, ?, ?, ?)')
      .run(title, text(req.body.quantity, 60), text(req.body.notes, 2000), req.person.id);
    broadcast('orders');
    res.json(listOrders().find((o) => o.id === Number(r.lastInsertRowid)));
  });

  api.patch('/orders/:id', requireWriter, (req, res) => {
    const o = getOrder(req.params.id);
    const b = req.body || {};
    const me = req.person.id;
    const mine = o.claimed_by === me || isAdmin(req);
    if (b.action === 'claim') {
      if (o.claimed_by && o.claimed_by !== me && o.status !== 'open') throw new HttpError(409, `${nameOf(o.claimed_by)} kümmert sich schon darum`);
      db.prepare(`UPDATE orders SET status = 'claimed', claimed_by = ?, updated_at = ${NOW} WHERE id = ?`).run(me, o.id);
      if (o.created_by !== me) notify(pushTo([o.created_by], { title: 'Bestellwunsch übernommen', body: `${req.person.name} kümmert sich um: ${o.title}`, url: '/#/bestellen' }));
    } else if (b.action === 'release') {
      if (!mine) throw new HttpError(403, 'Nur wer sich kümmert, kann den Eintrag wieder abgeben');
      db.prepare(`UPDATE orders SET status = 'open', claimed_by = NULL, updated_at = ${NOW} WHERE id = ?`).run(o.id);
    } else if (b.action === 'ordered' || b.action === 'done') {
      if (o.claimed_by && !mine) throw new HttpError(403, `${nameOf(o.claimed_by)} kümmert sich darum`);
      db.prepare(`UPDATE orders SET status = ?, claimed_by = COALESCE(claimed_by, ?), updated_at = ${NOW} WHERE id = ?`).run(b.action, me, o.id);
      if (b.action === 'done' && o.created_by !== me) notify(pushTo([o.created_by], { title: 'Bestellwunsch erledigt', body: o.title, url: '/#/bestellen' }));
    } else if (b.action === 'reopen') {
      db.prepare(`UPDATE orders SET status = 'open', claimed_by = NULL, updated_at = ${NOW} WHERE id = ?`).run(o.id);
    } else {
      if (o.created_by !== me && !mine) throw new HttpError(403, 'Diesen Eintrag darfst du nicht ändern');
      db.prepare(`UPDATE orders SET title = ?, quantity = ?, notes = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(text(b.title ?? o.title, 200) || o.title, text(b.quantity ?? o.quantity, 60), text(b.notes ?? o.notes, 2000), o.id);
    }
    broadcast('orders');
    res.json(listOrders().find((x) => x.id === o.id));
  });

  api.delete('/orders/:id', requireWriter, (req, res) => {
    const o = getOrder(req.params.id);
    if (o.created_by !== req.person.id && !isAdmin(req)) throw new HttpError(403, 'Nur wer den Wunsch eingetragen hat (oder ein Admin) kann ihn löschen');
    const undo = snapshot(req.person.id, [
      { table: 'orders', where: 'id = ?', params: [o.id] },
      { table: 'item_attachments', where: "kind = 'order' AND item_id = ?", params: [o.id] },
    ]);
    db.prepare("DELETE FROM item_attachments WHERE kind = 'order' AND item_id = ?").run(o.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
    broadcast('orders');
    res.json({ ok: true, undo });
  });
}
