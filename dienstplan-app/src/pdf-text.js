// Liest die Dienstplan-Tabelle aus der Textebene des PDFs (kostenlos, ohne KI).
// Funktioniert bei PDFs mit Text – auch bei Scans, wenn der Scanner Texterkennung (OCR) gemacht hat.
// Die Erkennung ist nicht perfekt; deshalb gibt es vor dem Veröffentlichen immer eine Vorschau.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isoWeekMonday, addDays, looksLikePersonRow } from './roster.js';

const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
// Datum trotz typischer Lesefehler der Scanner-Texterkennung: "i3.10.2026", "16.10.202ß", "18.'tO.2026".
const DATE_OCR = { i: '1', I: '1', l: '1', '|': '1', '!': '1', t: '1', O: '0', o: '0', D: '0', ü: '0', Ü: '0', C: '0', ß: '6', S: '5', B: '8', Z: '2', z: '2' };
export function ocrDate(str) {
  const s = str.replace(/['`´’"(),]/g, '').replace(/[iIl|!tOoDüÜCßSBZz]/g, (c) => DATE_OCR[c]);
  const m = s.match(DATE_RE);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 31 || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
const WEEKDAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];

// Textstücke mit Position je Seite: [[{ str, x, y, w }], …]
export async function pdfPages(buffer, maxPages = 10) {
  const doc = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width })));
  }
  return pages;
}

export const pdfTextItems = async (buffer) => (await pdfPages(buffer, 1))[0] || [];

// Fasst Textstücke zu Zeilen zusammen (von oben nach unten). Stücke ohne Abstand werden ohne
// Leerzeichen verbunden – Word zerlegt manche Wörter in einzelne Buchstaben ("1" "5" ":" "45").
export function textLines(items) {
  const lines = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < 2.5);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  return lines.sort((a, b) => b.y - a.y).map((line) => {
    let s = '';
    let prevEnd = null;
    for (const it of line.items.sort((a, b) => a.x - b.x)) {
      s += prevEnd !== null && it.x - prevEnd > 0.8 ? ` ${it.str}` : it.str;
      prevEnd = it.x + it.w;
    }
    return s.replace(/\s+/g, ' ').trim();
  });
}

