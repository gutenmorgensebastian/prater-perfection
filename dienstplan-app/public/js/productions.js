// „Produktionen“: ein kleines Wiki pro Produktion – Überblick, Vorbereitung, Show, Nachbereitung.
import { api, esc, $, $$, setTitle, showError, toast, canWrite, isAdmin, openModal, fmtDate, loadPref, savePref, deleteWithUndo, state } from './core.js';
import { attachmentsHtml, bindAttachments } from './files.js';
import { PHASES, STATUSES, DATED } from '/shared/production-template.js';

let view = null;
let current = null;   // { id, phase, focus } oder null (Übersicht)
let data = null;      // geladene Produktion
let sortable = null;
const editors = new Map(); // Unterpunkte, die gerade bearbeitet werden: id → { base }

// --- Links erkennbar machen (Google Docs, Tabellen, Drive, PDF …) ---------------------------
export function linkKind(url) {
  let u;
  try { u = new URL(url); } catch { return { icon: '🔗', label: 'Link' }; }
  const h = u.hostname.replace(/^www\./, '');
  if (h === 'docs.google.com') {
    if (u.pathname.startsWith('/document')) return { icon: '📄', label: 'Google Doc' };
    if (u.pathname.startsWith('/spreadsheets')) return { icon: '📊', label: 'Google Tabelle' };
    if (u.pathname.startsWith('/presentation')) return { icon: '📽️', label: 'Google Präsentation' };
    if (u.pathname.startsWith('/forms')) return { icon: '📝', label: 'Google Formular' };
  }
  if (h === 'drive.google.com') return { icon: '📁', label: 'Google Drive' };
  if (/\.pdf$/i.test(u.pathname)) return { icon: '📕', label: `PDF · ${h}` };
  if (/dropbox|pcloud|onedrive|sharepoint|nextcloud|wetransfer/.test(h)) return { icon: '📦', label: h };
  if (/youtube|youtu\.be|vimeo/.test(h)) return { icon: '🎬', label: h };
  return { icon: '🔗', label: h };
}

// --- Wiki-Text: Stichpunkte, Häkchen, Überschriften, **fett**, Links -------------------------
const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
function inline(raw) {
  // Links zuerst heraustrennen, damit Text drumherum sicher escaped wird.
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(URL_RE)) {
    out += esc(raw.slice(last, m.index));
    const k = linkKind(m[0]);
    const known = k.icon !== '🔗';
    out += `<a class="wk-link${known ? ' known' : ''}" href="${esc(m[0])}" target="_blank" rel="noopener noreferrer">${k.icon} ${esc(known ? k.label : m[0].replace(/^https?:\/\//, '').slice(0, 60))}</a>`;
    last = m.index + m[0].length;
  }
  out += esc(raw.slice(last));
  return out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

