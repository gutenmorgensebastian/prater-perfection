// Erster Start nach dem Einladungslink: Begrüßung und Hilfe, die Seite als Kachel aufs Handy zu legen.
import { state, esc, $, openModal } from './core.js';

let installPrompt = null; // nur Android/Chrome: Installationsdialog des Browsers
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function installHelpHtml() {
  if (isStandalone()) return '<p class="small">✅ Läuft als App – du bleibst angemeldet.</p>';
  return `
    ${installPrompt ? '<button class="primary" id="install-btn">📲 Als App aufs Handy legen</button>' : ''}
    <p class="small">${isIos()
    ? '<b>iPhone:</b> unten auf das Teilen-Symbol <span aria-hidden="true">⬆️</span> tippen → „Zum Home-Bildschirm“ → „Hinzufügen“.'
    : '<b>Android:</b> Menü <b>⋮</b> oben rechts → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.'}<br>
    Danach startest du alles über die Kachel und bleibst angemeldet.</p>`;
}

export function bindInstall(root) {
  $('#install-btn', root)?.addEventListener('click', async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#install-btn', root)?.remove();
  });
}

export function maybeShowWelcome() {
  // Nur beim ersten Öffnen des Einladungslinks auf diesem Gerät (nicht in der installierten App).
  if (!location.pathname.startsWith('/join/') || isStandalone()) return;
  try {
    if (localStorage.getItem('welcomed') === String(state.me.id)) return;
    localStorage.setItem('welcomed', String(state.me.id));
  } catch { /* privater Modus */ }
  const role = { admin: 'Admin', member: 'Mitarbeiter*in', viewer: 'Gast' }[state.me.role];
  openModal(`
    <h2>Willkommen im Pratomat, ${esc(state.me.name)}! 👋</h2>
    <p>Du bist angemeldet (${role}). Ein Passwort brauchst du nicht.</p>
    <h3>Jetzt noch die Kachel aufs Handy legen</h3>
    ${installHelpHtml()}
    <div class="buttons"><button class="primary" data-close>Los geht's</button></div>`, bindInstall);
}

// Wenn die Kachel ausnahmsweise nicht angemeldet ist: Einladungslink einfügen statt suchen.
export function loginHelpHtml() {
  return `<div class="card center" style="margin-top:10vh"><h2>🔒 Nicht angemeldet</h2>
    <p>Öffne den persönlichen Einladungslink, den du bekommen hast – oder füge ihn hier ein:</p>
    <form id="link-form" class="row"><input id="link-input" placeholder="https://…/join/…" autocomplete="off"><button class="primary shrink" type="submit">Anmelden</button></form>
    <p class="small muted" id="link-error"></p></div>`;
}

export function bindLoginHelp() {
  $('#link-form').onsubmit = (e) => {
    e.preventDefault();
    const m = $('#link-input').value.trim().match(/\/join\/([A-Za-z0-9_-]{10,})/);
    if (!m) { $('#link-error').textContent = 'Das sieht nicht nach einem Einladungslink aus.'; return; }
    location.href = `/join/${m[1]}?app=1`;
  };
}
