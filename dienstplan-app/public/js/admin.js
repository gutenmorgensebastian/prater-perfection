import { state, api, esc, $, setTitle, showError, toast, copyText, fmtDate, openModal } from './core.js';
import { parsePersonCell, venueEntries, addDays } from '/shared/roster.js';

export function renderAdmin(view) {
  setTitle('Verwaltung');
  view.innerHTML = `
    <div class="card" id="roster-card">
      <h2>📥 Dienstplan einlesen</h2>
      <p class="small muted">PDF hochladen → Vorschau prüfen → veröffentlichen. Danach stehen alle Dienste automatisch im Kalender.
        Kommt eine geänderte Fassung derselben Woche, einfach neu hochladen – die alte wird ersetzt.</p>
      <form id="roster-upload" class="row">
        <input type="file" name="file" accept="application/pdf,.pdf" required>
        <select name="method" class="shrink" style="width:auto">
          <option value="auto">Erkennung: automatisch</option>
          <option value="claude" ${state.claude ? '' : 'disabled'}>KI (Claude)${state.claude ? '' : ' – kein API-Schlüssel'}</option>
          <option value="text">Textebene des PDFs</option>
          <option value="manual">Selbst eintragen</option>
        </select>
        <button class="primary shrink" type="submit">Hochladen</button>
      </form>
      <div id="roster-editor"></div>
    </div>
    <div class="card">
      <h2>🎭 Spielplan einlesen (Prater-Veranstaltungen)</h2>
      <p class="small muted">Monats-Spielplan der Volksbühne als PDF hochladen. Übernommen werden nur Einträge mit „PRATER“ bzw. „PRATER-FOYER“
        (inkl. TE, EP, Bauproben). Ein aktualisierter Spielplan desselben Monats ersetzt den alten.</p>
      <form id="spielplan-upload" class="row">
        <input type="file" name="file" accept="application/pdf,.pdf" required>
        <button class="primary shrink" type="submit">Hochladen</button>
      </form>
      <div id="spielplan-editor"></div>
    </div>
    <div class="card">
      <h2>🗂️ Bisherige Dienst- &amp; Spielpläne</h2>
      <ul class="list" id="roster-list"><li class="muted small">Lädt …</li></ul>
    </div>
    <div class="card">
      <h2>👥 Personen &amp; Einladungen</h2>
      <p class="small muted">Jede Person bekommt einen eigenen Link – antippen, fertig, kein Passwort. Danach die Seite als Kachel aufs Handy legen, dann bleibt man angemeldet.
        <b>Admin</b> = alles inkl. Verwaltung · <b>Mitarbeiter*in</b> = alles lesen und schreiben · <b>Gast</b> = nur lesen ·
        <b>Ohne Zugang</b> = steht nur im Dienstplan. „Dienstplan-Name“ = wie der Name im PDF steht.</p>
      <div style="overflow-x:auto"><table class="people-table" id="people"></table></div>
      <form id="person-add" class="row" style="margin-top:.6rem">
        <input name="name" placeholder="Name" required>
        <input name="roster_name" placeholder="Name im Dienstplan (optional)">
        <button class="shrink" type="submit">＋ Person</button>
      </form>
    </div>
    <div class="card">
      <h2>💬 Chat-Gruppen</h2>
      <ul class="list" id="channels"></ul>
      <form id="channel-add" class="row" style="margin-top:.6rem">
        <input name="name" placeholder="Neue Gruppe, z. B. „Licht“" required>
        <button class="shrink" type="submit">＋ Gruppe</button>
      </form>
    </div>`;
  bindRosterUpload();
  bindSpielplanUpload();
  loadRosterList();
  loadPeople();
  renderChannels();
  $('#person-add').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/people', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      loadPeople();
    } catch (err) { showError(err); }
  };
  $('#channel-add').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/channels', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
    } catch (err) { showError(err); }
  };
}

// --- Dienstplan ----------------------------------------------------------------
function bindRosterUpload() {
  $('#roster-upload').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Wird gelesen …';
    try {
      const res = await api('/admin/rosters', { method: 'POST', form: new FormData(e.target) });
      e.target.reset();
      openEditor(res);
      loadRosterList();
    } catch (err) { showError(err); } finally { btn.disabled = false; btn.textContent = 'Hochladen'; }
  };
}

