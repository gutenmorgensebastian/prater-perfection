// Texterkennung (OCR) für PDFs ohne brauchbare Textebene – z. B. „Microsoft Print to PDF“,
// wo der Text nur als Zeichensalat drinsteckt, oder reine Bild-Scans. Kostenlos und lokal:
// pdftoppm (poppler-utils) macht ein Bild der ersten Seite, tesseract liest es.
// Vorher werden die Tabellenlinien entfernt – sonst verschluckt tesseract einzelne Zeichen wie „F“.
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const DPI = 300;

let available = null;
export function ocrAvailable() {
  if (available === null) {
    const ok = (cmd, arg) => spawnSync(cmd, [arg], { stdio: 'ignore' }).status === 0;
    available = ok('pdftoppm', '-v') && ok('tesseract', '--version');
  }
  return available;
}

// Graustufenbild (PGM, P5) lesen und lange waagerechte/senkrechte dunkle Linien weiß machen.
export function removeTableLines(pgm, minRun = 80) {
  let pos = 0;
  const token = () => {
    while (/\s/.test(String.fromCharCode(pgm[pos]))) pos++;
    let s = '';
    while (!/\s/.test(String.fromCharCode(pgm[pos]))) s += String.fromCharCode(pgm[pos++]);
    return s;
  };
  if (token() !== 'P5') throw new Error('Unerwartetes Bildformat');
  const w = Number(token()), h = Number(token());
  token();
  pos++;
  const px = Buffer.from(pgm.subarray(pos, pos + w * h));
  const line = new Uint8Array(w * h);
  const dark = (i) => px[i] < 140;
  for (let y = 0; y < h; y++) {
    let start = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && dark(y * w + x)) continue;
      if (x - start >= minRun) for (let k = start; k < x; k++) line[y * w + k] = 1;
      start = x + 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let start = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && dark(y * w + x)) continue;
      if (y - start >= minRun) for (let k = start; k < y; k++) line[k * w + x] = 1;
      start = y + 1;
    }
  }
  for (let i = 0; i < w * h; i++) if (line[i]) px[i] = 255;
  return { width: w, height: h, data: Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), px]) };
}

// tesseract-TSV → Textstücke wie bei pdf.js: { str, x, y, w } in Punkt, y wächst nach oben.
// Alle Wörter einer Zeile bekommen die Unterkante der Zeile als y, damit sie zusammenbleiben.
export function tsvToItems(tsv, pageHeightPx, dpi = DPI) {
  const scale = 72 / dpi;
  const lines = new Map();
  const words = [];
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12) continue;
    const [level, , block, par, line, , left, top, width, height, conf] = c.map(Number);
    const key = `${block}.${par}.${line}`;
    if (level === 4) lines.set(key, top + height);
    const str = c[11].trim().replace(/^[|[\]]+|[|[\]]+$/g, '');
    if (level === 5 && str && conf > 10) words.push({ key, str, left, width });
  }
  return words.map((wd) => ({
    str: wd.str,
    x: wd.left * scale,
    y: (pageHeightPx - (lines.get(wd.key) ?? 0)) * scale,
    w: wd.width * scale,
  }));
}

export async function ocrPdfItems(buffer) {
  if (!ocrAvailable()) throw new Error('Texterkennung (tesseract) ist auf dem Server nicht installiert.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pratomat-ocr-'));
  try {
    fs.writeFileSync(path.join(dir, 'plan.pdf'), buffer);
    await run('pdftoppm', ['-r', String(DPI), '-f', '1', '-l', '1', '-gray', '-singlefile', 'plan.pdf', 'page'], { cwd: dir, timeout: 60_000 });
    const img = removeTableLines(fs.readFileSync(path.join(dir, 'page.pgm')));
    fs.writeFileSync(path.join(dir, 'clean.pgm'), img.data);
    const { stdout } = await run('tesseract', ['clean.pgm', 'stdout', '-l', 'deu', '--psm', '6', 'tsv'],
      { cwd: dir, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    return tsvToItems(stdout, img.height);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