export function renderWiki(body, canCheck) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</ul>`); list = null; } };
  const open = (kind) => { if (list !== kind) { close(); out.push(`<ul class="wk-${kind}">`); list = kind; } };
  String(body || '').split('\n').forEach((line, i) => {
    let m;
    if ((m = line.match(/^\s*\[( |x|X)\]\s?(.*)$/))) {
      if (!m[2].trim()) return; // leeres Kästchen aus der Vorlage nicht anzeigen
      open('checks');
      const done = m[1] !== ' ';
      out.push(`<li class="${done ? 'done' : ''}"><label><input type="checkbox" data-line="${i}" ${done ? 'checked' : ''} ${canCheck ? '' : 'disabled'}> <span>${inline(m[2])}</span></label></li>`);
    } else if ((m = line.match(/^\s*[-*•](?:\s+(.*))?$/))) {
      if (!m[1]?.trim()) return; // leerer Stichpunkt
      open('bullets');
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^#{1,3}\s+(.*)$/))) {
      close();
      out.push(`<h4>${inline(m[1])}</h4>`);
    } else if (!line.trim()) {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  });
  close();
  return out.join('');
}

// --- Routing ------------------------------------------------------------------------------
export function renderProductions(viewEl) {
  view = viewEl;
  const [, , id, phase, focus] = location.hash.split('/');
  editors.clear();
  if (id && Number(id)) {
    current = { id: Number(id), phase: PHASES.some((p) => p.key === phase) ? phase : loadPref(`prod-phase-${id}`, 'ueberblick'), focus: Number(focus) || null };
    loadProduction();
  } else {
    current = null;
    renderList();
  }
  return () => { view = null; current = null; sortable?.destroy(); sortable = null; };
}

let pendingRefresh = false;
export function refreshProductions(msg = {}) {
  if (!view) return;
  // Während jemand schreibt, nicht neu zeichnen – sonst springt der Cursor. Nach Speichern/Abbrechen nachholen.
  if (current && editors.size) { pendingRefresh = true; return; }
  if (!current) renderList();
  else if (!msg.id || msg.id === current.id) loadProduction(true);
}

// --- Übersicht ----------------------------------------------------------------------------
const statusChip = (s) => `<span class="prod-status st-${s}">${esc(STATUSES[s] || s)}</span>`;
const when = (e) => `${fmtDate(e.start)}${e.all_day ? '' : `, ${e.start.slice(11, 16)}`}`;

async function renderList() {
  setTitle('Produktionen', canWrite() ? '<button id="prod-new">＋ Produktion</button>' : '');
  $('#prod-new')?.addEventListener('click', () => editProduction());
  let list;
  try { list = await api('/productions'); } catch (err) { showError(err); return; }
  if (!view || current) return;
  const card = (p) => `<a class="prod-card" href="#/produktionen/${p.id}">
      <div class="prod-card-head"><b>${esc(p.name)}</b>${statusChip(p.status)}</div>
      <div class="muted small">${[p.premiere ? `Premiere ${fmtDate(p.premiere)}` : '', p.venue].filter(Boolean).map(esc).join(' · ')}</div>
      ${p.next ? `<div class="small">📅 Nächster Termin: ${esc(when(p.next))} – ${esc(p.next.title)}</div>` : ''}
      <div class="muted small">${p.pages ? `${p.pages} Unterpunkt${p.pages === 1 ? '' : 'e'} ausgefüllt` : 'Noch nichts eingetragen'}</div>
    </a>`;
  const active = list.filter((p) => p.status !== 'abgespielt');
  const archive = list.filter((p) => p.status === 'abgespielt');
  view.innerHTML = `
    <div class="toolbar"><input type="search" id="prod-q" placeholder="In allen Produktionen suchen …" value="${esc(loadPref('prod-q', ''))}"></div>
    <div id="prod-results"></div>
    <div id="prod-cards">
      ${active.length ? active.map(card).join('') : '<p class="empty">Noch keine Produktionen.</p>'}
      ${archive.length ? `<details class="prod-archive"><summary>Abgespielt (${archive.length})</summary>${archive.map(card).join('')}</details>` : ''}
    </div>`;
  const q = $('#prod-q');
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(search, 250); };
  if (q.value) search();
}

async function search() {
  const q = $('#prod-q')?.value.trim() || '';
  savePref('prod-q', q);
  const box = $('#prod-results');
  $('#prod-cards').hidden = q.length >= 2;
  if (q.length < 2) { box.innerHTML = ''; return; }
  try {
    const hits = await api(`/productions/search?q=${encodeURIComponent(q)}`);
    const label = Object.fromEntries(PHASES.map((p) => [p.key, `${p.icon} ${p.label}`]));
    box.innerHTML = hits.length ? hits.map((h) => `<a class="prod-hit" href="#/produktionen/${h.production_id}/${h.phase}/${h.id}">
        <div class="small muted">${esc(h.production)} · ${esc(label[h.phase] || h.phase)}</div>
        <b>${esc(h.title)}</b>${h.snippet ? `<div class="small">${esc(h.snippet)}</div>` : ''}</a>`).join('')
      : '<p class="empty">Nichts gefunden.</p>';
  } catch (err) { showError(err); }
}

// --- Eine Produktion ----------------------------------------------------------------------
async function loadProduction(keepEditors) {
  const id = current.id;
  pendingRefresh = false;
  try { data = await api(`/productions/${id}`); } catch (err) { showError(err); location.hash = '#/produktionen'; return; }
  if (!view || current?.id !== id) return;
  // Offene Editoren mit ihrem Entwurf merken und nach dem Neuzeichnen wieder öffnen.
  const drafts = keepEditors ? [...editors.keys()].map((pid) => ({ pid, ...readEditor(pid) })).filter((d) => d.title !== undefined) : [];
  renderProduction();
  for (const d of drafts) openEditor(d.pid, d);
}

function renderProduction() {
  const p = data;
  const mayManage = canWrite();
  setTitle(p.name, mayManage ? '<button id="prod-edit">✎ Bearbeiten</button>' : '');
  $('#prod-edit')?.addEventListener('click', () => editProduction(p));
  const phase = current.phase;
  const count = (k) => p.pages.filter((pg) => pg.phase === k && pg.body.trim()).length;
  const pages = p.pages.filter((pg) => pg.phase === phase);
  const dated = DATED[phase];
  view.innerHTML = `
    <a class="back" href="#/produktionen">‹ Alle Produktionen</a>
    <div class="prod-head">
      ${statusChip(p.status)}
      <span class="muted small">${[p.premiere ? `Premiere ${fmtDate(p.premiere)}` : '', p.venue].filter(Boolean).map(esc).join(' · ')}</span>
    </div>
    <section class="prod-links">
      <h3>📌 Wichtige Links</h3>
      <div class="link-tiles">${p.links.map((l) => {
        const k = linkKind(l.url);
        return `<div class="link-tile"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><span class="lt-ico">${k.icon}</span>
          <span><b>${esc(l.title)}</b><span class="small muted">${esc(k.label)}</span></span></a>
          ${mayManage ? `<button class="link" data-link-edit="${l.id}" title="Link bearbeiten">⋯</button>` : ''}</div>`;
      }).join('') || '<p class="small muted">Noch keine Links – z. B. Regiebuch (Google Doc), Lichtplot, Cue-Liste, Bühnenplan.</p>'}</div>
      ${mayManage ? '<button class="small-btn" id="link-add">＋ Link anheften</button>' : ''}
    </section>
    ${p.upcoming.length ? `<section class="prod-dates"><h3>📅 Nächste Termine</h3><ul>${p.upcoming.map((e) => `<li><b>${esc(when(e))}</b> ${esc(e.title)}${e.calendar ? ` <span class="muted small">(${esc(e.calendar)})</span>` : ''}</li>`).join('')}</ul></section>` : ''}
    <nav class="phase-tabs">${PHASES.map((ph) => `<a href="#/produktionen/${p.id}/${ph.key}" class="${ph.key === phase ? 'on' : ''}">${ph.icon} ${ph.label}${count(ph.key) ? ` <span class="cnt">${count(ph.key)}</span>` : ''}</a>`).join('')}</nav>
    <div class="pages" id="pages">${pages.map(pageHtml).join('') || '<p class="empty">Noch keine Unterpunkte.</p>'}</div>
    ${mayManage ? `<div class="row page-add">
      ${dated ? `<button class="shrink" id="page-dated">${dated.button}</button>` : ''}
      <button class="shrink" id="page-add">＋ Unterpunkt</button></div>` : ''}`;
  savePref(`prod-phase-${p.id}`, phase);
  bindProduction();
  if (current.focus) {
    const el = $(`.page[data-id="${current.focus}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
    current.focus = null;
  }
}

