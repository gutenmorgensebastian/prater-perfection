import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { makePdf, makeEmail } from './helpers/minipdf.js';

let db, handleEmail, setSetting, bootstrap;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dienstplan-test-'));
  ({ db, setSetting, bootstrap } = await import('../src/db.js'));
  ({ handleEmail } = await import('../src/mailin.js'));
  bootstrap();
});

const probenplan = () => makePdf([
  { str: 'Endproben P01 Perfection', x: 57, y: 797, size: 11 }, { str: 'Stand: 03.09.2026', x: 412, y: 786 },
  { str: 'Prater Bühne', x: 101, y: 759 }, { str: 'Probebühne Prater', x: 384, y: 759 },
  { str: 'Do.', x: 59, y: 746 }, { str: '17.09.', x: 59, y: 736 },
  { str: '08:00-15:45 Einrichten', x: 101, y: 746 }, { str: '16:00-18:00 Soundcheck', x: 101, y: 726 },
  { str: '10:00-15:45 Probe', x: 384, y: 748 },
  { str: 'Fr.', x: 59, y: 703 }, { str: '18.09.', x: 59, y: 693 }, { str: '11:15-19:00 Endprobe', x: 101, y: 703 },
]);

const dienstplan = () => {
  const days = ['05', '06', '07', '08', '09', '10', '11'];
  return makePdf([
    { str: 'Dienstplan: Technik Prater für den Zeitraum 41. KW 2026', x: 63, y: 530 },
    ...days.map((d, i) => ({ str: `${d}.10.2026`, x: 168 + i * 95, y: 506 })),
    { str: 'Schröter', x: 62, y: 378 }, ...['10:00-18:00', 'F', 'F', '14:00-23:00', 'F', 'F', 'F'].map((s, i) => ({ str: s, x: 170 + i * 95, y: 378 })),
    { str: 'Mähler', x: 62, y: 365 }, ...['F', '12:00-20:00', 'F', 'F', 'F', 'F', 'F'].map((s, i) => ({ str: s, x: 170 + i * 95, y: 365 })),
    { str: 'Datum: 21.09.2026', x: 63, y: 301 },
  ], { width: 842, height: 595 });
};

test('Probenplan per E-Mail landet sofort im Kalender „Proben“, doppelte Mail wird ignoriert', async () => {
  const raw = makeEmail({ from: 'Dispo <dispo@volksbuehne.berlin>', subject: 'Fwd: Endproben', messageId: 'a1@test', pdfs: [{ name: 'Endproben.pdf', data: probenplan() }] });
  assert.deepEqual(await handleEmail(raw), ['veröffentlicht']);
  const cal = db.prepare("SELECT * FROM calendars WHERE name = 'Proben'").get();
  assert.ok(cal);
  const evs = db.prepare('SELECT title, start, location FROM events WHERE calendar_id = ? ORDER BY start').all(cal.id);
  assert.deepEqual(evs.map((e) => [e.start, e.location, e.title]), [
    ['2026-09-17T08:00', 'Prater Bühne', 'Einrichten'],
    ['2026-09-17T10:00', 'Probebühne Prater', 'Probe'],
    ['2026-09-17T16:00', 'Prater Bühne', 'Soundcheck'],
    ['2026-09-18T11:15', 'Prater Bühne', 'Endprobe'],
  ]);
  assert.deepEqual(await handleEmail(raw), []); // gleiche Message-ID
  // Neue Fassung (andere Mail) ersetzt die alte statt doppelt einzutragen
  const raw2 = makeEmail({ from: 'dispo@volksbuehne.berlin', subject: 'Endproben neu', messageId: 'a2@test', pdfs: [{ name: 'Endproben2.pdf', data: probenplan() }] });
  assert.deepEqual(await handleEmail(raw2), ['veröffentlicht']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM events WHERE calendar_id = ?').get(cal.id).n, 4);
});

test('Dienstplan per E-Mail wird Entwurf, außer „sofort veröffentlichen“ ist an', async () => {
  const raw = makeEmail({ from: 'dispo@volksbuehne.berlin', subject: 'DP KW 41', messageId: 'd1@test', pdfs: [{ name: 'DP.pdf', data: dienstplan() }] });
  assert.deepEqual(await handleEmail(raw), ['entwurf']);
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'shift'").get().n, 0);
  assert.equal(db.prepare("SELECT status FROM rosters ORDER BY id DESC").get().status, 'draft');

  setSetting('mail_dienstplan_auto', '1');
  const raw2 = makeEmail({ from: 'dispo@volksbuehne.berlin', subject: 'DP KW 41', messageId: 'd2@test', pdfs: [{ name: 'DP.pdf', data: dienstplan() }] });
  assert.deepEqual(await handleEmail(raw2), ['veröffentlicht']);
  const shifts = db.prepare("SELECT e.start, e.end, p.name FROM events e JOIN people p ON p.id = e.person_id WHERE e.kind = 'shift' ORDER BY e.start").all();
  assert.deepEqual(shifts.map((s) => [s.name, s.start, s.end]), [
    ['Schröter', '2026-10-05T10:00', '2026-10-05T18:00'],
    ['Mähler', '2026-10-06T12:00', '2026-10-06T20:00'],
    ['Schröter', '2026-10-08T14:00', '2026-10-08T23:00'],
  ]);
  setSetting('mail_dienstplan_auto', '0');
});

test('Nur erlaubte Absender, Mails ohne PDF werden notiert', async () => {
  setSetting('mail_allowed', 'dispo@volksbuehne.berlin, @prater.example');
  const spam = makeEmail({ from: 'fremd@example.com', subject: 'x', messageId: 's1@test', pdfs: [{ name: 'x.pdf', data: probenplan() }] });
  assert.deepEqual(await handleEmail(spam), ['ignoriert']);
  const domain = makeEmail({ from: 'kollegin@prater.example', subject: 'ohne', messageId: 's2@test', pdfs: [] });
  assert.deepEqual(await handleEmail(domain), ['keine PDF']);
  setSetting('mail_allowed', '');
});
