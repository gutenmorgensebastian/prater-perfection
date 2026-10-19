import { state, api, esc, linkify, $, $$, setTitle, showError, toast, canWrite, isAdmin, openModal, personById, loadPref, savePref, deleteWithUndo } from './core.js';
import { attachmentsHtml, bindAttachments, avatar } from './files.js';
import { matchesTodo } from './todo-search.js';

let todos = [];
let mounted = false;
let sortable = null;
const prefs = () => loadPref('todo-view', { mine: false, meFirst: false, q: '' });
const nameOf = (id) => personById(id)?.name || '';
const isMine = (t) => t.assignees.includes(state.me.id);

export async function refreshTodos() {
  if (!mounted) return;
  try {
    todos = await api('/todos');
    renderList();
    const dlg = $('#modal');
    if (dlg.open && dlg.dataset.todo) renderDetail(Number(dlg.dataset.todo));
  } catch (err) { showError(err); }
}

export function renderTodos(view) {
  mounted = true;
  setTitle('To-Dos', canWrite() ? '<button id="todo-new">＋ To-Do</button>' : '');
  const p = prefs();
  view.innerHTML = `
    ${canWrite() ? `<form class="quick-add" id="todo-quick"><input id="todo-quick-title" placeholder="Neues To-Do eingeben …" maxlength="300" autocomplete="off"><button class="primary" type="submit">＋</button></form>` : ''}
    <div class="toolbar">
      <input type="search" id="todo-q" placeholder="Suchen: Wort, Person oder #tag" value="${esc(p.q)}">
      <span class="chip ${p.mine ? 'on' : 'off'}" id="todo-mine" style="--c:var(--accent)">Nur meine</span>
      <span class="chip ${p.meFirst ? 'on' : 'off'}" id="todo-mefirst" style="--c:var(--accent)">Meine zuerst</span>
    </div>
    <div class="chips" id="todo-tags"></div>
    <ul class="todo-list" id="todo-open"></ul>
    <details class="done-section" id="todo-done-wrap"><summary id="todo-done-sum">Erledigt</summary><ul class="todo-list" id="todo-done"></ul></details>`;

  const setPref = (patch) => { savePref('todo-view', { ...prefs(), ...patch }); renderToolbar(); renderList(); };
  const renderToolbar = () => {
    const cur = prefs();
    $('#todo-mine').className = `chip ${cur.mine ? 'on' : 'off'}`;
    $('#todo-mefirst').className = `chip ${cur.meFirst ? 'on' : 'off'}`;
  };
  $('#todo-q').addEventListener('input', (e) => setPref({ q: e.target.value }));
  $('#todo-mine').onclick = () => setPref({ mine: !prefs().mine });
  $('#todo-mefirst').onclick = () => setPref({ meFirst: !prefs().meFirst });
  $('#todo-tags').onclick = (e) => {
    const tag = e.target.closest('[data-tag]')?.dataset.tag;
    if (!tag) return;
    const q = prefs().q.trim() === `#${tag}` ? '' : `#${tag}`;
    $('#todo-q').value = q;
    setPref({ q });
  };
  $('#todo-new')?.addEventListener('click', () => $('#todo-quick-title').focus());
  $('#todo-quick')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#todo-quick-title');
    if (!input.value.trim()) return;
    try {
      const t = await api('/todos', { method: 'POST', body: { title: input.value, assignees: prefs().mine ? [state.me.id] : [] } });
      input.value = '';
      await refreshTodos();
      toast('Angelegt – antippen für Zuständige, Tags, Unteraufgaben & Fotos');
      document.querySelector(`.todo[data-id="${t.id}"]`)?.scrollIntoView({ block: 'nearest' });
    } catch (err) { showError(err); }
  });
  view.addEventListener('click', onListClick);
  view.addEventListener('change', onListChange);
  refreshTodos();
  return () => {
    mounted = false;
    sortable?.destroy();
    sortable = null;
    view.removeEventListener('click', onListClick);
    view.removeEventListener('change', onListChange);
  };
}

function visibleTodos() {
  const p = prefs();
  let list = todos.filter((t) => matchesTodo(t, p.q, nameOf));
  if (p.mine) list = list.filter(isMine);
  if (p.meFirst) list = [...list.filter(isMine), ...list.filter((t) => !isMine(t))];
  return list;
}