function pageHtml(pg) {
  const w = canWrite();
  const checked = /^\s*\[[xX]\]/m.test(pg.body);
  return `<article class="page" data-id="${pg.id}">
    <header>
      ${w ? '<span class="handle" title="Zum Sortieren ziehen">⠿</span>' : ''}
      <h3>${pg.date ? `<span class="date-badge">${esc(fmtDate(pg.date))}</span> ` : ''}${esc(pg.title)}</h3>
      ${w ? '<button class="link" data-edit>Bearbeiten</button>' : ''}
    </header>
    <div class="wiki" ${w ? 'data-edit-area' : ''}>${pg.body.trim() ? renderWiki(pg.body, w) : `<p class="hint">${esc(pg.hint || 'Noch leer.')}${w ? ' <span class="tap">Antippen zum Ausfüllen.</span>' : ''}</p>`}</div>
    ${pg.attachments.length ? attachmentsHtml(pg.attachments, false) : ''}
    <footer class="muted small">${pg.updated_name && pg.body.trim() ? `zuletzt ${esc(pg.updated_name)}, ${esc(fmtDate(pg.updated_at))}` : ''}
      ${w && checked ? '<button class="link" data-uncheck>Häkchen zurücksetzen</button>' : ''}</footer>
  </article>`;
}

