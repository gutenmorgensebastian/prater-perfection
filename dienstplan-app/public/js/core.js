// Gemeinsame Helfer für alle Ansichten.
export const state = { me: null, people: [], channels: [], vapidPublicKey: null, claude: false, baseUrl: '' };

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Text sicher darstellen und Links klickbar machen.
export function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

export function showError(err) {
  console.error(err);
  toast(`⚠️ ${err.message || err}`);
}

// Öffnet einen Dialog; html enthält das Formular. Gibt das <dialog>-Element zurück.
export function openModal(html, onReady) {
  const dlg = $('#modal');
  dlg.innerHTML = html;
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  if (!dlg.open) dlg.showModal();
  onReady?.(dlg);
  return dlg;
}

export const personById = (id) => state.people.find((p) => p.id === id);
export const canWrite = () => state.me?.role !== 'viewer';
export const isAdmin = () => state.me?.role === 'admin';

export function setTitle(text, actionsHtml = '') {
  $('#page-title').textContent = text;
  document.title = `${text} · Pratomat`;
  $('#topbar-actions').innerHTML = actionsHtml;
}

const dtf = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso) => dtf.format(new Date(iso));
export const fmtDate = (iso) => iso.slice(0, 10).split('-').reverse().join('.');
export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('In die Zwischenablage kopiert');
  } catch {
    prompt('Zum Kopieren:', text);
  }
}

// Lokale Einstellungen (nur auf diesem Gerät).
export function loadPref(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus */ }
}

// Kleiner Knopf zum Rückgängigmachen (Pfeil dreht sich gegen den Uhrzeigersinn, Ring zeigt die Restzeit).
let undoTimer = null;
export function showUndo(onUndo, ms = 10000) {
  document.querySelector('.undo-btn')?.remove();
  clearTimeout(undoTimer);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'undo-btn';
  btn.title = 'Löschen rückgängig machen';
  btn.setAttribute('aria-label', 'Löschen rückgängig machen');
  btn.style.setProperty('--undo-ms', `${ms}ms`);
  btn.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">
      <circle class="undo-ring" cx="24" cy="24" r="21"/>
      <g class="undo-arrow"><g transform="translate(12 12)"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></g></g>
    </svg>`;
  const close = () => { clearTimeout(undoTimer); btn.remove(); };
  btn.onclick = async () => {
    close();
    try { await onUndo(); } catch (err) { showError(err); }
  };
  document.body.append(btn);
  undoTimer = setTimeout(close, ms);
}

// Löscht ohne Rückfrage und bietet danach 10 Sekunden lang „Rückgängig“ an.
// afterDelete: was direkt nach dem Löschen passieren soll (Standard: refresh).
export async function deleteWithUndo(path, refresh, afterDelete = refresh) {
  const res = await api(path, { method: 'DELETE' });
  await afterDelete?.();
  if (!res.undo) return;
  showUndo(async () => {
    await api(`/undo/${res.undo}`, { method: 'POST' });
    await refresh?.();
    toast('Wiederhergestellt');
  });
}
