// Oberfläche der Lite-Version: ausblenden, was ohne Server und Chat keinen Sinn hat,
// Kalenderdatei (.ics), Datensicherung und PDF-Ansicht.
import { liteBackup, liteRestore, liteReset, liteIcs, liteNamed, liteMarkNamed, liteFlush, attachmentById, getPdfjs } from './mock.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3200); };

function download(name, mime, data) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

// --- Dinge entfernen/umschreiben, die es ohne Server nicht gibt ---------------------------
const REMOVE_CARDS = ['🔔 Benachrichtigungen', '🏠 Als App aufs Handy', 'Abmelden', '💬 Chat-Gruppen'];
function prune() {
  document.querySelectorAll('#view .card').forEach((card) => {
    const h = $('h2', card)?.textContent.trim() || '';
    if (REMOVE_CARDS.some((t) => h.startsWith(t))) card.remove();
    else if (h.startsWith('🛠️ Verwaltung')) { const p = $('p', card); const t = 'Dienstplan, Spielplan und Probenplan einlesen, Personen verwalten.'; if (p && p.textContent !== t) p.textContent = t; }
    else if (h.startsWith('👥 Personen')) {
      if ($('h2', card).textContent !== '👥 Personen') $('h2', card).textContent = '👥 Personen';
      const p = $('p', card);
      const t = 'Wer im Dienstplan steht, wird beim Einlesen automatisch angelegt. „Dienstplan-Name“ = wie der Name im PDF steht. Eigene Farbe und Name kannst du hier ändern.';
      if (p && p.textContent !== t) p.textContent = t;
    } else if (h.startsWith('🗂️')) { /* bisherige Pläne bleiben */ }
    else if (h.startsWith('📲 Im Handykalender')) {
      if ($('h2', card).textContent !== '📲 In den Handykalender übernehmen') $('h2', card).textContent = '📲 In den Handykalender übernehmen';
    }
  });
  const imp = $('#import-card > p.small');
  if (imp && /E-Mail/.test(imp.textContent)) imp.textContent = 'Dienstplan, Spielplan oder Probenplan (PDF) wählen – die Art wird automatisch erkannt. Danach Vorschau prüfen und übernehmen. Eine neue Fassung desselben Plans ersetzt die alte.';
  // Einleitung des Kalender-Exports (Mehr-Seite und Dialog im Kalender)
  const intro = 'Wähle, was in deinem Handykalender erscheinen soll, und lade dir die Kalenderdatei. Sie ist eine Momentaufnahme und aktualisiert sich nicht von selbst.';
  document.querySelectorAll('p.small').forEach((p) => { if (p.textContent.startsWith('Wähle, was in deinem Handykalender') && p.textContent !== intro) p.textContent = intro; });
  const sub = $('#btn-sub'); if (sub && sub.textContent !== '📥 Export') { sub.textContent = '📥 Export'; sub.title = 'Kalenderdatei für den Handykalender laden'; }
  const mail = $('#mail-card'); if (mail?.firstChild) mail.replaceChildren();
  // Kalender-Abo → Kalenderdatei
  const apple = $('#sub-apple');
  if (apple && !apple.dataset.lite) {
    apple.dataset.lite = '1';
    apple.textContent = '📥 Kalenderdatei (.ics) laden';
    // Nur verstecken: calendar.js setzt später noch Links auf diese Knöpfe.
    for (const id of ['#sub-google', '#sub-copy']) { const el = $(id); if (el) el.style.display = 'none'; }
    const row = apple.parentElement;
    const help = row.parentElement.querySelector('details');
    if (help) help.innerHTML = `<summary>Hilfe</summary>
      <p><b>iPhone:</b> Die geladene Datei in „Dateien“ antippen → „Alle hinzufügen“.<br>
      <b>Android:</b> Datei antippen und mit Google Kalender öffnen (oder in calendar.google.com am Computer unter „Importieren“).<br>
      Das ist eine Momentaufnahme. Nach einem neuen Plan die Datei neu laden – gleiche Termine werden dabei meist aktualisiert statt doppelt angelegt.</p>`;
  }
  // Abo-Überschrift passend
  const h3 = [...document.querySelectorAll('#sub h3, #modal h3')].find((x) => x.textContent.trim() === 'Abonnieren');
  if (h3 && h3.textContent !== 'Als Datei laden') h3.textContent = 'Als Datei laden';
  // Personen-Tabelle: Einladungs-Knöpfe und Rolle weg
  document.querySelectorAll('#people [data-act="copy"], #people [data-act="renew"], #people a.btn, #people select[data-f="role"]').forEach((el) => el.remove());
  // Mehr: Datensicherung ergänzen
  if (location.hash.startsWith('#/mehr') && $('#view') && !$('#lite-data')) {
    const card = document.createElement('div');
    card.className = 'card'; card.id = 'lite-data';
    card.innerHTML = `<h2>💾 Daten sichern</h2>
      <p class="small muted">Alles liegt <b>nur auf diesem Gerät</b>, in diesem Browser. Wird der Browser-Speicher gelöscht, ist alles weg – deshalb ab und zu sichern.</p>
      <div class="row"><button class="primary shrink" id="lite-backup">⬇️ Sicherung laden</button>
        <label class="btn shrink">⬆️ Sicherung einspielen<input type="file" id="lite-restore" accept=".json,application/json" hidden></label></div>
      <p class="small muted" style="margin-top:.8rem">Eine Sicherung kannst du auch auf ein anderes Gerät mitnehmen und dort einspielen.</p>
      <details class="small"><summary>Alles löschen</summary><button class="danger" id="lite-reset" style="margin-top:.4rem">Alle Daten auf diesem Gerät löschen</button></details>`;
    $('#view').append(card);
  }
}
// Eigene Änderungen verwerfen, sonst löst prune() sich selbst immer wieder aus.
const pruneObserver = new MutationObserver(() => { prune(); pruneObserver.takeRecords(); });
pruneObserver.observe(document.body, { childList: true, subtree: true });
addEventListener('hashchange', () => setTimeout(prune, 50));
prune();

