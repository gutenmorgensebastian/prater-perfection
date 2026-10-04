import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonCell, parseVenueCell, gridToEvents, isoWeekMonday, looksLikePersonRow, sanitizeGrid } from '../src/roster.js';
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

test('Grid -> Kalendereinträge, Nachtdienst über Mitternacht', () => {
  const grid = sanitizeGrid({
    title: 'x',
    dates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
    rows: [
      { label: 'Bühne', kind: 'area', cells: ['19:30 VS HOH', '', '', '', '', '', ''] },
      { label: 'Wagner', kind: 'person', cells: ['22:00-02:00', 'F 40.2', '', '', '', '', ''] },
      { label: 'Ignoriert', kind: 'person', cells: ['10:00-12:00', '', '', '', '', '', ''] },
    ],
  });
  const ev = gridToEvents(grid, [null, 7, null]);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev[0], { kind: 'venue', person_id: null, title: 'VS HOH', location: 'Bühne', start: '2026-10-05T19:30', end: null, all_day: 0 });
  assert.deepEqual(ev[1], { kind: 'shift', person_id: 7, title: 'Dienst', location: '', start: '2026-10-05T22:00', end: '2026-10-06T02:00', all_day: 0 });
  assert.deepEqual(ev[2], { kind: 'off', person_id: 7, title: 'Frei (F 40.2)', location: '', start: '2026-10-06', end: '2026-10-07', all_day: 1 });
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
