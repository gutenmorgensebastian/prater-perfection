import { state, api, esc, linkify, $, $$, setTitle, showError, toast, canWrite, isAdmin, openModal, personById, fmtDate, loadPref, savePref } from './core.js';
import { attachmentsHtml, bindAttachments } from './files.js';

let mounted = false;
let data = { categories: [], infos: [] };
let sortables = [];
const ICONS = { Ansage: '📢', Sicherheit: '🦺', Anleitung: '🛠️', Dokument: '📄', Allgemein: 'ℹ️' };

export async function refreshInfos() {
  if (!mounted) return;
  try {
    data = await api('/infos');
    renderList();
    const dlg = $('#modal');
    if (dlg.open && dlg.dataset.info) renderEdit(Number(dlg.dataset.info));
  } catch (err) { showError(err); }
}

export function renderInfos(view) {
  mounted = true;
  setTitle('Infos', canWrite() ? '<button id="info-new">＋ Info</button>' : '');
  view.innerHTML = `
    <div class="toolbar"><input type="search" id="info-q" placeholder="Infos durchsuchen …" value="${esc(loadPref('info-q', ''))}"></div>
    <div class="chips" id="info-cats"></div>
    <div id="info-list"></div>`;
  $('#info-new')?.addEventListener('click', createInfo);
  $('#info-q').addEventListener('input', (e) => { savePref('info-q', e.target.value); renderList(); });
  $('#info-cats').onclick = (e) => {
    const c = e.target.closest('[data-cat]')?.dataset.cat;
    if (c === undefined) return;
    savePref('info-cat', loadPref('info-cat', '') === c ? '' : c);
    renderList();
  };
  $('#info-list').onclick = (e) => {
    const id = e.target.closest('[data-edit]')?.dataset.edit;
    if (id) openEdit(Number(id));
  };
  refreshInfos();
  return () => { mounted = false; sortables.forEach((s) => s.destroy()); sortables = []; };
}

const mayEdit = (i) => canWrite() && (i.created_by === state.me.id || isAdmin());

function infoHtml(i) {
  return `<article class="info ${i.category.toLowerCase()}" data-id="${i.id}">
    <h3>${canWrite() ? '<span class="handle" title="Zum Sortieren ziehen">⠿</span>' : ''}<span>${ICONS[i.category] || 'ℹ️'}</span><span class="grow">${esc(i.title)}</span>
      ${mayEdit(i) ? `<button class="link" data-edit="${i.id}">Bearbeiten</button>` : ''}</h3>
    ${i.body ? `<div class="body">${linkify(i.body)}</div>` : ''}
    ${i.attachments.length ? attachmentsHtml(i.attachments, false) : ''}
    <div class="foot">${esc(i.category)} · ${esc(i.author || '–')} · ${fmtDate(i.updated_at)}</div>
  </article>`;
}

function renderList() {
  const list = $('#info-list');
  if (!list) return;
  const cat = loadPref('info-cat', '');
  const words = loadPref('info-q', '').toLowerCase().split(/\s+/).filter(Boolean);
  const present = data.categories.filter((c) => data.infos.some((i) => i.category === c));
  $('#info-cats').innerHTML = present.map((c) => `<span class="chip ${cat === c ? 'on' : ''}" data-cat="${c}">${ICONS[c]} ${c}</span>`).join('');
  const shown = data.infos.filter((i) => (!cat || i.category === cat)
    && words.every((w) => `${i.title}\n${i.body}\n${i.attachments.map((a) => a.name).join(' ')}`.toLowerCase().includes(w)));
  sortables.forEach((s) => s.destroy());
  sortables = [];
  if (!shown.length) {
    list.innerHTML = `<p class="empty">${data.infos.length ? 'Nichts gefunden.' : 'Noch keine Infos. Hier gehören z. B. die Sicherheitsbestimmungen, die Anleitung für die Alarmanlage oder wichtige Ansagen hin.'}</p>`;
    return;
  }
  // Gruppiert nach Rubrik, Ansagen zuerst.
  list.innerHTML = data.categories.filter((c) => shown.some((i) => i.category === c)).map((c) => `
    <section class="group"><h2>${ICONS[c]} ${c}</h2><div class="info-group" data-cat="${c}">${shown.filter((i) => i.category === c).map(infoHtml).join('')}</div></section>`).join('');
  if (canWrite() && window.Sortable) {
    sortables = $$('.info-group', list).map((el) => Sortable.create(el, {
      handle: '.handle', animation: 150,
      onEnd: async () => {
        try { await api('/infos/reorder', { method: 'POST', body: { ids: $$('.info', el).map((a) => Number(a.dataset.id)) } }); } catch (err) { showError(err); refreshInfos(); }
      },
    }));
  }
}