// --- Hochladen: Meldung statt stillem Nichts, wenn kein PDF angekommen ist ---------------------
// Manche Viewer-Apps (eingebettete Browser) reichen die gewählte Datei nicht durch. Dann blockiert das
// Pflichtfeld das Absenden stumm. Hier gibt es stattdessen eine sichtbare Meldung.
// Pflichtfeld abschalten (die Browser-Meldung dazu fehlt in Viewer-Apps) und selbst prüfen.
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('#import-upload [type=submit]');
  if (!btn) return;
  const input = btn.form.querySelector('input[type=file]');
  input.required = false;
  if (!input.files?.length) {
    e.preventDefault(); e.stopImmediatePropagation();
    toast('⚠️ Es ist noch kein PDF ausgewählt. Wenn das Auswählen nichts bewirkt, blockiert diese App die Dateiauswahl – bitte die Datei in Safari/Chrome öffnen.');
  }
}, true);
document.addEventListener('change', (e) => {
  if (e.target.matches?.('#import-upload input[type=file]') && e.target.files?.[0]) toast(`📄 ${e.target.files[0].name} ausgewählt – jetzt „Hochladen“`);
});
addEventListener('unhandledrejection', (e) => toast(`⚠️ ${e.reason?.message || e.reason}`));
addEventListener('error', (e) => toast(`⚠️ ${e.message}`));

