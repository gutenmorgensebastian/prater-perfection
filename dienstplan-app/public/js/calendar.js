import { state, api, esc, $, $$, openModal, personById, canWrite, isAdmin, setTitle, showError, toast, copyText, loadPref, savePref, fmtDate } from './core.js';

let calendar = null;
const VENUE_COLOR = '#64748b';
const CUSTOM_COLOR = '#0ea5e9';

const filters = () => loadPref('calendar-filters', { hidden: [], venue: true, custom: true, off: false });

function visible(e, f) {
  if (e.kind === 'venue') return f.venue;
  if (e.kind === 'custom') return f.custom;
  if (e.kind === 'off' && !f.off) return false;
  return !f.hidden.includes(e.person_id);
}

function toCalendarEvent(e) {
  const p = personById(e.person_id);
  let title = e.title;
  let color = CUSTOM_COLOR;
  if (e.kind === 'venue') { title = `${e.location} · ${e.title}`; color = VENUE_COLOR; }
  if (e.kind === 'shift' || e.kind === 'off') {
    title = e.title === 'Dienst' ? `${p?.name ?? '?'}` : `${p?.name ?? '?'}: ${e.title}`;
    color = p?.color || '#888';
  }
  return {
    id: String(e.id), title, start: e.start, end: e.end || undefined, allDay: Boolean(e.all_day),
    backgroundColor: color, borderColor: color, classNames: [`ev-${e.kind}`], extendedProps: { raw: e },
  };
}

function renderChips(root) {
  const f = filters();
  const chip = (key, label, on, color) => `<span class="chip ${on ? 'on' : 'off'}" data-key="${key}" style="--c:${color}"><span class="dot"></span>${esc(label)}</span>`;
  const people = state.people.filter((p) => p.roster_name || p.role !== 'none');
  root.innerHTML = [
    chip('venue', 'Veranstaltungen', f.venue, VENUE_COLOR),
    chip('custom', 'Termine', f.custom, CUSTOM_COLOR),
    chip('off', 'Frei-Tage', f.off, '#9ca3af'),
    ...people.map((p) => chip(`p${p.id}`, p.name, !f.hidden.includes(p.id), p.color)),
    '<span class="chip" data-key="all">Alle</span>',
    `<span class="chip" data-key="me">Nur ich</span>`,
  ].join('');
  root.onclick = (ev) => {
    const key = ev.target.closest('.chip')?.dataset.key;
    if (!key) return;
    const cur = filters();
    if (key === 'all') cur.hidden = [];
    else if (key === 'me') cur.hidden = state.people.map((p) => p.id).filter((id) => id !== state.me.id);
    else if (key.startsWith('p')) {
      const id = Number(key.slice(1));
      cur.hidden = cur.hidden.includes(id) ? cur.hidden.filter((x) => x !== id) : [...cur.hidden, id];
    } else cur[key] = !cur[key];
    savePref('calendar-filters', cur);
    renderChips(root);
    calendar?.refetchEvents();
  };
}

export function renderCalendar(view) {
  setTitle('Kalender', `<button id="btn-sub" title="Im Handykalender abonnieren">📲 Abo</button>${canWrite() ? ' <button id="btn-new">＋ Termin</button>' : ''}`);
  view.innerHTML = '<div class="chips" id="chips"></div><div id="calendar"></div>';
  renderChips($('#chips'));
  $('#btn-sub').onclick = () => openSubscribe();
  $('#btn-new')?.addEventListener('click', () => openEventForm());

  const narrow = window.matchMedia('(max-width: 700px)').matches;
  calendar = new FullCalendar.Calendar($('#calendar'), {
    locale: 'de',
    initialView: loadPref('calendar-view', narrow ? 'listWeek' : 'timeGridWeek'),
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'listWeek,timeGridWeek,dayGridMonth' },
    buttonText: { today: 'Heute' },
    views: { listWeek: { buttonText: 'Liste' }, timeGridWeek: { buttonText: 'Woche' }, dayGridMonth: { buttonText: 'Monat' } },
    height: 'auto',
    firstDay: 1,
    nowIndicator: true,
    slotMinTime: '06:00:00',
    scrollTime: '08:00:00',
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    noEventsText: 'Keine Einträge – evtl. sind Personen ausgeblendet.',
    dayMaxEvents: 4,
    events: async (info, success, failure) => {
      try {
        const rows = await api(`/events?start=${info.startStr.slice(0, 10)}&end=${info.endStr.slice(0, 10)}`);
        const f = filters();
        success(rows.filter((e) => visible(e, f)).map(toCalendarEvent));
      } catch (err) { failure(err); showError(err); }
    },
    eventClick: (info) => openEventDetails(info.event.extendedProps.raw),
    dateClick: (info) => canWrite() && openEventForm({ date: info.dateStr.slice(0, 10), time: info.allDay ? '' : info.dateStr.slice(11, 16) }),
    datesSet: (info) => savePref('calendar-view', info.view.type),
  });
  calendar.render();
  return () => { calendar?.destroy(); calendar = null; };
}

