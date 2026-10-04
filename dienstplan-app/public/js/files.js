// Anhänge (Fotos, PDFs …) an To-Dos, Infos und Bestellwünschen.
import { api, esc, showError, fmtSize } from './core.js';

const icon = (mime) => (mime?.startsWith('image/') ? '🖼️' : mime === 'application/pdf' ? '📄' : '📎');

export function attachmentsHtml(list, editable) {
  const items = list.map((a) => `<span class="att">
      <a href="/api/files/${a.id}" target="_blank" rel="noopener">${a.mime?.startsWith('image/') ? `<img src="/api/files/${a.id}" alt="" loading="lazy">` : icon(a.mime)} <span>${esc(a.name)}</span></a>
      <span class="muted small">${fmtSize(a.size)}</span>
      ${editable ? `<button type="button" class="link" data-att-del="${a.id}" title="Anhang entfernen">✕</button>` : ''}
    </span>`).join('');
  const add = editable ? '<label class="btn att-add">📎 Foto oder Datei<input type="file" data-att-add hidden></label>' : '';
  return `<div class="atts">${items}${add}</div>`;
}

// table: "todos" | "infos" | "orders"
export function bindAttachments(root, table, itemId, onChange) {
  root.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-att-add]') || !e.target.files[0]) return;
    const form = new FormData();
    form.append('file', e.target.files[0]);
    e.target.closest('label').classList.add('busy');
    try { await api(`/${table}/${itemId}/attachments`, { method: 'POST', form }); onChange(); } catch (err) { showError(err); }
  });
  root.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-att-del]')?.dataset.attDel;
    if (!id) return;
    try { await api(`/${table}/${itemId}/attachments/${id}`, { method: 'DELETE' }); onChange(); } catch (err) { showError(err); }
  });
}

export const initials = (name) => String(name || '?').trim().slice(0, 2);
export const avatar = (p) => (p ? `<span class="avatar" style="--c:${p.color}" title="${esc(p.name)}">${esc(initials(p.name))}</span>` : '');