function createInfo() {
  openModal(`
    <h2>Neue Info</h2>
    <form id="info-new-form">
      <label for="in-cat">Rubrik</label>
      <select id="in-cat" name="category">${data.categories.map((c) => `<option ${c === 'Allgemein' ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <p class="small muted" style="margin:.2rem 0 0">Bei „Ansage“ bekommen alle eine Benachrichtigung.</p>
      <label for="in-title">Titel</label><input id="in-title" name="title" maxlength="200" required>
      <label for="in-body">Text</label><textarea id="in-body" name="body" rows="6" maxlength="20000"></textarea>
      <p class="small muted">PDFs und Fotos kannst du gleich nach dem Speichern anhängen.</p>
      <div class="buttons"><button type="button" data-close>Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
    </form>`, (dlg) => {
    $('#info-new-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const i = await api('/infos', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        await refreshInfos();
        openEdit(i.id);
      } catch (err) { showError(err); }
    };
  });
}

function openEdit(id) {
  const dlg = openModal('<div id="info-edit"></div>');
  dlg.dataset.info = id;
  dlg.addEventListener('close', () => { delete dlg.dataset.info; }, { once: true });
  renderEdit(id);
}

function renderEdit(id) {
  const i = data.infos.find((x) => x.id === id);
  const root = $('#info-edit');
  if (!i || !root) { $('#modal').close(); return; }
  root.innerHTML = `
    <h2>Info bearbeiten</h2>
    <form id="info-form">
      <label for="info-cat">Rubrik</label>
      <select id="info-cat" name="category">${data.categories.map((c) => `<option ${c === i.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <p class="small muted" style="margin:.2rem 0 0">Bei „Ansage“ bekommen alle eine Benachrichtigung.</p>
      <label for="info-title">Titel</label><input id="info-title" name="title" value="${esc(i.title)}" maxlength="200" required>
      <label for="info-body">Text</label><textarea id="info-body" name="body" rows="8" maxlength="20000">${esc(i.body)}</textarea>
      <label>PDFs, Fotos &amp; Dateien</label>
      <div id="info-atts">${attachmentsHtml(i.attachments, true)}</div>
      <p class="muted small">von ${esc(personById(i.created_by)?.name || '–')}</p>
      <div class="buttons">
        <button type="button" class="danger" id="info-del">Löschen</button>
        <button type="button" data-close>Schließen</button>
        <button class="primary" type="submit">Speichern</button>
      </div>
    </form>`;
  $('[data-close]', root).onclick = () => $('#modal').close();
  $('#info-form', root).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/infos/${i.id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
      $('#modal').close();
      toast('Gespeichert');
      refreshInfos();
    } catch (err) { showError(err); }
  };
  $('#info-del', root).onclick = async () => {
    if (!confirm('Info löschen?')) return;
    try { await api(`/infos/${i.id}`, { method: 'DELETE' }); $('#modal').close(); refreshInfos(); } catch (err) { showError(err); }
  };
  bindAttachments($('#info-atts', root), 'infos', i.id, async () => {
    // Text nicht verlieren, wenn während des Bearbeitens eine Datei angehängt wird.
    const form = $('#info-form');
    const draft = form && Object.fromEntries(new FormData(form));
    await refreshInfos();
    const f = $('#info-form');
    if (draft && f) { f.category.value = draft.category; f.title.value = draft.title; f.body.value = draft.body; }
  });
}