export const refreshCalendar = () => calendar?.refetchEvents();

function timeRange(e) {
  if (e.all_day) {
    const last = new Date(`${e.end}T12:00:00Z`); last.setUTCDate(last.getUTCDate() - 1);
    const lastIso = last.toISOString().slice(0, 10);
    return lastIso > e.start ? `${fmtDate(e.start)} – ${fmtDate(lastIso)}` : `${fmtDate(e.start)}, ganztägig`;
  }
  const end = e.end ? (e.end.slice(0, 10) === e.start.slice(0, 10) ? e.end.slice(11) : `${fmtDate(e.end)} ${e.end.slice(11)}`) : '';
  return `${fmtDate(e.start)}, ${e.start.slice(11)}${end ? ` – ${end} Uhr` : ' Uhr'}`;
}

function openEventDetails(e) {
  const p = personById(e.person_id);
  const kindLabel = { shift: 'Dienst laut Dienstplan', off: 'Frei laut Dienstplan', venue: 'Veranstaltung laut Dienstplan', custom: 'Termin' }[e.kind];
  const mayEdit = isAdmin() || (e.kind === 'custom' && e.created_by === state.me.id && canWrite());
  openModal(`
    <h2>${esc(e.kind === 'venue' ? e.title : p ? `${p.name}: ${e.title}` : e.title)}</h2>
    <p class="muted small">${kindLabel}</p>
    <p>🕒 ${esc(timeRange(e))}</p>
    ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}
    ${e.notes ? `<p style="white-space:pre-wrap">${esc(e.notes)}</p>` : ''}
    <div class="buttons">
      ${mayEdit ? '<button class="danger" id="ev-del">Löschen</button>' : ''}
      ${mayEdit && e.kind === 'custom' ? '<button id="ev-edit">Bearbeiten</button>' : ''}
      <button class="primary" data-close>Schließen</button>
    </div>`, (dlg) => {
    $('#ev-edit', dlg)?.addEventListener('click', () => openEventForm({ event: e }));
    $('#ev-del', dlg)?.addEventListener('click', async () => {
      if (!confirm('Eintrag wirklich löschen?')) return;
      try { await api(`/events/${e.id}`, { method: 'DELETE' }); dlg.close(); refreshCalendar(); } catch (err) { showError(err); }
    });
  });
}

function openEventForm({ event, date, time } = {}) {
  const e = event || {};
  const allDay = event ? Boolean(e.all_day) : !time;
  const startDate = (e.start || date || new Date().toISOString()).slice(0, 10);
  let endDate = startDate;
  if (e.all_day && e.end) { const d = new Date(`${e.end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); endDate = d.toISOString().slice(0, 10); }
  else if (e.end) endDate = e.end.slice(0, 10);
  const startTime = e.all_day ? '' : (e.start?.slice(11, 16) || time || '');
  const endTime = e.all_day ? '' : (e.end?.slice(11, 16) || '');
  openModal(`
    <h2>${event ? 'Termin bearbeiten' : 'Neuer Termin'}</h2>
    <form id="ev-form">
      <label>Titel</label><input name="title" required maxlength="200" value="${esc(e.title || '')}">
      <label class="check"><input type="checkbox" name="all_day" ${allDay ? 'checked' : ''}> Ganztägig</label>
      <div class="row">
        <div><label>Beginn</label><input type="date" name="start_date" required value="${startDate}"></div>
        <div class="time"><label>Uhrzeit</label><input type="time" name="start_time" value="${startTime}"></div>
      </div>
      <div class="row">
        <div><label>Ende</label><input type="date" name="end_date" value="${endDate}"></div>
        <div class="time"><label>Uhrzeit</label><input type="time" name="end_time" value="${endTime}"></div>
      </div>
      <label>Ort</label><input name="location" maxlength="200" value="${esc(e.location || '')}">
      <label>Notiz</label><textarea name="notes" rows="3" maxlength="2000">${esc(e.notes || '')}</textarea>
      <div class="buttons"><button type="button" data-close>Abbrechen</button><button class="primary" type="submit">Speichern</button></div>
    </form>`, (dlg) => {
    const form = $('#ev-form', dlg);
    const syncTimes = () => $$('.time', form).forEach((el) => { el.hidden = form.all_day.checked; });
    form.all_day.onchange = syncTimes;
    syncTimes();
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      const isAllDay = form.all_day.checked;
      let body;
      if (isAllDay) {
        const end = new Date(`${d.end_date || d.start_date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
        body = { title: d.title, all_day: true, start: d.start_date, end: end.toISOString().slice(0, 10) };
      } else {
        if (!d.start_time) return toast('Bitte eine Uhrzeit angeben oder „Ganztägig“ wählen');
        body = { title: d.title, all_day: false, start: `${d.start_date}T${d.start_time}`, end: d.end_time ? `${d.end_date || d.start_date}T${d.end_time}` : null };
      }
      body.location = d.location;
      body.notes = d.notes;
      try {
        await api(event ? `/events/${event.id}` : '/events', { method: event ? 'PATCH' : 'POST', body });
        dlg.close();
        refreshCalendar();
      } catch (err) { showError(err); }
    };
  });
}

