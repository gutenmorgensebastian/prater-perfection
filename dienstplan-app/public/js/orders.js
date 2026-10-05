import { state, api, esc, linkify, $, setTitle, showError, toast, canWrite, isAdmin, openModal, fmtDateTime, loadPref, savePref, deleteWithUndo } from './core.js';
import { attachmentsHtml, bindAttachments, avatar } from './files.js';

let mounted = false;
let orders = [];

export async function refreshOrders() {
  if (!mounted) return;
  try {
    orders = await api('/orders');
    renderList();
    const dlg = $('#modal');
    if (dlg.open && dlg.dataset.order) renderEdit(Number(dlg.dataset.order));
  } catch (err) { showError(err); }
}

export function renderOrders(view) {
  mounted = true;
  setTitle('Bestellwünsche');
  view.innerHTML = `
    ${canWrite() ? `<form class="order-add" id="order-add">
      <input name="title" placeholder="Was wird gebraucht?" maxlength="200" required autocomplete="off">
      <input name="quantity" placeholder="Menge" maxlength="60" autocomplete="off">
      <button class="primary" type="submit">＋</button>
    </form>` : ''}
    <div class="toolbar"><span class="chip ${loadPref('orders-mine', false) ? 'on' : 'off'}" id="order-mine" style="--c:var(--accent)">Nur meine</span></div>
    <div id="order-list"></div>`;
  $('#order-add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/orders', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      e.target.title.focus();
      refreshOrders();
    } catch (err) { showError(err); }
  });
  $('#order-mine').onclick = () => {
    savePref('orders-mine', !loadPref('orders-mine', false));
    $('#order-mine').className = `chip ${loadPref('orders-mine', false) ? 'on' : 'off'}`;
    renderList();
  };
  $('#order-list').onclick = onAction;
  refreshOrders();
  return () => { mounted = false; };
}

const STATUS = { open: ['offen', 'open'], claimed: ['in Arbeit', 'work'], ordered: ['bestellt', 'work'], done: ['erledigt', 'done'] };

function orderHtml(o) {
  const me = state.me.id;
  const mine = o.claimed_by === me || isAdmin();
  const w = canWrite();
  let buttons = '';
  if (w && o.status === 'open') buttons = '<button class="primary" data-act="claim">🙋 Ich kümmere mich</button>';
  else if (w && (o.status === 'claimed' || o.status === 'ordered') && mine) {
    buttons = `${o.status === 'claimed' ? '<button data-act="ordered">📦 Bestellt</button>' : ''}
      <button class="primary" data-act="done">✓ Erledigt / ist da</button>
      <button data-act="release">Abgeben</button>`;
  } else if (w && o.status === 'done') buttons = '<button data-act="reopen">Wieder öffnen</button>';
  const [label, cls] = STATUS[o.status];
  return `<article class="order ${o.status === 'done' ? 'done' : ''}" data-id="${o.id}">
    <div class="top" data-edit="${o.id}"><span class="what">${esc(o.title)}</span>${o.quantity ? `<span class="qty">${esc(o.quantity)}</span>` : ''}<span class="pill ${cls}">${label}</span></div>
    ${o.notes ? `<div class="notes">${linkify(o.notes)}</div>` : ''}
    ${o.attachments.length ? attachmentsHtml(o.attachments, false) : ''}
    <div class="who">
      ${o.claimed_by ? `${avatar({ name: o.claimed_name, color: o.claimed_color })}<span><b>${esc(o.claimed_name)}</b> ${o.status === 'done' ? 'hat es erledigt' : o.status === 'ordered' ? 'hat bestellt' : 'kümmert sich'}</span> ·` : ''}
      <span>eingetragen von ${esc(o.created_name || '–')}, ${fmtDateTime(o.created_at)}</span>
    </div>
    ${buttons ? `<div class="actions">${buttons}</div>` : ''}
  </article>`;
}

function renderList() {
  const list = $('#order-list');
  if (!list) return;
  const onlyMine = loadPref('orders-mine', false);
  const shown = orders.filter((o) => !onlyMine || o.claimed_by === state.me.id || o.created_by === state.me.id);
  const open = shown.filter((o) => o.status === 'open');
  const work = shown.filter((o) => o.status === 'claimed' || o.status === 'ordered');
  const done = shown.filter((o) => o.status === 'done');
  const section = (title, items, emptyText) => `<section class="group"><h2>${title} (${items.length})</h2>${items.length ? items.map(orderHtml).join('') : `<p class="empty">${emptyText}</p>`}</section>`;
  list.innerHTML = section('Noch offen – wer kümmert sich?', open, 'Nichts offen.')
    + section('In Arbeit', work, 'Gerade kümmert sich niemand um etwas.')
    + (done.length ? `<details class="done-section"><summary>Erledigt (${done.length})</summary>${done.slice(0, 50).map(orderHtml).join('')}</details>` : '');
}

async function onAction(e) {
  const card = e.target.closest('.order');
  if (!card) return;
  const id = Number(card.dataset.id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) {
    try {
      await api(`/orders/${id}`, { method: 'PATCH', body: { action: act } });
      if (act === 'claim') toast('Danke! Du kümmerst dich darum.');
      refreshOrders();
    } catch (err) { showError(err); refreshOrders(); }
    return;
  }
  if (e.target.closest('[data-edit]') && !e.target.closest('a')) openEdit(id);
}

function openEdit(id) {
  const dlg = openModal('<div id="order-edit"></div>');
  dlg.dataset.order = id;
  dlg.addEventListener('close', () => { delete dlg.dataset.order; }, { once: true });
  renderEdit(id);
}

function renderEdit(id) {
  const o = orders.find((x) => x.id === id);
  const root = $('#order-edit');
  if (!o || !root) { $('#modal').close(); return; }
  const w = canWrite() && (o.created_by === state.me.id || o.claimed_by === state.me.id || isAdmin());
  root.innerHTML = `
    <h2>Bestellwunsch</h2>
    <form id="order-form">
      <label for="o-title">Was?</label><input id="o-title" name="title" value="${esc(o.title)}" maxlength="200" required ${w ? '' : 'disabled'}>
      <label for="o-qty">Menge</label><input id="o-qty" name="quantity" value="${esc(o.quantity)}" maxlength="60" ${w ? '' : 'disabled'}>
      <label for="o-notes">Notiz, Link zum Shop, Artikelnummer …</label><textarea id="o-notes" name="notes" rows="4" maxlength="2000" ${w ? '' : 'disabled'}>${esc(o.notes)}</textarea>
      <label>Fotos &amp; Dateien</label>
      <div id="o-atts">${attachmentsHtml(o.attachments, canWrite())}</div>
      <div class="buttons">
        ${canWrite() && (o.created_by === state.me.id || isAdmin()) ? '<button type="button" class="danger" id="o-del">Löschen</button>' : ''}
        <button type="button" data-close>Schließen</button>
        ${w ? '<button class="primary" type="submit">Speichern</button>' : ''}
      </div>
    </form>`;
  $('[data-close]', root).onclick = () => $('#modal').close();
  $('#order-form', root).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/orders/${o.id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
      $('#modal').close();
      refreshOrders();
    } catch (err) { showError(err); }
  };
  $('#o-del', root)?.addEventListener('click', async () => {
    try { await deleteWithUndo(`/orders/${o.id}`, refreshOrders, () => { $('#modal').close(); refreshOrders(); }); } catch (err) { showError(err); }
  });
  if (canWrite()) bindAttachments($('#o-atts', root), 'orders', o.id, refreshOrders);
}
