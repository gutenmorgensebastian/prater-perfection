// E-Mail-Eingang: Die Website hat ein eigenes Postfach. Wer dorthin einen Dienst-, Spiel- oder
// Probenplan (PDF) weiterleitet, bekommt ihn automatisch in den Kalender.
// - Spielplan und Probenplan werden sofort übernommen (sie sind digital und werden sauber gelesen).
// - Dienstpläne sind Scans: standardmäßig als Entwurf, Admins bekommen eine Benachrichtigung zum Prüfen.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db, UPLOAD_DIR, getSetting, setSetting } from './db.js';
import { pushTo, broadcast } from './notify.js';
import { createDraft, publishDraft, TYPE_LABELS } from './imports.js';
import { planChannel } from './messages.js';

db.exec('CREATE TABLE IF NOT EXISTS mail_seen (message_id TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime(\'now\')))');

// Zugangsdaten: aus der Server-Konfiguration (.env) oder in der Verwaltung eingetragen.
export function mailConfig() {
  const host = process.env.MAIL_IMAP_HOST || getSetting('mail_host') || '';
  const user = process.env.MAIL_USER || getSetting('mail_user') || '';
  return {
    host,
    port: Number(process.env.MAIL_IMAP_PORT || getSetting('mail_port') || 993),
    user,
    password: process.env.MAIL_PASSWORD || getSetting('mail_password') || '',
    address: process.env.MAIL_ADDRESS || getSetting('mail_address') || user,
    fromEnv: Boolean(process.env.MAIL_IMAP_HOST),
  };
}
const configured = () => { const c = mailConfig(); return Boolean(c.host && c.user && c.password); };

const allowedSenders = () => (getSetting('mail_allowed') || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const dienstplanAuto = () => getSetting('mail_dienstplan_auto') === '1';

function log(entry) {
  const list = JSON.parse(getSetting('mail_log') || '[]');
  list.unshift({ at: new Date().toISOString(), ...entry });
  setSetting('mail_log', JSON.stringify(list.slice(0, 30)));
  broadcast('mail');
}

function storePdf(att) {
  const stored = `${crypto.randomBytes(16).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), att.content);
  const r = db.prepare('INSERT INTO attachments (original_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, NULL)')
    .run(att.filename || 'plan.pdf', stored, 'application/pdf', att.content.length);
  return Number(r.lastInsertRowid);
}

const isPdf = (a) => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.filename || '');

// Verarbeitet eine E-Mail (Rohdaten). Gibt eine kurze Beschreibung pro Ergebnis zurück.
export async function handleEmail(raw) {
  const mail = await simpleParser(raw);
  const from = (mail.from?.value?.[0]?.address || '').toLowerCase();
  const subject = mail.subject || '(ohne Betreff)';
  const id = mail.messageId || crypto.createHash('sha256').update(raw).digest('hex');
  if (db.prepare('SELECT 1 FROM mail_seen WHERE message_id = ?').get(id)) return [];
  db.prepare('INSERT INTO mail_seen (message_id) VALUES (?)').run(id);

  const allowed = allowedSenders();
  if (allowed.length && !allowed.some((a) => from === a || (a.startsWith('@') && from.endsWith(a)))) {
    log({ from, subject, result: 'Ignoriert – Absender steht nicht auf der Liste der erlaubten Absender.' });
    return ['ignoriert'];
  }
  const pdfs = (mail.attachments || []).filter(isPdf);
  if (!pdfs.length) {
    log({ from, subject, result: 'Keine PDF im Anhang.' });
    return ['keine PDF'];
  }

  const results = [];
  for (const att of pdfs) {
    try {
      const attachmentId = storePdf(att);
      const draft = await createDraft(att.content, { attachmentId, personId: null });
      const label = `${TYPE_LABELS[draft.type]} „${draft.roster.title || att.filename}“`;
      if (draft.type === 'dienstplan' && !dienstplanAuto()) {
        const admins = db.prepare("SELECT id FROM people WHERE role = 'admin'").all().map((p) => p.id);
        pushTo(admins, { title: 'Neuer Dienstplan per E-Mail', body: 'Bitte in der Verwaltung prüfen und veröffentlichen.', url: '/#/admin' }).catch(() => {});
        log({ from, subject, result: `${label} als Entwurf angelegt – bitte in der Verwaltung prüfen und veröffentlichen.`, roster_id: draft.roster.id });
        results.push('entwurf');
        continue;
      }
      const body = draft.type === 'dienstplan'
        ? { grid: draft.roster.grid, assignments: draft.assignments }
        : { plan: draft.roster.grid };
      const res = publishDraft(draft.roster, body, null, planChannel()?.id);
      log({ from, subject, result: `${label}: ${res.events} Einträge ${res.replaced ? 'aktualisiert' : 'übernommen'}.`, roster_id: draft.roster.id });
      results.push('veröffentlicht');
    } catch (err) {
      console.warn('E-Mail-Import fehlgeschlagen:', err);
      log({ from, subject, result: `Fehler bei „${att.filename}“: ${err.message}` });
      results.push('fehler');
    }
  }
  return results;
}

// Holt ungelesene Mails aus dem Postfach und verarbeitet sie.
let running = false;
export async function checkMailbox() {
  if (!configured() || running) return;
  running = true;
  const c = mailConfig();
  const client = new ImapFlow({ host: c.host, port: c.port, secure: c.port === 993, auth: { user: c.user, pass: c.password }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messages = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true, source: true })) messages.push(msg);
      for (const msg of messages) {
        await handleEmail(msg.source);
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
    await client.logout();
    setSetting('mail_last_check', new Date().toISOString());
    setSetting('mail_last_error', '');
  } catch (err) {
    setSetting('mail_last_check', new Date().toISOString());
    setSetting('mail_last_error', err.responseText || err.message || String(err));
    try { await client.logout(); } catch { /* egal */ }
  } finally {
    running = false;
    broadcast('mail');
  }
}

export function mailStatus() {
  const c = mailConfig();
  return {
    configured: configured(),
    fromEnv: c.fromEnv,
    host: c.host, port: c.port, user: c.user, address: c.address,
    intervalMin: Number(process.env.MAIL_INTERVAL_MIN || 5),
    lastCheck: getSetting('mail_last_check') || null,
    lastError: getSetting('mail_last_error') || null,
    allowed: getSetting('mail_allowed') || '',
    dienstplanAuto: dienstplanAuto(),
    log: JSON.parse(getSetting('mail_log') || '[]'),
  };
}

export function saveMailSettings(body) {
  if (body.allowed !== undefined) setSetting('mail_allowed', String(body.allowed).slice(0, 2000));
  if (body.dienstplanAuto !== undefined) setSetting('mail_dienstplan_auto', body.dienstplanAuto ? '1' : '0');
  if (!mailConfig().fromEnv) {
    for (const [key, field] of [['mail_host', 'host'], ['mail_user', 'user'], ['mail_address', 'address']]) {
      if (body[field] !== undefined) setSetting(key, String(body[field]).trim().slice(0, 200));
    }
    if (body.port !== undefined) setSetting('mail_port', String(Number(body.port) || 993));
    if (body.password) setSetting('mail_password', String(body.password).slice(0, 200)); // leer = unverändert
  }
}

export function startMailPolling() {
  const minutes = Math.max(1, Number(process.env.MAIL_INTERVAL_MIN || 5));
  setTimeout(checkMailbox, 10_000);
  setInterval(checkMailbox, minutes * 60_000);
}