// --- Kalender-Abo für Google / Apple ------------------------------------------
export function subscribeHtml() {
  const prefs = loadPref('subscribe', { people: [state.me.id], venue: false, custom: true, off: false });
  const people = state.people.filter((p) => p.roster_name || p.role !== 'none');
  return `
    <p class="small muted">Wähle, was in deinem Handykalender erscheinen soll. Der Kalender aktualisiert sich danach von selbst
      (Apple meist stündlich, Google alle paar Stunden).</p>
    <div id="sub-people" class="chips">${people.map((p) => `<label class="chip ${prefs.people.includes(p.id) ? 'on' : 'off'}" style="--c:${p.color}">
      <input type="checkbox" hidden value="${p.id}" ${prefs.people.includes(p.id) ? 'checked' : ''}><span class="dot"></span>${esc(p.name)}</label>`).join('')}</div>
    <label class="check"><input type="checkbox" id="sub-venue" ${prefs.venue ? 'checked' : ''}> Veranstaltungen (Bühne, Salons …)</label>
    <label class="check"><input type="checkbox" id="sub-custom" ${prefs.custom ? 'checked' : ''}> Gemeinsame Termine</label>
    <label class="check"><input type="checkbox" id="sub-off" ${prefs.off ? 'checked' : ''}> Frei-Tage</label>
    <h3>Abonnieren</h3>
    <div class="row">
      <a class="btn primary shrink" id="sub-apple" href="#">🍏 Apple Kalender</a>
      <a class="btn primary shrink" id="sub-google" href="#" target="_blank" rel="noopener">📆 Google Kalender</a>
      <button class="shrink" id="sub-copy">🔗 Link kopieren</button>
    </div>
    <details class="small" style="margin-top:.8rem"><summary>Hilfe</summary>
      <p><b>iPhone:</b> „Apple Kalender“ tippen → „Abonnieren“. <br>
      <b>Android/Google:</b> „Google Kalender“ öffnet die Google-Kalender-Webseite (am besten am Computer oder im Browser mit „Desktop-Version“) → „Hinzufügen“. Danach erscheint der Kalender auch in der Google-Kalender-App
      (dort unter Einstellungen → Kalender ggf. „Synchronisieren“ einschalten).<br>
      <b>Outlook &amp; andere:</b> Link kopieren und als „Kalender aus dem Internet“ hinzufügen.</p>
      <p>Der Link ist persönlich – bitte nicht weitergeben.</p>
    </details>`;
}

export function bindSubscribe(root) {
  const update = () => {
    const ids = $$('#sub-people input:checked', root).map((i) => Number(i.value));
    const prefs = { people: ids, venue: $('#sub-venue', root).checked, custom: $('#sub-custom', root).checked, off: $('#sub-off', root).checked };
    savePref('subscribe', prefs);
    const q = new URLSearchParams();
    if (ids.length) q.set('p', ids.join(','));
    if (prefs.venue) q.set('v', '1');
    if (prefs.custom) q.set('c', '1');
    if (prefs.off) q.set('off', '1');
    const https = `${state.baseUrl}/cal/${state.me.feed_token}.ics?${q}`;
    const webcal = https.replace(/^https?:/, 'webcal:');
    $('#sub-apple', root).href = webcal;
    $('#sub-google', root).href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    $('#sub-copy', root).onclick = () => copyText(https);
    $$('#sub-people label', root).forEach((l) => {
      const on = l.querySelector('input').checked;
      l.classList.toggle('on', on);
      l.classList.toggle('off', !on);
    });
  };
  root.addEventListener('change', update);
  update();
}

function openSubscribe() {
  openModal(`<h2>Im Handykalender anzeigen</h2>${subscribeHtml()}<div class="buttons"><button data-close>Fertig</button></div>`, bindSubscribe);
}
