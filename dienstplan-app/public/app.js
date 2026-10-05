import { state, api, $, $$, loadPref } from './js/core.js';
import { renderCalendar, refreshCalendar, refreshCalendarList } from './js/calendar.js';
import { renderChat, onMessage, onMessageChanged, updateBadges } from './js/chat.js';
import { renderAdmin, renderChannels, reloadPeopleAdmin, renderMailCard } from './js/admin.js';
import { renderMore } from './js/more.js';
import { renderTodos, refreshTodos } from './js/todos.js';
import { renderQuestions, refreshQuestions, refreshCounts } from './js/questions.js';
import { renderInfos, refreshInfos } from './js/infos.js';
import { renderOrders, refreshOrders } from './js/orders.js';
import { maybeShowWelcome, loginHelpHtml, bindLoginHelp } from './js/welcome.js';

let cleanup = null;

async function loadState() {
  const data = await api('/me');
  Object.assign(state, data);
}

function route() {
  const [, section = 'kalender', id, sub] = location.hash.replace(/^#\/?/, '#/').split('/');
  const view = $('#view');
  cleanup?.();
  cleanup = null;
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === section || (section === 'admin' && a.dataset.tab === 'mehr')));
  if (section === 'chat') {
    const channelId = Number(id) || loadPref('last-channel', state.channels[0]?.id);
    cleanup = renderChat(view, channelId, sub === 'ablage' ? 'ablage' : 'chat');
  } else if (section === 'todos') {
    cleanup = renderTodos(view);
  } else if (section === 'fragen') {
    cleanup = renderQuestions(view, id);
  } else if (section === 'infos') {
    cleanup = renderInfos(view);
  } else if (section === 'bestellen') {
    cleanup = renderOrders(view);
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
  es.addEventListener('calendars', async () => { await loadState(); refreshCalendarList(); });
  es.addEventListener('mail', () => { if (location.hash.startsWith('#/admin')) renderMailCard(); });
  es.addEventListener('todos', () => refreshTodos());
  es.addEventListener('questions', (e) => {
    if (JSON.parse(e.data).people?.includes(state.me.id)) refreshQuestions();
  });
  es.addEventListener('infos', () => refreshInfos());
  es.addEventListener('orders', () => refreshOrders());
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
    $('#view').innerHTML = err.status === 401 ? loginHelpHtml() : `<p class="center">⚠️ ${err.message}</p>`;
    if (err.status === 401) bindLoginHelp();
    return;
  }
  $('#tabbar').hidden = false;
  window.addEventListener('hashchange', route);
  if (!location.hash) location.replace('#/kalender');
  route();
  maybeShowWelcome();
  updateBadges();
  refreshCounts();
  connectLive();
  // Nach dem Zurückkehren in die App frische Daten holen (Handy war evtl. im Standby).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshCalendar(); onMessageChanged(); refreshTodos(); refreshQuestions(); refreshInfos(); refreshOrders();
    }
  });
}

start();
