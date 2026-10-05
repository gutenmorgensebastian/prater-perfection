import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonCell } from '../src/roster.js';
import { ocrDate, itemsToGrid } from '../src/pdf-text.js';
import { removeTableLines, tsvToItems, ocrAvailable, ocrPdfItems } from '../src/pdf-ocr.js';
import { makePdf } from './helpers/minipdf.js';

test('Datum trotz Lesefehlern des Scanners', () => {
  assert.equal(ocrDate('i3.10.2026'), '2026-10-13');
  assert.equal(ocrDate('16.10.202ß'), '2026-10-16');
  assert.equal(ocrDate("18.'tO.2026"), '2026-10-18');
  assert.equal(ocrDate('19.10.2026'), '2026-10-19');
  assert.equal(ocrDate('Montag'), null);
  assert.equal(ocrDate('45.10.2026'), null);
});

test('Uhrzeiten mit weiteren typischen Lesefehlern', () => {
  const shift = (start, end) => ({ type: 'shift', start, end, note: '' });
  assert.deepEqual(parsePersonCell('13:(X)-23:00'), shift('13:00', '23:00'));
  assert.deepEqual(parsePersonCell('09:[)0-17.30'), shift('09:00', '17:30'));
  assert.deepEqual(parsePersonCell('ü9:CIC)-16:30'), shift('09:00', '16:30'));
  assert.deepEqual(parsePersonCell('10:ü[)-16:üC1'), shift('10:00', '16:00'));
  assert.deepEqual(parsePersonCell('18:CIC1-23:ü0'), shift('18:00', '23:00'));
  assert.deepEqual(parsePersonCell('16:ü0-23:C10'), shift('16:00', '23:00'));
  assert.deepEqual(parsePersonCell('. F 42.1'), { type: 'off', code: 'F 42.1' });
  assert.deepEqual(parsePersonCell("' Fü"), { type: 'off', code: 'FÜ' });
});

test('Tabellenlinien entfernen, Schrift bleibt', () => {
  const w = 200, h = 100;
  const px = Buffer.alloc(w * h, 255);
  for (let x = 0; x < w; x++) px[50 * w + x] = 0;            // waagerechte Linie
  for (let y = 0; y < h; y++) px[y * w + 120] = 0;           // senkrechte Linie
  for (let y = 10; y < 40; y++) px[y * w + 20] = 0;          // Strich eines Buchstabens (kurz)
  const out = removeTableLines(Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), px]), 80);
  const clean = out.data.subarray(out.data.length - w * h);
  assert.equal(clean[50 * w + 10], 255);
  assert.equal(clean[70 * w + 120], 255);
  assert.equal(clean[20 * w + 20], 0);
});

test('tesseract-Ausgabe wird zur Tabelle', () => {
  // Wörter wie von tesseract (TSV, Pixel bei 300 dpi, y von oben)
  const rows = [['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text'].join('\t')];
  let line = 0;
  const addLine = (top, words) => {
    line++;
    rows.push([4, 1, 1, 1, line, 0, 0, top, 3000, 40, -1, ''].join('\t'));
    words.forEach(([left, text], i) => rows.push([5, 1, 1, 1, line, i + 1, left, top, 120, 40, 95, text].join('\t')));
  };
  const cols = [600, 900, 1200, 1500, 1800, 2100, 2400];
  addLine(100, [[100, 'Dienstplan:'], [400, 'Technik'], [700, 'Prater'], [1000, '43.'], [1100, 'KW'], [1200, '2026']]);
  addLine(200, cols.map((x, i) => [x, `${19 + i}.10.2026`]));
  addLine(300, [[100, 'Schröter'], ...cols.map((x, i) => [x, i < 5 ? '09:00-17:30' : 'F'])]);
  addLine(400, [[100, '[Lindner'], ...cols.map((x) => [x, 'F'])]);
  addLine(500, [[100, 'Datum:'], [300, '05.10.2026']]);
  const { grid } = itemsToGrid(tsvToItems(rows.join('\n'), 3508));
  assert.equal(grid.dates[0], '2026-10-19');
  assert.deepEqual(grid.rows.map((r) => r.label), ['Schröter', 'Lindner']);
  assert.deepEqual(grid.rows[0].cells, ['09:00-17:30', '09:00-17:30', '09:00-17:30', '09:00-17:30', '09:00-17:30', 'F', 'F']);
});

test('Texterkennung mit echtem tesseract', { skip: !ocrAvailable() && 'tesseract/pdftoppm nicht installiert' }, async () => {
  const pdf = makePdf([
    { x: 60, y: 780, str: 'Dienstplan: Technik Prater 43. KW 2026', size: 14 },
    ...['19.10.2026', '20.10.2026', '21.10.2026', '22.10.2026', '23.10.2026', '24.10.2026', '25.10.2026'].map((d, i) => ({ x: 150 + i * 62, y: 740, str: d, size: 9 })),
    { x: 60, y: 700, str: 'Lindner', size: 11 },
    ...['F', '16:30-23:00', '16:00-23:00', 'F', 'F', 'F', 'F'].map((t, i) => ({ x: 155 + i * 62, y: 700, str: t, size: 9 })),
  ]);
  const { grid } = itemsToGrid(await ocrPdfItems(pdf));
  const row = grid.rows.find((r) => r.label === 'Lindner');
  assert.ok(row, 'Zeile Lindner gefunden');
  assert.equal(row.cells[1], '16:30-23:00');
});