// --- Klicks -----------------------------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('#sub-apple')) {
    e.preventDefault(); e.stopPropagation();
    const root = t.closest('#sub, #modal') || document;
    const ids = [...root.querySelectorAll('#sub-people input:checked')].map((i) => Number(i.value));
    const cals = [...root.querySelectorAll('#sub-cals input:checked')].map((i) => Number(i.value));
    const ics = liteIcs({ people: ids, venue: $('#sub-venue', root)?.checked, custom: $('#sub-custom', root)?.checked, cals, off: $('#sub-off', root)?.checked });
    download(`pratomat-${stamp()}.ics`, 'text/calendar', ics);
    toast('Kalenderdatei geladen – jetzt öffnen und hinzufügen');
    return;
  }
  if (t.closest('#lite-backup')) { download(`pratomat-sicherung-${stamp()}.json`, 'application/json', liteBackup()); toast('Sicherung geladen'); return; }
  if (t.closest('#lite-reset')) { if (confirm('Wirklich ALLE Daten auf diesem Gerät löschen?')) liteReset(); return; }
  const a = t.closest('a');
  if (a?.getAttribute('href')?.startsWith('/api/files/')) { e.preventDefault(); showFile(a.getAttribute('href').split('/').pop()); }
}, true);
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'lite-restore' || !e.target.files[0]) return;
  try {
    if (!confirm('Die aktuellen Daten auf diesem Gerät werden durch die Sicherung ersetzt. Fortfahren?')) return;
    await liteRestore(await e.target.files[0].text());
  } catch (err) { toast(`⚠️ ${err.message}`); }
});
addEventListener('lite-save-failed', () => toast('⚠️ Speichern nicht möglich (Speicher voll oder gesperrt). Bitte Daten sichern!'));

// --- Dateien (Original-PDFs, Anhänge) im Dialog zeigen ----------------------------------------
async function showFile(id) {
  const a = attachmentById(id);
  if (!a) return;
  const dlg = $('#modal');
  dlg.innerHTML = `<h2 style="overflow-wrap:anywhere">${esc(a.original_name)}</h2><div id="file-view" class="file-view">Lädt …</div><div class="buttons"><button data-close>Schließen</button></div>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  const view = $('#file-view', dlg);
  if (a.mime.startsWith('image/')) { view.innerHTML = `<img src="${a.data}" alt="">`; return; }
  if (a.mime !== 'application/pdf') { view.innerHTML = `<a class="btn primary" download="${esc(a.original_name)}" href="${a.data}">Datei laden</a>`; return; }
  try {
    const lib = await getPdfjs();
    const bytes = Uint8Array.from(atob(a.data.split(',')[1]), (c) => c.charCodeAt(0));
    const pdf = await lib.getDocument({ data: bytes }).promise;
    view.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      view.append(canvas);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
  } catch (err) { view.textContent = `PDF konnte nicht angezeigt werden (${err.message}).`; }
}

// Bilder aus dem Speicher direkt anzeigen.
const imgObserver = new MutationObserver(() => {
  document.querySelectorAll('img[src^="/api/files/"]').forEach((img) => {
    const a = attachmentById(img.getAttribute('src').split('/').pop());
    if (a) img.src = a.data;
  });
  imgObserver.takeRecords();
});
imgObserver.observe(document.body, { childList: true, subtree: true });

// --- Erster Start: Wie heißt du im Dienstplan? -----------------------------------------------
if (!liteNamed()) {
  setTimeout(() => {
    const dlg = $('#modal');
    if (!dlg || dlg.open) return;
    dlg.innerHTML = `<h2>👋 Willkommen im Pratomat</h2>
      <p class="small muted">Das ist die Lite-Version: Kalender, Dienstplan-Import und mehr – alles nur auf diesem Gerät.</p>
      <form id="lite-name">
        <label for="ln">Wie heißt du im Dienstplan?</label><input id="ln" name="name" required maxlength="80" placeholder="z. B. Mähler" autocomplete="off">
        <p class="small muted">So, wie dein Name im PDF steht. Damit sind deine Dienste später „deine“.</p>
        <div class="buttons"><button type="button" id="ln-skip">Später</button><button class="primary" type="submit">Los geht’s</button></div>
      </form>`;
    dlg.showModal();
    $('#ln-skip', dlg).onclick = async () => { await liteMarkNamed(); dlg.close(); };
    $('#lite-name', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      try {
        await fetch('/api/admin/people/1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, roster_name: name }) });
        await liteMarkNamed(); await liteFlush(); dlg.close(); location.reload();
      } catch (err) { toast(`⚠️ ${err.message}`); }
    };
  }, 600);
}