// Kern der Erkennung, getrennt von pdf.js, damit er testbar ist.
// items: [{ str, x, y, w }] in PDF-Koordinaten (y wächst nach oben).
export function itemsToGrid(items) {
  const warnings = [];
  const fullText = items.map((i) => i.str).join(' ');
  let title = (fullText.match(/Dienstplan[^]*?\d{4}/)?.[0] || '').replace(/\s+/g, ' ').slice(0, 120);

  // 1. Spalten über die Datumszeile (oder die Wochentage) finden.
  let headers = items.map((i) => ({ i, date: ocrDate(i.str) })).filter((h) => h.date)
    .map(({ i, date }) => ({ cx: i.x + i.w / 2, y: i.y, date }));
  // Nur Datumsangaben, die in einer Zeile liegen (nicht z. B. "Datum: 21.09.2026" unten).
  if (headers.length) {
    const top = Math.max(...headers.map((h) => h.y));
    headers = headers.filter((h) => top - h.y < 6);
  }
  let dates;
  if (headers.length >= 5) {
    headers.sort((a, b) => a.cx - b.cx);
    // Montag der Woche, die die meisten erkannten Daten stimmen (ein verlesenes Datum stört dann nicht).
    const votes = new Map();
    for (const h of headers) {
      const mon = addDays(h.date, -((new Date(`${h.date}T12:00:00Z`).getUTCDay() + 6) % 7));
      votes.set(mon, (votes.get(mon) || 0) + 1);
    }
    const monday = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    headers = headers.filter((h) => dates.includes(h.date));
  } else {
    headers = items.filter((i) => WEEKDAYS.includes(i.str.toLowerCase()))
      .map((i) => ({ cx: i.x + i.w / 2, y: i.y, day: WEEKDAYS.indexOf(i.str.toLowerCase()) }));
    const kw = fullText.match(/(\d{1,2})\s*\.?\s*KW\s*(\d{4})/i) || fullText.match(/KW\s*(\d{1,2})\D{0,5}(\d{4})/i);
    if (headers.length < 5 || !kw) throw new Error('Die Tabelle wurde im PDF nicht erkannt (keine Datums- oder Wochentagszeile gefunden).');
    const monday = isoWeekMonday(Number(kw[2]), Number(kw[1]));
    dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    warnings.push('Datum aus der Kalenderwoche berechnet – bitte prüfen.');
  }
  if (!title) {
    const d = new Date(`${dates[3]}T12:00:00Z`);
    const kw = Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
    title = `Dienstplan ${kw}. KW ${d.getUTCFullYear()}`;
  }
  const centers = headers.map((h) => h.cx);
  const colWidth = (centers[centers.length - 1] - centers[0]) / (centers.length - 1);
  // Spaltenmitten für alle 7 Tage (fehlende Spalten werden ergänzt).
  const colCenters = Array.from({ length: 7 }, (_, i) => {
    const h = headers.find((hh) => (hh.date ? dates.indexOf(hh.date) : hh.day) === i);
    return h ? h.cx : centers[0] + (i - (headers[0].date ? dates.indexOf(headers[0].date) : headers[0].day)) * colWidth;
  });
  const tableLeft = colCenters[0] - colWidth / 2;
  const headerY = Math.min(...headers.map((h) => h.y));

  // 2. Zeilenbeschriftungen links von der ersten Spalte (Bühne, 3. Stock, Namen ...).
  const body = items.filter((i) => i.y < headerY - 3);
  const labelItems = body.filter((i) => i.x + i.w / 2 < tableLeft).sort((a, b) => b.y - a.y || a.x - b.x);
  const labels = [];
  for (const it of labelItems) {
    const last = labels[labels.length - 1];
    if (last && Math.abs(last.y - it.y) < 3) last.parts.push(it);
    else labels.push({ y: it.y, parts: [it] });
  }
  // Wörter einer Beschriftung von links nach rechts ("Roter Salon", auch wenn "Salon" etwas höher liegt).
  for (const l of labels) l.label = l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ');
  const stop = labels.findIndex((l) => /^\W*datum/i.test(l.label));
  const rowsMeta = (stop >= 0 ? labels.slice(0, stop) : labels).map((l) => ({ ...l, parts: Array.from({ length: 7 }, () => []) }));
  if (!rowsMeta.length) throw new Error('Keine Zeilen (Bereiche oder Namen) im PDF gefunden.');
  const bottomY = stop >= 0 ? labels[stop].y : -Infinity;

  // 3. Jeden Text der passenden Zelle zuordnen: Zeile = nächste Beschriftung, die höchstens
  //    8pt darüber liegt (Zelltext ist oben ausgerichtet), Spalte = nächste Spaltenmitte.
  for (const it of body) {
    const cx = it.x + it.w / 2;
    if (cx < tableLeft || it.y <= bottomY + 2) continue;
    const candidates = rowsMeta.filter((r) => r.y >= it.y - 8);
    const row = candidates[candidates.length - 1];
    if (!row) continue;
    let col = 0;
    colCenters.forEach((c, i) => { if (Math.abs(c - cx) < Math.abs(colCenters[col] - cx)) col = i; });
    if (Math.abs(colCenters[col] - cx) > colWidth * 0.75) continue;
    row.parts[col].push(it);
  }

  const rows = rowsMeta.map((r) => {
    const cells = r.parts.map((parts) => parts
      .sort((a, b) => (Math.abs(a.y - b.y) < 3 ? a.x - b.x : b.y - a.y))
      .map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim());
    return { label: r.label.replace(/^[^\wÄÖÜäöü]+/, '').replace(/\s+/g, ' ').trim(), kind: looksLikePersonRow(cells) ? 'person' : 'area', cells };
  });
  return { grid: { title, dates, rows }, warnings };
}

export async function parseRosterPdfText(buffer) {
  const items = await pdfTextItems(buffer);
  if (items.length < 10) throw new Error('Das PDF enthält keinen lesbaren Text (reiner Bild-Scan). Bitte die KI-Erkennung nutzen oder den Plan in der Vorschau eintragen.');
  return itemsToGrid(items);
}
