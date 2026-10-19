import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonCell, parseVenueCell, gridToEvents, isoWeekMonday, looksLikePersonRow, sanitizeGrid, splitByPlaces, venueEntries } from '../src/roster.js';
import { spielplanFromPages } from '../src/spielplan.js';
import { matchesTodo } from '../public/js/todo-search.js';
import { itemsToGrid } from '../src/pdf-text.js';
import { buildIcs } from '../src/ics.js';

test('Personen-Zellen inkl. typischer Scan-Fehler', () => {
  assert.deepEqual(parsePersonCell('10:00-18:00'), { type: 'shift', start: '10:00', end: '18:00', note: '' });
  assert.deepEqual(parsePersonCell('09:00-1 7:C)0'), { type: 'shift', start: '09:00', end: '17:00', note: '' });
  assert.deepEqual(parsePersonCell('12:00-i6:ü0'), { type: 'shift', start: '12:00', end: '16:00', note: '' });
  assert.deepEqual(parsePersonCell('18:C)0-23:00'), { type: 'shift', start: '18:00', end: '23:00', note: '' });
  assert.deepEqual(parsePersonCell('10:00-18:00 Bühne'), { type: 'shift', start: '10:00', end: '18:00', note: 'Bühne' });
  assert.deepEqual(parsePersonCell('F 41 .2'), { type: 'off', code: 'F 41.2' });
  assert.deepEqual(parsePersonCell('F41.1'), { type: 'off', code: 'F 41.1' });
  assert.deepEqual(parsePersonCell('FÜ'), { type: 'off', code: 'FÜ' });
  assert.deepEqual(parsePersonCell('F'), { type: 'off', code: 'F' });
  assert.deepEqual(parsePersonCell(''), { type: 'empty' });
  assert.deepEqual(parsePersonCell('Gastspiel'), { type: 'note', text: 'Gastspiel' });
});

test('Veranstaltungs-Zellen', () => {
  assert.deepEqual(parseVenueCell('19:30-21 :45 VS A YEAR W/O SUMMER'), [{ start: '19:30', end: '21:45', title: 'VS A YEAR W/O SUMMER' }]);
  assert.deepEqual(parseVenueCell('19:30 VS VB01 HOH 22:00 Party'), [
    { start: '19:30', end: null, title: 'VS VB01 HOH' }, { start: '22:00', end: null, title: 'Party' }]);
  assert.deepEqual(parseVenueCell('Probe'), [{ start: null, end: null, title: 'Probe' }]);
});

test('Zeilenart erkennen', () => {
  assert.equal(looksLikePersonRow(['10:00-18:00', 'F 40.2', '09:30-17:30', '14:00-23:00', '', 'F', 'F']), true);
  assert.equal(looksLikePersonRow(['19:30 VS VB01 HOH', '19:30 VS VB02', '', '', '19:30-21:45 VS A YEAR', '', '']), false);
});

test('ISO-Kalenderwoche', () => {
  assert.equal(isoWeekMonday(2026, 41), '2026-10-05');
  assert.equal(isoWeekMonday(2027, 1), '2027-01-04');
});

test('Grid -> Kalendereinträge: Nachtdienst, nur Prater-Veranstaltungen', () => {
  const grid = sanitizeGrid({
    title: 'x',
    dates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
    rows: [
      { label: 'Bühne', kind: 'area', cells: ['19:30 VS HOH', '', '', '', '', '', ''] },
      { label: '3. Stock', kind: 'area', cells: ['', '19:00 P14 PRATER 20:00 Perfection · Anta Recke', '', '', '', '', ''] },
      { label: 'Prater', kind: 'area', cells: ['', '', 'P02 CURSED · TE', '', '', '', ''] },
      { label: 'Wagner', kind: 'person', cells: ['22:00-02:00', 'F 40.2', '', '', '', '', ''] },
      { label: 'Ignoriert', kind: 'person', cells: ['10:00-12:00', '', '', '', '', '', ''] },
    ],
  });
  assert.deepEqual(grid.rows.map((r) => r.import), [false, false, true, false, false]);
  const ev = gridToEvents(grid, [null, null, null, 7, null]);
  assert.deepEqual(ev, [
    { kind: 'venue', person_id: null, title: 'Perfection', location: 'Prater', notes: 'Anta Recke', start: '2026-10-06T20:00', end: null, all_day: 0 },
    { kind: 'venue', person_id: null, title: 'P02 CURSED · TE', location: 'Prater', notes: '', start: '2026-10-07', end: '2026-10-08', all_day: 1 },
    { kind: 'shift', person_id: 7, title: 'Dienst', location: '', start: '2026-10-05T22:00', end: '2026-10-06T02:00', all_day: 0 },
    { kind: 'off', person_id: 7, title: 'Frei (F 40.2)', location: '', start: '2026-10-06', end: '2026-10-07', all_day: 1 },
  ]);
});

