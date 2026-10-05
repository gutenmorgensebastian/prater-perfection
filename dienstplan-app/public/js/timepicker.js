// Uhrzeit-Auswahl für den ganzen Kalenderbereich: Stunde + Minuten 00/15/30/45,
// dazu „individuell“ für minutengenaue Zeiten. Der Wert steht als "HH:MM" (oder leer) in einem
// versteckten Feld, damit Formulare (FormData) und Listener wie bei <input type="time"> funktionieren.
import { esc } from './core.js';

const QUARTERS = ['00', '15', '30', '45'];
const pad = (n) => String(n).padStart(2, '0');

// name: Feldname fürs Formular; attrs: zusätzliche Attribute fürs versteckte Feld (z. B. data-f="start");
// optional: ob „--“ (keine Uhrzeit) wählbar ist.
export function timePickerHtml({ name = '', value = '', attrs = '', optional = true, label = 'Uhrzeit' } = {}) {
  const [h, m] = /^\d{2}:\d{2}$/.test(value || '') ? value.split(':') : ['', '00'];
  const custom = !QUARTERS.includes(m);
  return `<span class="tp" role="group" aria-label="${esc(label)}">
    <select class="tp-h" aria-label="Stunde">${optional || !h ? '<option value="">--</option>' : ''}${Array.from({ length: 24 }, (_, i) => pad(i))
      .map((x) => `<option ${x === h ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <span class="tp-sep">:</span>
    <select class="tp-m" aria-label="Minuten">${QUARTERS.map((x) => `<option ${!custom && x === m ? 'selected' : ''}>${x}</option>`).join('')}
      <option value="x" ${custom ? 'selected' : ''}>individuell …</option></select>
    <input class="tp-x" type="number" inputmode="numeric" min="0" max="59" step="1" aria-label="Minuten (genau)" value="${custom ? Number(m) : ''}" ${custom ? '' : 'hidden'}>
    <input type="hidden" ${name ? `name="${esc(name)}"` : ''} ${attrs} value="${h ? `${h}:${m}` : ''}">
  </span>`;
}

// Einmal pro Container aufrufen; funktioniert auch für später neu gezeichnete Auswahlfelder darin.
export function bindTimePickers(root) {
  if (root.dataset.tpBound) return;
  root.dataset.tpBound = '1';
  const update = (tp, fromCustom) => {
    const hour = tp.querySelector('.tp-h').value;
    const sel = tp.querySelector('.tp-m');
    const x = tp.querySelector('.tp-x');
    const hidden = tp.querySelector('input[type=hidden]');
    if (sel.value === 'x') {
      if (x.hidden) {
        x.hidden = false;
        if (x.value === '') x.value = Number(hidden.value.slice(3) || 0);
        if (!fromCustom) x.focus();
      }
    } else {
      x.hidden = true;
      x.value = '';
    }
    const raw = sel.value === 'x' ? Math.round(Number(x.value)) : Number(sel.value);
    const minute = Number.isFinite(raw) ? Math.min(59, Math.max(0, raw)) : 0;
    const next = hour ? `${hour}:${pad(minute)}` : '';
    if (next === hidden.value) return;
    hidden.value = next;
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const handler = (e) => {
    const tp = e.target.closest('.tp');
    if (!tp || e.target.type === 'hidden') return;
    e.stopPropagation(); // Nur das versteckte Feld meldet Änderungen nach außen.
    update(tp, e.target.classList.contains('tp-x'));
  };
  root.addEventListener('input', handler, true);
  root.addEventListener('change', handler, true);
  // Beim Verlassen des Minutenfeldes Eingaben wie "7" oder "75" sauber anzeigen.
  root.addEventListener('focusout', (e) => {
    if (!e.target.classList?.contains('tp-x')) return;
    const v = Number(e.target.value);
    e.target.value = Number.isFinite(v) && e.target.value !== '' ? Math.min(59, Math.max(0, Math.round(v))) : 0;
    update(e.target.closest('.tp'), true);
  });
}

// Setzt den Wert von außen (z. B. wenn das Ende dem Beginn folgen soll).
export function setTimePicker(tp, value) {
  const [h, m] = /^\d{2}:\d{2}$/.test(value || '') ? value.split(':') : ['', '00'];
  tp.querySelector('.tp-h').value = h;
  const custom = !QUARTERS.includes(m);
  tp.querySelector('.tp-m').value = custom ? 'x' : m;
  const x = tp.querySelector('.tp-x');
  x.hidden = !custom;
  x.value = custom ? Number(m) : '';
  tp.querySelector('input[type=hidden]').value = h ? `${h}:${m}` : '';
}