async function loadRosterList() {
  try {
    const rosters = await api('/admin/rosters');
    const status = { draft: '✏️ Entwurf', published: '✅ veröffentlicht', replaced: '↩️ ersetzt' };
    $('#roster-list').innerHTML = rosters.length ? rosters.map((r) => `<li>
      <div class="grow">${r.method === 'spielplan' ? '🎭' : '📥'} ${esc(r.title || 'Dienstplan')} <span class="muted small">· ${r.method === 'spielplan' ? `Monat ${r.week_start.slice(5, 7)}/${r.week_start.slice(0, 4)}` : `Woche ab ${r.week_start ? fmtDate(r.week_start) : '?'}`} · ${status[r.status]}</span></div>
      ${r.attachment_id ? `<a class="btn shrink" href="/api/files/${r.attachment_id}" target="_blank">PDF</a>` : ''}
      <button class="shrink" data-edit="${r.id}">Bearbeiten</button></li>`).join('') : '<li class="muted small">Noch keiner hochgeladen.</li>';
    $('#roster-list').onclick = async (e) => {
      const id = e.target.dataset.edit;
      if (!id) return;
      try {
        const res = await api(`/admin/rosters/${id}`);
        if (res.roster.method === 'spielplan') openSpielplanEditor(res); else openEditor(res);
      } catch (err) { showError(err); }
    };
  } catch (err) { showError(err); }
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function cellHint(kind, text, row) {
  if (kind === 'area') {
    if (!text.trim()) return '';
    const evs = venueEntries(text, row?.import ? row.label : null);
    if (!evs.length) return '<div class="hint muted">nicht im Prater – wird nicht übernommen</div>';
    return evs.map((v) => `<div class="hint ok">${v.location}, ${v.start ? `${v.start}${v.end ? `–${v.end}` : ''}` : 'ganztägig'}: ${esc(v.title)}</div>`).join('');
  }
  const p = parsePersonCell(text);
  if (p.type === 'empty') return '';
  if (p.type === 'shift') return `<div class="hint ok">✓ Dienst ${p.start}${p.end ? `–${p.end}` : ''}${p.note ? ` (${esc(p.note)})` : ''}</div>`;
  if (p.type === 'off') return `<div class="hint ok">Frei${p.code.toUpperCase() !== 'F' ? ` (${esc(p.code)})` : ''}</div>`;
  return `<div class="hint warn">⚠ ganztägig: „${esc(p.text)}“</div>`;
}

function openEditor({ roster, assignments, warnings }) {
  const grid = structuredClone(roster.grid);
  const assign = [...assignments];
  const root = $('#roster-editor');
  const lastChannel = state.channels.find((c) => /dienstplan/i.test(c.name)) || state.channels[0];
  const methodText = { claude: 'per KI erkannt', text: 'aus der Textebene des PDFs erkannt', manual: 'zum Selbst-Eintragen' }[roster.method];

  const personOptions = (sel) => [
    `<option value="new" ${sel === 'new' ? 'selected' : ''}>➕ neu anlegen</option>`,
    `<option value="" ${sel === null || sel === '' ? 'selected' : ''}>✕ ignorieren</option>`,
    ...state.people.map((p) => `<option value="${p.id}" ${Number(sel) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`),
  ].join('');

  const render = () => {
    root.innerHTML = `
      <h3>Vorschau (${methodText}) – bitte prüfen</h3>
      ${warnings?.length ? `<div class="warnings">${warnings.map(esc).join('<br>')}</div>` : ''}
      <p class="small muted">Zellen kannst du direkt korrigieren. Grün = so landet es im Kalender. Von den Bereichszeilen kommen nur
        Prater-Veranstaltungen in den Kalender (Zeile „Prater“ oder Einträge mit „PRATER“) – per Häkchen kannst du eine Zeile als Prater markieren.
        ${roster.attachment_id ? `<a href="/api/files/${roster.attachment_id}" target="_blank">Original-PDF öffnen</a>` : ''}</p>
      <div class="row">
        <div><label>Titel</label><input id="g-title" value="${esc(grid.title)}"></div>
        <div class="shrink"><label>Montag der Woche</label><input type="date" id="g-monday" value="${grid.dates[0]}"></div>
      </div>
      <div class="grid-wrap" style="margin-top:.6rem"><table class="grid">
        <thead><tr><th style="width:170px">Zeile</th>${grid.dates.map((d, i) => `<th>${WEEKDAYS[i]} ${fmtDate(d).slice(0, 6)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${grid.rows.map((row, r) => `
          <tr class="${row.kind}" data-r="${r}">
            <td>
              <input data-f="label" value="${esc(row.label)}">
              <select data-f="kind"><option value="area" ${row.kind === 'area' ? 'selected' : ''}>Bereich / Veranstaltung</option><option value="person" ${row.kind === 'person' ? 'selected' : ''}>Person</option></select>
              ${row.kind === 'person' ? `<select data-f="assign" title="Wem gehört diese Zeile?">${personOptions(assign[r])}</select>`
    : `<label class="check small" style="margin:.2rem 0 0"><input type="checkbox" data-f="import" ${row.import ? 'checked' : ''}> ganze Zeile ist Prater</label>`}
            </td>
            ${row.cells.map((c, i) => `<td><textarea data-c="${i}" rows="${row.kind === 'area' ? 3 : 1}">${esc(c)}</textarea><div data-h="${i}">${cellHint(row.kind, c, row)}</div></td>`).join('')}
            <td><button class="link" data-del title="Zeile entfernen">✕</button></td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="row" style="margin-top:.6rem">
        <button class="shrink" id="g-add-person">＋ Person-Zeile</button>
        <button class="shrink" id="g-add-area">＋ Bereich-Zeile</button>
      </div>
      <div class="row" style="margin-top:.8rem">
        <label class="check shrink" style="margin:0"><input type="checkbox" id="g-announce" checked> Im Chat ankündigen in</label>
        <select id="g-channel" class="shrink" style="width:auto">${state.channels.map((c) => `<option value="${c.id}" ${c.id === lastChannel?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="row" style="margin-top:.8rem">
        <button class="primary shrink" id="g-publish">✅ Veröffentlichen</button>
        <button class="shrink" id="g-cancel">Schließen</button>
      </div>`;
  };
  render();

  root.oninput = (e) => {
    const tr = e.target.closest('tr[data-r]');
    if (e.target.id === 'g-title') grid.title = e.target.value;
    if (!tr) return;
    const r = Number(tr.dataset.r);
    if (e.target.dataset.f === 'label') grid.rows[r].label = e.target.value;
    if (e.target.dataset.c !== undefined) {
      const i = Number(e.target.dataset.c);
      grid.rows[r].cells[i] = e.target.value;
      tr.querySelector(`[data-h="${i}"]`).innerHTML = cellHint(grid.rows[r].kind, e.target.value, grid.rows[r]);
    }
  };
  root.onchange = (e) => {
    if (e.target.id === 'g-monday' && e.target.value) {
      grid.dates = Array.from({ length: 7 }, (_, i) => addDays(e.target.value, i));
      return render();
    }
    const tr = e.target.closest('tr[data-r]');
    if (!tr) return;
    const r = Number(tr.dataset.r);
    if (e.target.dataset.f === 'kind') {
      grid.rows[r].kind = e.target.value;
      if (e.target.value === 'person' && assign[r] == null) assign[r] = 'new';
      render();
    }
    if (e.target.dataset.f === 'import') { grid.rows[r].import = e.target.checked; return render(); }
    if (e.target.dataset.f === 'assign') assign[r] = e.target.value === '' ? null : e.target.value;
  };
  root.onclick = async (e) => {
    const t = e.target;
    if (t.matches('[data-del]')) {
      const r = Number(t.closest('tr').dataset.r);
      grid.rows.splice(r, 1);
      assign.splice(r, 1);
      return render();
    }
    if (t.id === 'g-add-person' || t.id === 'g-add-area') {
      const kind = t.id === 'g-add-person' ? 'person' : 'area';
      grid.rows.push({ label: kind === 'person' ? 'Name' : 'Prater', kind, import: kind === 'area', cells: Array(7).fill('') });
      assign.push(kind === 'person' ? 'new' : null);
      return render();
    }
    if (t.id === 'g-cancel') { root.innerHTML = ''; return; }
    if (t.id === 'g-publish') {
      const unassigned = grid.rows.filter((row, r) => row.kind === 'person' && !assign[r]);
      if (unassigned.length && !confirm(`${unassigned.length} Personenzeile(n) werden ignoriert. Trotzdem veröffentlichen?`)) return;
      t.disabled = true;
      try {
        const res = await api(`/admin/rosters/${roster.id}/publish`, {
          method: 'POST',
          body: { grid, assignments: assign, announce_channel_id: $('#g-announce').checked ? Number($('#g-channel').value) : null },
        });
        toast(`${res.replaced ? 'Aktualisiert' : 'Veröffentlicht'}: ${res.events} Kalendereinträge`);
        root.innerHTML = '';
        loadRosterList();
      } catch (err) { showError(err); t.disabled = false; }
    }
  };
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Spielplan ------------------------------------------------------------------
function bindSpielplanUpload() {
  $('#spielplan-upload').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Wird gelesen …';
    try {
      const res = await api('/admin/spielplan', { method: 'POST', form: new FormData(e.target) });
      e.target.reset();
      openSpielplanEditor(res);
      loadRosterList();
    } catch (err) { showError(err); } finally { btn.disabled = false; btn.textContent = 'Hochladen'; }
  };
}

function openSpielplanEditor({ roster, warnings }) {
  const plan = structuredClone(roster.grid);
  plan.events.forEach((ev) => { if (ev.include === undefined) ev.include = true; });
  const root = $('#spielplan-editor');
  const channel = state.channels.find((c) => /dienstplan/i.test(c.name)) || state.channels[0];
  const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const render = () => {
    const count = plan.events.filter((ev) => ev.include).length;
    root.innerHTML = `
      <h3>Vorschau: ${esc(plan.title)} – ${count} von ${plan.events.length} Prater-Veranstaltungen ausgewählt</h3>
      ${warnings?.length ? `<div class="warnings">${warnings.map(esc).join('<br>')}</div>` : ''}
      <p class="small muted">Häkchen weg = wird nicht übernommen. Felder kannst du direkt korrigieren.
        ${roster.attachment_id ? `<a href="/api/files/${roster.attachment_id}" target="_blank">Original-PDF öffnen</a>` : ''}</p>
      <div class="grid-wrap"><table class="grid sp-grid">
        <thead><tr><th></th><th>Datum</th><th>Beginn</th><th>Ende</th><th>Ort</th><th>Titel</th><th>Details</th></tr></thead>
        <tbody>${plan.events.map((ev, i) => `<tr data-i="${i}" style="${ev.include ? '' : 'opacity:.45'}">
          <td><input type="checkbox" data-f="include" ${ev.include ? 'checked' : ''} aria-label="Übernehmen"></td>
          <td style="white-space:nowrap">${day(ev.date)}</td>
          <td><input type="time" data-f="start" value="${ev.start || ''}"></td>
          <td><input type="time" data-f="end" value="${ev.end || ''}"></td>
          <td><input data-f="location" value="${esc(ev.location)}" style="min-width:7rem"></td>
          <td><textarea data-f="title" rows="2" style="min-width:12rem">${esc(ev.title)}</textarea></td>
          <td><textarea data-f="notes" rows="2" style="min-width:12rem">${esc(ev.notes || '')}</textarea></td>
        </tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:.8rem">
        <label class="check shrink" style="margin:0"><input type="checkbox" id="sp-announce" checked> Im Chat ankündigen in</label>
        <select id="sp-channel" class="shrink" style="width:auto">${state.channels.map((c) => `<option value="${c.id}" ${c.id === channel?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="row" style="margin-top:.8rem">
        <button class="primary shrink" id="sp-publish">✅ In den Kalender übernehmen</button>
        <button class="shrink" id="sp-cancel">Schließen</button>
      </div>`;
  };
  render();
  root.oninput = (e) => {
    const tr = e.target.closest('tr[data-i]');
    const f = e.target.dataset.f;
    if (!tr || !f || f === 'include') return;
    plan.events[Number(tr.dataset.i)][f] = e.target.value || (f === 'start' || f === 'end' ? null : '');
  };
  root.onchange = (e) => {
    if (e.target.dataset.f !== 'include') return;
    plan.events[Number(e.target.closest('tr').dataset.i)].include = e.target.checked;
    render();
  };
  root.onclick = async (e) => {
    if (e.target.id === 'sp-cancel') { root.innerHTML = ''; return; }
    if (e.target.id !== 'sp-publish') return;
    e.target.disabled = true;
    try {
      const res = await api(`/admin/spielplan/${roster.id}/publish`, {
        method: 'POST', body: { plan, announce_channel_id: $('#sp-announce').checked ? Number($('#sp-channel').value) : null },
      });
      toast(`${res.replaced ? 'Aktualisiert' : 'Übernommen'}: ${res.events} Prater-Veranstaltungen`);
      root.innerHTML = '';
      loadRosterList();
    } catch (err) { showError(err); e.target.disabled = false; }
  };
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Personen --------------------------------------------------------------------
const ROLE_LABELS = { admin: 'Admin', member: 'Mitarbeiter*in', viewer: 'Gast', none: 'Ohne Zugang' };

async function loadPeople() {
  try {
    const people = await api('/admin/people');
    $('#people').innerHTML = `<tr class="muted small"><td>Farbe</td><td>Name</td><td>Dienstplan-Name</td><td>Rolle</td><td>Einladung</td><td></td></tr>` + people.map((p) => `
      <tr data-id="${p.id}">
        <td><input type="color" data-f="color" value="${p.color}"></td>
        <td><input data-f="name" value="${esc(p.name)}"></td>
        <td><input data-f="roster_name" value="${esc(p.roster_name || '')}"></td>
        <td><select data-f="role" ${p.id === state.me.id ? 'disabled' : ''}>${Object.entries(ROLE_LABELS).map(([k, v]) => `<option value="${k}" ${k === p.role ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td style="white-space:nowrap">${p.invite_link ? `<button data-act="copy" data-link="${esc(p.invite_link)}" title="Link kopieren">🔗</button>
          <a class="btn" href="https://wa.me/?text=${encodeURIComponent(`Hallo ${p.name}, hier ist dein Zugang zum Dienstplan & Chat (bitte nicht weitergeben): ${p.invite_link}`)}" target="_blank" title="Per WhatsApp schicken">📲</a>
          <button data-act="renew" title="Neuen Link erzeugen (alter wird ungültig)">♻️</button>` : '<span class="muted small">kein Zugang</span>'}</td>
        <td>${p.id === state.me.id ? '' : '<button class="danger" data-act="del" title="Person löschen">🗑</button>'}</td>
      </tr>`).join('');
    const table = $('#people');
    table.onchange = async (e) => {
      const tr = e.target.closest('tr[data-id]');
      const f = e.target.dataset.f;
      if (!tr || !f) return;
      try {
        await api(`/admin/people/${tr.dataset.id}`, { method: 'PATCH', body: { [f]: e.target.value } });
        toast('Gespeichert');
        if (f === 'role') loadPeople();
      } catch (err) { showError(err); }
    };
    table.onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      try {
        if (btn.dataset.act === 'copy') copyText(btn.dataset.link);
        if (btn.dataset.act === 'renew' && confirm('Neuen Link erzeugen? Der alte Link und das alte Kalender-Abo funktionieren dann nicht mehr.')) {
          const p = await api(`/admin/people/${id}/new-link`, { method: 'POST' });
          loadPeople();
          openModal(`<h2>Neuer Link für ${esc(p.name)}</h2><code class="url">${esc(p.invite_link)}</code><div class="buttons"><button data-close>OK</button></div>`);
        }
        if (btn.dataset.act === 'del' && confirm('Person mit allen Diensten löschen?')) {
          await api(`/admin/people/${id}`, { method: 'DELETE' });
          loadPeople();
        }
      } catch (err) { showError(err); }
    };
  } catch (err) { showError(err); }
}

// --- Gruppen ---------------------------------------------------------------------
export function renderChannels() {
  const el = $('#channels');
  if (!el) return;
  el.innerHTML = state.channels.map((c) => `<li data-id="${c.id}"><input class="grow" value="${esc(c.name)}">
    <button class="shrink danger" data-del title="Gruppe mit allen Nachrichten löschen">🗑</button></li>`).join('');
  el.onchange = async (e) => {
    const li = e.target.closest('li');
    try { await api(`/admin/channels/${li.dataset.id}`, { method: 'PATCH', body: { name: e.target.value } }); toast('Gespeichert'); } catch (err) { showError(err); }
  };
  el.onclick = async (e) => {
    if (!e.target.matches('[data-del]')) return;
    if (!confirm('Gruppe mit allen Nachrichten löschen?')) return;
    try { await api(`/admin/channels/${e.target.closest('li').dataset.id}`, { method: 'DELETE' }); } catch (err) { showError(err); }
  };
}

export const reloadPeopleAdmin = () => $('#people') && loadPeople();