test('Prater-Einträge aus Zelltext', () => {
  assert.deepEqual(splitByPlaces('3. STOCK 19:00 P14 PRATER-FOYER 17:00 Bar').map((x) => x.place), ['3. STOCK', 'PRATER-FOYER']);
  assert.deepEqual(venueEntries('PRATER-PROBEBÜHNE 14:00 Boxing Girls · Workshop'), [
    { start: '14:00', end: null, title: 'Boxing Girls', notes: 'Workshop', location: 'Prater-Probebühne' },
  ]);
  assert.deepEqual(venueEntries('PRATER 11-15 interne VA 18:00 Gespräch · mit Gästen 3. STOCK P14'), [
    { start: '11:00', end: '15:00', title: 'interne VA', notes: '', location: 'Prater' },
    { start: '18:00', end: null, title: 'Gespräch', notes: 'mit Gästen', location: 'Prater' },
  ]);
  assert.deepEqual(venueEntries('19:30 VS VB01 HOH'), []);
});

test('Spielplan: nur Prater-Veranstaltungen, Jahr aus der Überschrift', () => {
  const it = (str, x, y, w = 30) => ({ str, x, y, w });
  const page = [
    it('Volksbühne am Rosa-Luxemburg-Platz', 20, 823, 158), it('Aktualisierter Spielplan November 2026', 219, 823, 160), it('Stand vom 01.10.2026', 487, 823, 88),
    it('Datum', 16, 799, 20), it('Bühne', 41, 799, 20), it('3.Stock & Prater', 164, 799, 51), it('Roter Salon', 320, 799, 37), it('Grüner Salon', 447, 799, 42), it('Gastspiele / andere', 525, 800, 52),
    it('So,', 16, 784, 9), it('01.11.', 16, 777, 17),
    it('16:00', 41, 783, 19), it('Mata Leão', 62, 783, 37),
    it('3. STOCK 19:00', 163, 783, 48), it('P14: endlich endlich', 213, 783, 73),
    it('PRATER 19:00', 163, 760, 45), it('Between Worlds Kiki', 210, 760, 74), it('·', 286, 760, 2), it('Präsentiert von Mother', 163, 753, 80),
    it('PRATER-FOYER', 525, 784, 47), it('17:00', 525, 777, 15), it('Community', 542, 777, 33), it('Bar The School of Self-', 525, 770, 60), it('Defense', 525, 763, 22),
    it('Mo,', 16, 720, 10), it('02.11.', 16, 713, 17),
    it('20:30', 41, 718, 19), it('SPYDERGUM', 62, 718, 48),
    it('PRATER P02 CURSED · OMSK Social Club · TE', 163, 718, 150),
  ];
  const plan = spielplanFromPages([page]);
  assert.equal(plan.month, '2026-11');
  assert.equal(plan.title, 'Spielplan November 2026 (Stand 01.10.2026)');
  assert.deepEqual(plan.events.map((e) => [e.date, e.start, e.location, e.title]), [
    ['2026-11-01', '17:00', 'Prater-Foyer', 'Community Bar The School of Self-Defense'],
    ['2026-11-01', '19:00', 'Prater', 'Between Worlds Kiki'],
    ['2026-11-02', null, 'Prater', 'P02 CURSED · OMSK Social Club · TE'],
  ]);
});

test('To-Do-Suche nach Wort, Person und #tag', () => {
  const todo = { title: 'Nebelmaschine reinigen', notes: '', tags: ['licht', 'bühne'], assignees: [2], subtasks: [{ title: 'Fluid kaufen' }] };
  const nameOf = (id) => ({ 2: 'Schröter' }[id]);
  assert.equal(matchesTodo(todo, '', nameOf), true);
  assert.equal(matchesTodo(todo, 'nebel', nameOf), true);
  assert.equal(matchesTodo(todo, 'fluid', nameOf), true);
  assert.equal(matchesTodo(todo, 'schröter', nameOf), true);
  assert.equal(matchesTodo(todo, '#lic', nameOf), true);
  assert.equal(matchesTodo(todo, '#ton', nameOf), false);
  assert.equal(matchesTodo(todo, 'nebel mähler', nameOf), false);
});