function todoHtml(t) {
  const subsDone = t.subtasks.filter((s) => s.done).length;
  return `<li class="todo ${t.done ? 'done' : ''} ${t.flagged ? 'flagged' : ''}" data-id="${t.id}">
    ${canWrite() && !t.done && !prefs().meFirst ? '<span class="handle" title="Zum Sortieren ziehen">⠿</span>' : ''}
    <input type="checkbox" data-done="${t.id}" ${t.done ? 'checked' : ''} ${canWrite() ? '' : 'disabled'} aria-label="Erledigt">
    <div class="main" data-open="${t.id}">
      <div class="title">${t.flagged ? '<span class="flag" title="Wichtig">🚩</span> ' : ''}${esc(t.title)}</div>
      <div class="meta">
        ${t.assignees.length ? `<span class="avatars">${t.assignees.map((id) => avatar(personById(id))).join('')}</span>` : ''}
        ${t.tags.map((g) => `<button type="button" class="tag" data-tag="${esc(g)}">#${esc(g)}</button>`).join('')}
        ${t.subtasks.length ? `<span>☑ ${subsDone}/${t.subtasks.length}</span>` : ''}
        ${t.attachments.length ? `<span>📎 ${t.attachments.length}</span>` : ''}
        ${t.notes ? '<span title="Hat eine Notiz">📝</span>' : ''}
      </div>
      ${!t.done && t.subtasks.length ? `<ul class="subs">${t.subtasks.map((s) => `<li class="${s.done ? 'done' : ''}">
        <input type="checkbox" data-done="${s.id}" ${s.done ? 'checked' : ''} ${canWrite() ? '' : 'disabled'} aria-label="Unteraufgabe erledigt"><span>${esc(s.title)}</span></li>`).join('')}</ul>` : ''}
    </div>
  </li>`;
}

function renderList() {
  if (!mounted || !$('#todo-open')) return;
  const list = visibleTodos();
  const open = list.filter((t) => !t.done);
  const done = list.filter((t) => t.done);
  const p = prefs();
  $('#todo-open').innerHTML = open.length ? open.map(todoHtml).join('')
    : `<li class="empty">${p.q || p.mine ? 'Nichts gefunden.' : 'Keine offenen To-Dos. 🎉'}</li>`;
  $('#todo-done').innerHTML = done.map(todoHtml).join('');
  $('#todo-done-sum').textContent = `Erledigt (${done.length})`;
  $('#todo-done-wrap').hidden = !done.length;
  const tags = [...new Set(todos.flatMap((t) => t.tags))].sort();
  $('#todo-tags').innerHTML = tags.map((g) => `<span class="chip ${p.q.trim() === `#${g}` ? 'on' : ''}" data-tag="${esc(g)}">#${esc(g)}</span>`).join('');

  sortable?.destroy();
  sortable = null;
  if (canWrite() && !p.meFirst && window.Sortable && open.length > 1) {
    sortable = Sortable.create($('#todo-open'), {
      handle: '.handle', animation: 150,
      onEnd: async () => {
        const ids = $$('#todo-open > li[data-id]').map((li) => Number(li.dataset.id));
        try { await api('/todos/reorder', { method: 'POST', body: { ids } }); } catch (err) { showError(err); refreshTodos(); }
      },
    });
  }
}

async function onListChange(e) {
  const id = e.target.dataset.done;
  if (!id) return;
  try {
    await api(`/todos/${id}`, { method: 'PATCH', body: { done: e.target.checked } });
    refreshTodos();
  } catch (err) { showError(err); }
}

function onListClick(e) {
  if (e.target.closest('input, .tag, .handle')) {
    const tag = e.target.closest('.tag')?.dataset.tag;
    if (tag) { $('#todo-q').value = `#${tag}`; savePref('todo-view', { ...prefs(), q: `#${tag}` }); renderList(); }
    return;
  }
  const id = e.target.closest('[data-open]')?.dataset.open;
  if (id) openDetail(Number(id));
}

function openDetail(id) {
  const dlg = openModal('<div id="todo-detail"></div>');
  dlg.dataset.todo = id;
  dlg.addEventListener('close', () => { delete dlg.dataset.todo; }, { once: true });
  renderDetail(id);
}

