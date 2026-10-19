import { state, api, esc, $, setTitle, showError, toast } from './core.js';
import { subscribeHtml, bindSubscribe } from './calendar.js';
import { installHelpHtml, bindInstall } from './welcome.js';

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt (in den Handy-Einstellungen änderbar).');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(state.vapidPublicKey) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

async function renderPush() {
  const el = $('#push');
  if (!pushSupported()) {
    el.innerHTML = isIos() && !isStandalone()
      ? '<p class="small">Auf dem iPhone gehen Benachrichtigungen nur, wenn die Seite zum Home-Bildschirm hinzugefügt wurde (siehe unten). Danach die App vom Home-Bildschirm öffnen und hier einschalten.</p>'
      : '<p class="small muted">Dieser Browser unterstützt keine Benachrichtigungen.</p>';
    return;
  }
  const sub = await currentSubscription();
  el.innerHTML = sub
    ? '<p class="small">✅ Auf diesem Gerät eingeschaltet (neue Chat-Nachrichten &amp; neue Dienstpläne).</p><button id="push-off">Ausschalten</button>'
    : '<p class="small">Bei neuen Nachrichten und neuen Dienstplänen eine Benachrichtigung bekommen.</p><button class="primary" id="push-on">🔔 Einschalten</button>';
  $('#push-on')?.addEventListener('click', async () => {
    try { await enablePush(); toast('Benachrichtigungen eingeschaltet'); } catch (err) { showError(err); }
    renderPush();
  });
  $('#push-off')?.addEventListener('click', async () => {
    try { await disablePush(); toast('Ausgeschaltet'); } catch (err) { showError(err); }
    renderPush();
  });
}

export function renderMore(view) {
  setTitle('Mehr');
  const roleText = { admin: 'Admin', member: 'Mitarbeiter*in', viewer: 'Gast' }[state.me.role];
  view.innerHTML = `
    <div class="card"><h2>👋 Hallo ${esc(state.me.name)}</h2><p class="small muted">Rolle: ${roleText}</p></div>
    ${state.me.role === 'admin' ? `<div class="card"><h2>🛠️ Verwaltung</h2>
      <p class="small muted">Dienstplan und Spielplan einlesen, Personen einladen, Chat-Gruppen verwalten.</p>
      <a class="btn primary" href="#/admin">Zur Verwaltung</a></div>` : ''}
    <div class="card"><h2>📲 Im Handykalender anzeigen</h2><div id="sub"></div></div>
    <div class="card"><h2>🔔 Benachrichtigungen</h2><div id="push"></div></div>
    <div class="card"><h2>🏠 Als App aufs Handy</h2><div id="install">${installHelpHtml()}</div></div>
    <div class="card"><h2>Abmelden</h2>
      <p class="small muted">Zum erneuten Anmelden brauchst du wieder deinen Einladungslink.</p>
      <form method="post" action="/logout"><button class="danger" type="submit">Abmelden</button></form>
    </div>`;
  $('#sub').innerHTML = subscribeHtml();
  bindSubscribe($('#sub'));
  renderPush();
  bindInstall($('#install'));
}
