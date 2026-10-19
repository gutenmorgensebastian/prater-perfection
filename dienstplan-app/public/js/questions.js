import { state, api, esc, linkify, $, setTitle, showError, toast, canWrite, openModal, fmtDateTime, deleteWithUndo } from './core.js';
import { avatar } from './files.js';

let mounted = false;
let tab = 'in';
let data = { incoming: [], outgoing: [] };

export async function refreshCounts() {
  try {
    const { questions } = await api('/counts');
    const b = $('#q-badge');
    b.hidden = !questions;
    b.textContent = questions;
  } catch { /* nicht angemeldet */ }
}

export async function refreshQuestions() {
  refreshCounts();
  if (!mounted) return;
  try {
    data = await api('/questions');
    renderList();
  } catch (err) { showError(err); }
}

export function renderQuestions(view, sub) {
  mounted = true;
  tab = sub === 'von-mir' ? 'out' : 'in';
  setTitle('Fragen an …', canWrite() ? '<button id="q-new">＋ Frage stellen</button>' : '');
  view.innerHTML = `
    <div class="subtabs">
      <a href="#/fragen" class="${tab === 'in' ? 'active' : ''}" id="q-tab-in">An mich</a>
      <a href="#/fragen/von-mir" class="${tab === 'out' ? 'active' : ''}" id="q-tab-out">Von mir gestellt</a>
    </div>
    <p class="small muted">Fragen sehen nur du und die Person, an die sie geht.</p>
    <div id="q-list"></div>`;
  $('#q-new')?.addEventListener('click', () => openAsk());
  view.addEventListener('submit', onReply);
  view.addEventListener('click', onAction);
  refreshQuestions();
  return () => {
    mounted = false;
    view.removeEventListener('submit', onReply);
    view.removeEventListener('click', onAction);
  };
}

function questionHtml(q) {
  const incoming = q.to_id === state.me.id;
  const other = incoming ? { name: q.from_name, color: q.from_color } : { name: q.to_name, color: q.to_color };
  const status = q.status === 'done' ? '<span class="pill done">erledigt</span>'
    : q.waiting_for_me ? `<span class="pill wait">${incoming ? 'wartet auf deine Antwort' : 'neue Antwort'}</span>`
      : `<span class="pill open">${incoming ? 'beantwortet' : 'wartet auf Antwort'}</span>`;
  return `<article class="q ${q.waiting_for_me ? 'waiting' : ''}" data-id="${q.id}">
    <div class="head">${avatar(other)}<b>${incoming ? 'Von' : 'An'} ${esc(other.name || '–')}</b><span>${fmtDateTime(q.created_at)}</span>${status}</div>
    <div class="text">${linkify(q.body)}</div>
    ${q.replies.length ? `<div class="replies">${q.replies.map((r) => `<div class="reply"><div class="who">${esc(r.person_name || '–')} · ${fmtDateTime(r.created_at)}</div><div class="body">${linkify(r.body)}</div></div>`).join('')}</div>` : ''}
    ${canWrite() && q.status !== 'done' ? `<form data-reply="${q.id}"><input name="body" placeholder="${incoming ? 'Antworten …' : 'Nachfragen …'}" maxlength="3000" autocomplete="off"><button class="primary" type="submit">Senden</button></form>` : ''}
    ${canWrite() ? `<div class="actions">
      <button data-status="${q.status === 'done' ? 'open' : 'done'}">${q.status === 'done' ? 'Wieder öffnen' : '✓ Erledigt'}</button>
      ${!incoming ? '<button class="danger" data-del>Löschen</button>' : ''}</div>` : ''}
  </article>`;
}

function renderList() {
  const list = $('#q-list');
  if (!list) return;
  const qs = tab === 'in' ? data.incoming : data.outgoing;
  const open = qs.filter((q) => q.status !== 'done');
  const done = qs.filter((q) => q.status === 'done');
  const waitIn = data.incoming.filter((q) => q.waiting_for_me).length;
  const waitOut = data.outgoing.filter((q) => q.waiting_for_me).length;
  $('#q-tab-in').textContent = `An mich${waitIn ? ` (${waitIn})` : ''}`;
  $('#q-tab-out').textContent = `Von mir gestellt${waitOut ? ` (${waitOut} neu)` : ''}`;
  list.innerHTML = (open.length ? open.map(questionHtml).join('')
    : `<p class="empty">${tab === 'in' ? 'Keine offenen Fragen an dich.' : 'Du hast keine offenen Fragen gestellt.'}</p>`)
    + (done.length ? `<details class="done-section"><summary>Erledigt (${done.length})</summary>${done.map(questionHtml).join('')}</details>` : '');
}

async function onReply(e) {
  const id = e.target.dataset.reply;
  if (!id) return;
  e.preventDefault();
  const input = e.target.body;
  if (!input.value.trim()) return;
  try {
    await api(`/questions/${id}/replies`, { method: 'POST', body: { body: input.value } });
    refreshQuestions();
  } catch (err) { showError(err); }
}

async function onAction(e) {
  const card = e.target.closest('.q');
  if (!card) return;
  const id = card.dataset.id;
  try {
    if (e.target.dataset.status) {
      await api(`/questions/${id}`, { method: 'PATCH', body: { status: e.target.dataset.status } });
      refreshQuestions();
    } else if (e.target.hasAttribute('data-del')) {
      await deleteWithUndo(`/questions/${id}`, refreshQuestions);
    }
  } catch (err) { showError(err); }
}

function openAsk(toId) {
  const people = state.people.filter((p) => p.id !== state.me.id && p.role !== 'none');
  openModal(`
    <h2>Frage stellen</h2>
    <form id="ask-form">
      <label for="ask-to">An</label>
      <select id="ask-to" name="to_id" required>
        <option value="">– bitte wählen –</option>
        ${people.map((p) => `<option value="${p.id}" ${p.id === toId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <label for="ask-body">Frage</label>
      <textarea id="ask-body" name="body" rows="4" maxlength="3000" required></textarea>
      <div class="buttons"><button type="button" data-close>Abbrechen</button><button class="primary" type="submit">Frage senden</button></div>
    </form>`, (dlg) => {
    $('#ask-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/questions', { method: 'POST', body: { to_id: Number(e.target.to_id.value), body: e.target.body.value } });
        dlg.close();
        toast('Frage gestellt');
        if (tab !== 'out') location.hash = '#/fragen/von-mir';
        else refreshQuestions();
      } catch (err) { showError(err); }
    };
  });
}