test('Tabelle aus PDF-Textpositionen (wie Scanner-OCR) erkennen', () => {
  const days = ['05', '06', '07', '08', '09', '10', '11'];
  const it = (str, x, y, w = 30) => ({ str, x, y, w });
  const items = [
    it('Dienstplan:', 63, 530), it('41.', 287, 530, 12), it('KW', 305, 530, 14), it('2026', 325, 530, 19),
    ...days.map((d, i) => it(`${d}.10.2026`, 168 + i * 95, 506, 43)),
    it('Bühne', 63, 493, 17), it('19:30', 144, 458, 15), it('VS', 166, 458, 8), it('HOH', 200, 458, 13),
    it('Roter', 63, 417, 15), it('Salon', 90, 417, 15), it('20:00', 431, 418, 15), it('VS', 452, 418, 8), it('CORRECTIV', 465, 418, 35),
    it('Schröter', 62, 378, 23), ...['10:00-18:00', 'F 40.2', '09:30-17:30', '14:00-23:00', '14:00-23:00', 'F41.1', 'F 41 .2'].map((s, i) => it(s, 170 + i * 95, 378, 32)),
    it('Juliard', 62, 352, 20), it('09:00-1', 168, 353, 20), it('7:C)0', 197, 353, 15), ...['F', 'F', 'F', 'F', 'F', 'F'].map((s, i) => it(s, 284 + i * 95, 353, 4)),
    it('Datum:', 63, 301, 27), it('21.09.2026', 102, 301, 43),
  ];
  const { grid } = itemsToGrid(items);
  assert.equal(grid.dates[0], '2026-10-05');
  assert.deepEqual(grid.rows.map((r) => [r.label, r.kind]), [['Bühne', 'area'], ['Roter Salon', 'area'], ['Schröter', 'person'], ['Juliard', 'person']]);
  assert.equal(grid.rows[0].cells[0], '19:30 VS HOH');
  assert.equal(grid.rows[1].cells[3], '20:00 VS CORRECTIV');
  assert.deepEqual(grid.rows[2].cells, ['10:00-18:00', 'F 40.2', '09:30-17:30', '14:00-23:00', '14:00-23:00', 'F41.1', 'F 41 .2']);
  assert.equal(grid.rows[3].cells[0], '09:00-1 7:C)0');
});

test('ICS-Feed', () => {
  const ics = buildIcs([
    { id: 1, kind: 'shift', person_name: 'Schröter', title: 'Dienst', start: '2026-10-05T10:00', end: '2026-10-05T18:00', all_day: 0 },
    { id: 2, kind: 'off', person_name: 'Schröter', title: 'Frei', start: '2026-10-06', end: '2026-10-07', all_day: 1 },
    { id: 3, kind: 'venue', title: 'VS A YEAR, W/O SUMMER', location: 'Bühne', start: '2026-10-09T19:30', end: null, all_day: 0 },
  ], { name: 'Test', host: 'example.org' });
  assert.match(ics, /DTSTART;TZID=Europe\/Berlin:20261005T100000\r\n/);
  assert.match(ics, /SUMMARY:Schröter: Dienst\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261006\r\nDTEND;VALUE=DATE:20261007/);
  assert.match(ics, /SUMMARY:VS A YEAR\\, W\/O SUMMER/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});

test('Probenplan: ein Termin pro Zeile mit Uhrzeit, Ort aus der Spalte, Fußnote', async () => {
  const { probenplanFromPages, entriesFromLines } = await import('../src/probenplan.js');
  assert.deepEqual(entriesFromLines(['11:00- 13:00 Endprobe', 'ohne Ton', '13:00 dazu Bel']), [
    { start: '11:00', end: '13:00', title: 'Endprobe ohne Ton' },
    { start: '13:00', end: null, title: 'dazu Bel' },
  ]);
  const it = (str, x, y, w = 30) => ({ str, x, y, w });
  const page = [
    it('Endproben P01 Perfection', 57, 797, 125), it('Stand: 03.09.2026', 412, 786, 84),
    it('Prater', 101, 759, 26), it('Bühne', 130, 759, 28), it('Probebühne', 384, 759, 53), it('Prater', 439, 759, 26),
    it('Do.', 59, 746, 14), it('17.09.', 59, 736, 25),
    it('08:00', 101, 746, 23), it('-', 124, 746, 3), it('15:45', 127, 746, 23), it('Einrichten', 153, 746, 44),
    it('16:00', 101, 726, 23), it('-', 124, 726, 3), it('18:00 Soundcheck', 127, 726, 79),
    it('10:00', 384, 748, 18), it('-', 402, 748, 2), it('1', 404, 748, 4), it('5', 408, 748, 4), it(':', 412, 748, 2), it('45', 414, 748, 8), it('Probe', 424, 748, 19),
    it('Fr.', 59, 703, 12), it('02.10.', 59, 693, 25),
    it('20:00', 101, 703, 23), it('Uraufführung', 130, 703, 60), it('Anschl. Premierenparty', 101, 693, 90),
    it('Vor TE: 07.09.', 57, 640, 60), it('von 08-16', 120, 640, 40),
  ];
  const plan = probenplanFromPages([page]);
  assert.equal(plan.key, 'Endproben P01 Perfection');
  assert.deepEqual(plan.events.map((e) => [e.date, e.start, e.end, e.location, e.title]), [
    ['2026-09-07', '08:00', '16:00', 'Prater', 'Vor TE'],
    ['2026-09-17', '08:00', '15:45', 'Prater Bühne', 'Einrichten'],
    ['2026-09-17', '10:00', '15:45', 'Probebühne Prater', 'Probe'],
    ['2026-09-17', '16:00', '18:00', 'Prater Bühne', 'Soundcheck'],
    ['2026-10-02', '20:00', null, 'Prater Bühne', 'Uraufführung Anschl. Premierenparty'],
  ]);
});