function bindProduction() {
  const pagesEl = $('#pages');
  $('#link-add')?.addEventListener('click', () => editLink());
  view.querySelectorAll('[data-link-edit]').forEach((b) => b.addEventListener('click', () => editLink(data.links.find((l) => l.id === Number(b.dataset.linkEdit)))));
  $('#page-add')?.addEventListener('click', () => newPage(false));
  $('#page-dated')?.addEventListener('click', () => newPage(true));
  pagesEl.addEventListener('click', async (e) => {
    const art = e.target.closest('.page');
    if (!art) return;
    const id = Number(art.dataset.id);
    if (e.target.closest('a, input, button[data-save], .editor')) return;
    if (e.target.closest('[data-uncheck]')) {
      try { await api(`/prod-pages/${id}/uncheck`, { method: 'POST' }); } catch (err) { showError(err); }
      return;
    }
    // Leere Unterpunkte öffnen sich mit einem Tipp, gefüllte über „Bearbeiten“.
    if (e.target.closest('[data-edit]') || (e.target.closest('[data-edit-area]') && !data.pages.find((p) => p.id === id)?.body.trim())) openEditor(id);
  });
  pagesEl.addEventListener('change', async (e) => {
    const line = e.target.dataset.line;
    if (line === undefined) return;
    const id = Number(e.target.closest('.page').dataset.id);
    e.target.closest('li').classList.toggle('done', e.target.checked);
    try { await api(`/prod-pages/${id}/toggle`, { method: 'POST', body: { line: Number(line) } }); } catch (err) { showError(err); loadProduction(true); }
  });
  sortable?.destroy();
  sortable = canWrite() && window.Sortable ? Sortable.create(pagesEl, {
    handle: '.handle', animation: 150, draggable: '.page',
    onEnd: async () => {
      try { await api(`/productions/${data.id}/reorder`, { method: 'POST', body: { ids: $$('.page', pagesEl).map((a) => Number(a.dataset.id)) } }); } catch (err) { showError(err); loadProduction(true); }
    },
  }) : null;
}