function renderDetail(id) {
  const t = todos.find((x) => x.id === id);
  const root = $('#todo-detail');
  if (!t || !root) { $('#modal').close(); return; }
  const w = canWrite();
  const mayDelete = w && (t.created_by === state.me.id || isAdmin());
  const allTags = [...new Set(todos.flatMap((x) => x.tags))].sort();
  const people = state.people; // auch Personen ohne App-Zugang können zuständig sein
  root.innerHTML = `
    <div class="row" style="align-items:flex-start">
      <input id="td-title" value="${esc(t.title)}" maxlength="300" ${w ? '' : 'disabled'} style="font-size:1.1rem;font-weight:600">
      <button class="shrink ${t.flagged ? 'danger' : ''}" id="td-flag" ${w ? '' : 'disabled'} title="Rotes Fähnchen für wirklich Wichtiges">${t.flagged ? '🚩 Wichtig' : '🏳️ Fähnchen'}</button>
    </div>
    <label>Zuständig</label>
    <div class="pick" id="td-people">${people.map((p) => `<label class="chip ${t.assignees.includes(p.id) ? 'on' : 'off'}" style="--c:${p.color}">
      <input type="checkbox" value="${p.id}" ${t.assignees.includes(p.id) ? 'checked' : ''} ${w ? '' : 'disabled'}><span class="dot"></span>${esc(p.name)}</label>`).join('')}</div>
    <label for="td-tag">Tags</label>
    <div class="pick" id="td-tags">${t.tags.map((g) => `<span class="chip on">#${esc(g)}${w ? ` <button type="button" class="link" data-untag="${esc(g)}" title="Tag entfernen">✕</button>` : ''}</span>`).join('')}
      ${w ? `<form id="td-tag-form" style="display:flex;gap:.3rem"><input id="td-tag" list="td-tag-list" placeholder="#tag" style="width:9rem"><datalist id="td-tag-list">${allTags.map((g) => `<option value="${esc(g)}">`).join('')}</datalist><button type="submit">＋</button></form>` : ''}</div>
    <label>Unteraufgaben</label>
    <ul class="subs" id="td-subs">${t.subtasks.map((s) => `<li class="${s.done ? 'done' : ''}">
      <input type="checkbox" data-sub-done="${s.id}" ${s.done ? 'checked' : ''} ${w ? '' : 'disabled'}><span style="flex:1">${esc(s.title)}</span>
      ${w ? `<button type="button" class="link" data-sub-del="${s.id}" title="Unteraufgabe löschen">✕</button>` : ''}</li>`).join('')}</ul>
    ${w ? '<form id="td-sub-form" class="row" style="margin-top:.3rem"><input id="td-sub" placeholder="Unteraufgabe hinzufügen …" maxlength="300"><button class="shrink" type="submit">＋</button></form>' : ''}
    <label for="td-notes">Notiz</label>
    ${w ? `<textarea id="td-notes" rows="3" maxlength="5000">${esc(t.notes)}</textarea>` : `<p style="white-space:pre-wrap">${linkify(t.notes) || '–'}</p>`}
    <label>Fotos &amp; Dateien</label>
    <div id="td-atts">${attachmentsHtml(t.attachments, w)}</div>
    <p class="muted small">Angelegt von ${esc(nameOf(t.created_by) || '–')}${t.done ? ` · erledigt von ${esc(nameOf(t.done_by) || '–')}` : ''}</p>
    <div class="buttons">
      ${mayDelete ? '<button class="danger" id="td-del">Löschen</button>' : ''}
      ${w ? `<button id="td-done">${t.done ? 'Wieder öffnen' : '✓ Erledigt'}</button>` : ''}
      <button class="primary" data-close>Fertig</button>
    </div>`;
  $('[data-close]', root).onclick = () => $('#modal').close();
  if (!w) return;

  const patch = async (body) => {
    try { await api(`/todos/${t.id}`, { method: 'PATCH', body }); await refreshTodos(); } catch (err) { showError(err); }
  };
  $('#td-title', root).onchange = (e) => patch({ title: e.target.value });
  $('#td-notes', root).onchange = (e) => patch({ notes: e.target.value });
  $('#td-flag', root).onclick = () => patch({ flagged: !t.flagged });
  $('#td-done', root).onclick = () => patch({ done: !t.done });
  $('#td-people', root).onchange = () => patch({ assignees: $$('#td-people input:checked', root).map((i) => Number(i.value)) });
  $('#td-tag-form', root).onsubmit = (e) => {
    e.preventDefault();
    const tag = $('#td-tag', root).value.trim();
    if (tag) patch({ tags: [...t.tags, ...tag.split(/[\s,]+/)] });
  };
  root.onclick = async (e) => {
    const untag = e.target.closest('[data-untag]')?.dataset.untag;
    if (untag) return patch({ tags: t.tags.filter((g) => g !== untag) });
    const del = e.target.closest('[data-sub-del]')?.dataset.subDel;
    if (del) {
      try { await deleteWithUndo(`/todos/${del}`, refreshTodos); } catch (err) { showError(err); }
    }
  };
  $('#td-subs', root).onchange = async (e) => {
    const sid = e.target.dataset.subDone;
    if (!sid) return;
    try { await api(`/todos/${sid}`, { method: 'PATCH', body: { done: e.target.checked } }); refreshTodos(); } catch (err) { showError(err); }
  };
  $('#td-sub-form', root).onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#td-sub', root).value.trim();
    if (!title) return;
    try { await api('/todos', { method: 'POST', body: { title, parent_id: t.id } }); await refreshTodos(); $('#td-sub')?.focus(); } catch (err) { showError(err); }
  };
  $('#td-del', root)?.addEventListener('click', async () => {
    try { await deleteWithUndo(`/todos/${t.id}`, refreshTodos, () => { $('#modal').close(); refreshTodos(); }); } catch (err) { showError(err); }
  });
  bindAttachments($('#td-atts', root), 'todos', t.id, refreshTodos);
}
