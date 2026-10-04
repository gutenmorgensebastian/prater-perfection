import { state, api, $, $$, loadPref } from './js/core.js';
import { renderCalendar, refreshCalendar } from './js/calendar.js';
import { renderChat, onMessage, onMessageChanged, updateBadges } from './js/chat.js';
import { renderAdmin, renderChannels, reloadPeopleAdmin } from './js/admin.js';
import { renderMore } from './js/more.js';

let cleanup = null;

async function loadState() {
  const data = await api('/me');
  Object.assign(state, data);
  $('#tab-admin').hidden = state.me.role !== 'admin';
}

function route() {
  const [, section = 'kalender', id, sub] = location.hash.replace(/^#\/?/, '#/').split('/');
  const view = $('#view');
  cleanup?.();
  cleanup = null;
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === section));
  if (section === 'chat') {
    const channelId = Number(id) || loadPref('last-channel', state.channels[0]?.id);
    cleanup = renderChat(view, channelId, sub === 'ablage' ? 'ablage' : 'chat');
  } else if (section === 'admin' && state.me.role === 'admin') {
    renderAdmin(view);
  } else if (section === 'mehr') {
    renderMore(view);
  } else {
    cleanup = renderCalendar(view);
  }
  window.scrollTo(0, 0);
}

function connectLive() {
  const es = new EventSource('/api/stream');
  es.addEventListener('events', () => refreshCalendar());
  es.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  es.addEventListener('message-updated', () => onMessageChanged());
  es.addEventListener('message-deleted', (e) => {
    const { id } = JSON.parse(e.data);
    document.querySelector(`.msg[data-id="${id}"]`)?.remove();
  });
  es.addEventListener('people', async () => { await loadState(); refreshCalendar(); reloadPeopleAdmin(); });
  es.addEventListener('channels', async () => {
    await loadState();
    renderChannels();
    if (location.hash.startsWith('#/chat')) route();
  });
}

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    await loadState();
  } catch (err) {
    $('#view').innerHTML = err.status === 401
      ? `<div class="card center" style="margin-top:10vh"><h2>🔒 Nicht angemeldet</h2>
          <p>Bitte öffne den persönlichen Einladungslink, den du bekommen hast.<br>
          <span class="small muted">Tipp: Auf dem iPhone den Link in Safari öffnen, danach „Zum Home-Bildschirm“.</span></p></div>`
      : `<p class="center">⚠️ ${err.message}</p>`;
    return;
  }
  $('#tabbar').hidden = false;
  window.addEventListener('hashchange', route);
  if (!location.hash) location.replace('#/kalender');
  route();
  updateBadges();
  connectLive();
  // Nach dem Zurückkehren in die App frische Daten holen (Handy war evtl. im Standby).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { refreshCalendar(); onMessageChanged(); }
  });
}

start();