// --- Unterpunkt bearbeiten (direkt in der Seite) --------------------------------------------
function openEditor(id, draft) {
  const pg = data.pages.find((p) => p.id === id);
  const art = $(`.page[data-id="${id}"]`);
  if (!pg || !art) { editors.delete(id); return; }
  const base = draft?.base ?? pg.updated_at;
  editors.set(id, { base });
  art.classList.add('editing');
  art.innerHTML = `<form class="editor">
    <div class="row"><input name="title" maxlength="120" value="${esc(draft?.title ?? pg.title)}" aria-label="Titel">
      ${pg.date || draft?.date ? `<input type="date" name="date" class="shrink" value="${esc(draft?.date ?? pg.date ?? '')}" aria-label="Datum">` : ''}</div>
    <textarea name="body" rows="8" maxlength="50000" placeholder="${esc(pg.hint || '')}">${esc(draft?.body ?? pg.body)}</textarea>
    <p class="small muted fmt-help"><code>- Stichpunkt</code> · <code>[ ] Aufgabe</code> · <code>## Überschrift</code> · <code>**fett**</code> · Links einfach einfügen (Google Docs werden erkannt)</p>
    <label>Fotos &amp; Dateien</label>
    <div class="page-atts">${attachmentsHtml(pg.attachments, true)}</div>
    <div class="buttons">
      <button type="button" class="danger" data-del>Löschen</button>
      <button type="button" data-cancel>Abbrechen</button>
      <button class="primary" type="submit" data-save>Speichern</button>
    </div>
  </form>`;
  const form = $('.editor', art);
  const ta = form.body;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 4, window.innerHeight * 0.7)}px`; };
  ta.addEventListener('input', grow);
  grow();
  if (!draft) ta.focus();
  // Enter in einer Liste setzt den nächsten Stichpunkt bzw. das nächste Kästchen fort.
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    const m = line.match(/^(\s*)(- |\[[ xX]\] ?)(.*)$/);
    if (!m) return;
    e.preventDefault();
    if (!m[3].trim()) { // leerer Punkt beendet die Liste
      ta.setRangeText('', ta.selectionStart - line.length, ta.selectionStart, 'end');
      return;
    }
    ta.setRangeText(`\n${m[1]}${m[2].startsWith('[') ? '[ ] ' : '- '}`, ta.selectionStart, ta.selectionEnd, 'end');
    grow();
  });
  form.querySelector('[data-cancel]').onclick = () => {
    editors.delete(id);
    art.outerHTML = pageHtml(pg);
    if (pendingRefresh && !editors.size) { pendingRefresh = false; loadProduction(true); }
  };
  form.querySelector('[data-del]').onclick = async () => {
    editors.delete(id);
    try { await deleteWithUndo(`/prod-pages/${id}`, () => loadProduction(true)); } catch (err) { showError(err); }
  };
  bindAttachments($('.page-atts', form), 'prod_pages', id, () => loadProduction(true));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { title: form.title.value, body: ta.value, base: editors.get(id)?.base };
    if (form.date) body.date = form.date.value;
    const save = async (force) => {
      await api(`/prod-pages/${id}`, { method: 'PATCH', body: { ...body, force } });
      editors.delete(id);
      toast('Gespeichert');
      loadProduction(true);
    };
    try {
      await save(false);
    } catch (err) {
      if (err.status === 409 && confirm(`${err.message}\n\nDeine Fassung trotzdem speichern? (Die andere Änderung wird überschrieben – Abbrechen, um erst nachzusehen.)`)) {
        try { await save(true); } catch (err2) { showError(err2); }
      } else showError(err);
    }
  };
}

function readEditor(id) {
  const form = $(`.page[data-id="${id}"] .editor`);
  if (!form) return {};
  return { title: form.title.value, body: form.body.value, date: form.date?.value, base: editors.get(id)?.base };
}

async function newPage(dated) {
  const phase = current.phase;
  const today = new Date().toISOString().slice(0, 10);
  const d = DATED[phase];
  const body = dated
    ? { phase, title: d.label, date: today, body: d.body }
    : { phase, title: 'Neuer Unterpunkt', body: '' };
  try {
    const pg = await api(`/productions/${data.id}/pages`, { method: 'POST', body });
    data = await api(`/productions/${data.id}`);
    renderProduction();
    openEditor(pg.id);
    const form = $(`.page[data-id="${pg.id}"] .editor`);
    if (!dated) { form.title.select(); form.title.focus(); }
    form.scrollIntoView({ block: 'center' });
  } catch (err) { showError(err); }
}

// --- Produktion anlegen / bearbeiten ---------------------------------------------------------
function editProduction(p) {
  const mayDelete = p && (isAdmin() || p.created_by === state.me.id);
  openModal(`
    <h2>${p ? 'Produktion bearbeiten' : 'Neue Produktion'}</h2>
    <form id="prod-form">
      <label for="pf-name">Name</label><input id="pf-name" name="name" maxlength="80" required value="${esc(p?.name || '')}">
      <div class="row">
        <div><label for="pf-status">Status</label><select id="pf-status" name="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === (p?.status || 'vorbereitung') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label for="pf-premiere">Premiere</label><input type="date" id="pf-premiere" name="premiere" value="${esc(p?.premiere || '')}"></div>
      </div>
      <label for="pf-venue">Spielstätte</label><input id="pf-venue" name="venue" maxlength="60" value="${esc(p?.venue ?? 'Prater')}">
      ${p ? '' : '<p class="small muted">Die neue Produktion bekommt die übliche Gliederung (Überblick, Vorbereitung, Show, Nachbereitung) mit Vorschlägen für Unterpunkte. Alles lässt sich danach ändern.</p>'}
      <p class="small muted">Termine im Kalender, deren Titel den Namen enthält, erscheinen automatisch unter „Nächste Termine“.</p>
      <div class="buttons">
        ${mayDelete ? '<button type="button" class="danger" id="pf-del">Löschen</button>' : ''}
        <button type="button" data-close>Abbrechen</button><button class="primary" type="submit">Speichern</button>
      </div>
    </form>`, (dlg) => {
    $('#prod-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try {
        const saved = await api(p ? `/productions/${p.id}` : '/productions', { method: p ? 'PATCH' : 'POST', body });
        dlg.close();
        if (p) loadProduction(true); else location.hash = `#/produktionen/${saved.id}`;
      } catch (err) { showError(err); }
    };
    $('#pf-del', dlg)?.addEventListener('click', async () => {
      dlg.close();
      location.hash = '#/produktionen';
      try { await deleteWithUndo(`/productions/${p.id}`, () => refreshProductions()); } catch (err) { showError(err); }
    });
  });
}

