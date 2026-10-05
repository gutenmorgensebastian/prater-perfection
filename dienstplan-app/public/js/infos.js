import { state, api, esc, linkify, $, $$, setTitle, showError, toast, canWrite, isAdmin, openModal, personById, fmtDate, loadPref, savePref, deleteWithUndo } from './core.js';
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

const mayEdit = (i) => canWrite() && (isAdmin() || (!i.restricted && i.created_by === state.me.id));
const ANSAGE_HINT = () => (isAdmin() ? 'Bei „Ansage“ bekommen alle eine Benachrichtigung – bei vertraulichen Infos nur die Ausgewählten, ohne den Text.' : 'Bei „Ansage“ bekommen alle eine Benachrichtigung.');
const names = (ids) => ids.map((id) => personById(id)?.name).filter(Boolean).join(', ');

// Nur Admins: Info auf einzelne Personen beschränken (z. B. Telefonnummern, Zugangscodes).
function visibilityHtml(i = {}) {
  if (!isAdmin()) return '';
  const viewers = i.viewers || [];
  const people = state.people.filter((p) => p.role !== 'none' && p.role !== 'admin');
  return `<fieldset class="visibility">
      <legend>Sichtbar für</legend>
      <label class="radio"><input type="radio" name="restricted" value="" ${i.restricted ? '' : 'checked'}> Alle</label>
      <label class="radio"><input type="radio" name="restricted" value="1" ${i.restricted ? 'checked' : ''}> 🔒 Nur ausgewählte Personen</label>
      <div class="pick" id="vis-people" ${i.restricted ? '' : 'hidden'}>${people.map((p) => `<label class="chip ${viewers.includes(p.id) ? 'on' : 'off'}" style="--c:${p.color}">
        <input type="checkbox" name="viewers" value="${p.id}" ${viewers.includes(p.id) ? 'checked' : ''}><span class="dot"></span>${esc(p.name)}</label>`).join('')}</div>
      <p class="small muted" id="vis-hint" ${i.restricted ? '' : 'hidden'}>Admins sehen vertrauliche Infos immer. Ändern können sie nur Admins.</p>
    </fieldset>`;
}
function bindVisibility(form) {
  const box = $('#vis-people', form);
  if (!box) return;
  form.addEventListener('change', (e) => {
    if (e.target.name === 'restricted') {
      const on = !!form.querySelector('[name=restricted]:checked')?.value;
      box.hidden = !on; $('#vis-hint', form).hidden = !on;
    }
    if (e.target.name === 'viewers') e.target.closest('.chip').className = `chip ${e.target.checked ? 'on' : 'off'}`;
  });
}
// Formular → Daten für die API (Sichtbarkeit nur, wenn ein Admin sie sehen konnte).
function formBody(form) {
  const fd = new FormData(form);
  const body = { category: fd.get('category'), title: fd.get('title'), body: fd.get('body') };
  if (form.querySelector('[name=restricted]')) {
    body.restricted = !!fd.get('restricted');
    body.viewers = fd.getAll('viewers').map(Number);
  }
  return body;
}

function infoHtml(i) {
  return `<article class="info ${i.category.toLowerCase()} ${i.restricted ? 'restricted' : ''}" data-id="${i.id}">
    <h3>${canWrite() ? '<span class="handle" title="Zum Sortieren ziehen">⠿</span>' : ''}<span>${ICONS[i.category] || 'ℹ️'}</span><span class="grow">${esc(i.title)}</span>
      ${i.restricted ? '<span class="lock" title="Vertraulich">🔒</span>' : ''}
      ${mayEdit(i) ? `<button class="link" data-edit="${i.id}">Bearbeiten</button>` : ''}</h3>
    ${i.body ? `<div class="body">${linkify(i.body)}</div>` : ''}
    ${i.attachments.length ? attachmentsHtml(i.attachments, false) : ''}
    ${i.restricted ? `<div class="foot restricted-for">🔒 Nur sichtbar für ${esc(names(i.viewers) || 'Admins')}${i.viewers.length ? ' und Admins' : ''}</div>` : ''}
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
      <p class="small muted" style="margin:.2rem 0 0">${ANSAGE_HINT()}</p>
      <label for="in-title">Titel</label><input id="in-title" name="title" maxlength="200" required>
      <label for="in-body">Text</label><textarea id="in-body" name="body" rows="6" maxlength="20000"></textarea>
      ${visibilityHtml()}
      <p class="small muted">PDFs und Fotos kannst du gleich nach dem Speichern anhängen.</p>
      <div class="buttons"><button type="button" data-close>Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
    </form>`, (dlg) => {
    bindVisibility($('#info-new-form', dlg));
    $('#info-new-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const i = await api('/infos', { method: 'POST', body: formBody(e.target) });
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
      <p class="small muted" style="margin:.2rem 0 0">${ANSAGE_HINT()}</p>
      <label for="info-title">Titel</label><input id="info-title" name="title" value="${esc(i.title)}" maxlength="200" required>
      <label for="info-body">Text</label><textarea id="info-body" name="body" rows="8" maxlength="20000">${esc(i.body)}</textarea>
      ${visibilityHtml(i)}
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
  bindVisibility($('#info-form', root));
  $('#info-form', root).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/infos/${i.id}`, { method: 'PATCH', body: formBody(e.target) });
      $('#modal').close();
      toast('Gespeichert');
      refreshInfos();
    } catch (err) { showError(err); }
  };
  $('#info-del', root).onclick = async () => {
    try { await deleteWithUndo(`/infos/${i.id}`, refreshInfos, () => { $('#modal').close(); refreshInfos(); }); } catch (err) { showError(err); }
  };
  bindAttachments($('#info-atts', root), 'infos', i.id, async () => {
    // Text nicht verlieren, wenn während des Bearbeitens eine Datei angehängt wird.
    const form = $('#info-form');
    const draft = form && formBody(form);
    await refreshInfos();
    const f = $('#info-form');
    if (draft && f) {
      f.category.value = draft.category; f.title.value = draft.title; f.body.value = draft.body;
      if (draft.restricted !== undefined) {
        f.querySelector(`[name=restricted][value="${draft.restricted ? 1 : ''}"]`).checked = true;
        $$('[name=viewers]', f).forEach((c) => { c.checked = draft.viewers.includes(Number(c.value)); c.closest('.chip').className = `chip ${c.checked ? 'on' : 'off'}`; });
        $('#vis-people', f).hidden = !draft.restricted; $('#vis-hint', f).hidden = !draft.restricted;
      }
    }
  });
}