function editLink(l) {
  openModal(`
    <h2>${l ? 'Link bearbeiten' : 'Link anheften'}</h2>
    <form id="link-form">
      <label for="lf-title">Bezeichnung</label><input id="lf-title" name="title" maxlength="100" placeholder="z. B. Regiebuch, Lichtplot, Cue-Liste" value="${esc(l?.title || '')}">
      <label for="lf-url">Link</label><input id="lf-url" name="url" type="url" inputmode="url" required placeholder="https://docs.google.com/…" value="${esc(l?.url || '')}">
      <p class="small muted">Google Docs, Tabellen und Drive-Ordner bekommen automatisch ein passendes Symbol.</p>
      <div class="buttons">
        ${l ? '<button type="button" class="danger" id="lf-del">Entfernen</button>' : ''}
        <button type="button" data-close>Abbrechen</button><button class="primary" type="submit">Speichern</button>
      </div>
    </form>`, (dlg) => {
    const form = $('#link-form', dlg);
    // Bezeichnung vorschlagen, wenn ein Google-Link eingefügt wird.
    form.url.addEventListener('input', () => { if (!form.title.value) { const k = linkKind(form.url.value); if (k.icon !== '🔗') form.title.placeholder = k.label; } });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = { title: form.title.value || form.title.placeholder.replace(/^z\. B\..*/, ''), url: form.url.value };
      try {
        await api(l ? `/prod-links/${l.id}` : `/productions/${data.id}/links`, { method: l ? 'PATCH' : 'POST', body });
        dlg.close();
        loadProduction(true);
      } catch (err) { showError(err); }
    };
    $('#lf-del', dlg)?.addEventListener('click', async () => {
      dlg.close();
      try { await deleteWithUndo(`/prod-links/${l.id}`, () => loadProduction(true)); } catch (err) { showError(err); }
    });
  });
}
