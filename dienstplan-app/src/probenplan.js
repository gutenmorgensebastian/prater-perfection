// Liest Probenpläne (z. B. „Endproben P01 Perfection“): Tabelle mit einer Zeile pro Tag und einer
// Spalte pro Ort ("Prater Bühne", "Probebühne Prater"). Jede Zeile mit Uhrzeit wird ein Termin.
import { pdfPages, textLines } from './pdf-text.js';

const DAY_RE = /^(\d{1,2})\.(\d{1,2})\.$/;
const WEEKDAY_RE = /^(Mo|Di|Mi|Do|Fr|Sa|So)\.?,?$/i;
const LINE_TIME_RE = /^(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*-\s*(\d{1,2})\s*[:.]\s*(\d{2}))?\s*(.*)$/;
const pad = (n) => String(n).padStart(2, '0');

function yearFor(month, stand) {
  if (!stand) return new Date().getFullYear();
  return month < stand.month - 6 ? stand.year + 1 : month > stand.month + 6 ? stand.year - 1 : stand.year;
}

// Zeilen einer Zelle -> Termine. Zeilen ohne Uhrzeit gehören zum Termin davor.
export function entriesFromLines(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(LINE_TIME_RE);
    if (m && Number(m[1]) < 25) {
      out.push({ start: `${pad(m[1])}:${m[2]}`, end: m[3] ? `${pad(m[3])}:${m[4]}` : null, title: m[5].trim() || 'Probe' });
    } else if (out.length) {
      out[out.length - 1].title += ` ${line}`;
    } else if (line) {
      out.push({ start: null, end: null, title: line });
    }
  }
  return out;
}

export function probenplanFromPages(pages) {
  const all = pages.flat();
  const allText = all.map((i) => i.str).join(' ');
  const standM = allText.match(/Stand:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  const stand = standM ? { month: Number(standM[2]), year: Number(standM[3]) } : null;
  const title = (textLines(pages[0] || []).find((l) => /probe/i.test(l)) || 'Probenplan').slice(0, 120);
  const events = [];
  let footerItems = [];

  for (const items of pages) {
    // Tage = Datum mit Wochentag darüber ("Do." / "17.09."). Ein Datum in einer Fußnote zählt nicht.
    const hasWeekday = (d) => items.some((i) => WEEKDAY_RE.test(i.str) && Math.abs(i.x - d.x) < 10 && i.y > d.y && i.y - d.y < 15);
    let dayItems = items.filter((i) => DAY_RE.test(i.str));
    if (dayItems.some(hasWeekday)) dayItems = dayItems.filter(hasWeekday);
    if (!dayItems.length) continue;
    const dateX = Math.min(...dayItems.map((i) => i.x)) + 30; // alles rechts davon ist Tabelleninhalt
    // Zeilenanfang = Wochentag ("Do.") über dem Datum, sonst das Datum selbst
    const rows = dayItems.map((d) => {
      const wd = items.find((i) => WEEKDAY_RE.test(i.str) && Math.abs(i.x - d.x) < 10 && i.y > d.y && i.y - d.y < 15);
      const [, dd, mm] = d.str.match(DAY_RE);
      return { top: (wd ? wd.y : d.y) + 4, date: `${yearFor(Number(mm), stand)}-${pad(mm)}-${pad(dd)}`, items: [] };
    }).sort((a, b) => b.top - a.top);
    const firstTop = rows[0].top;
    const lastRowY = Math.min(...dayItems.map((i) => i.y));

    // Spaltenköpfe: Textzeile direkt über der ersten Tageszeile, rechts der Datumsspalte
    const headY = Math.min(...items.filter((i) => i.y > firstTop && i.x > dateX).map((i) => i.y));
    const heads = [];
    for (const h of items.filter((i) => Math.abs(i.y - headY) < 2 && i.x > dateX).sort((a, b) => a.x - b.x)) {
      const last = heads[heads.length - 1];
      if (last && h.x - (last.x + last.w) < 15) { last.label += ` ${h.str}`; last.w = h.x + h.w - last.x; } else heads.push({ x: h.x, w: h.w, label: h.str });
    }

    for (const it of items) {
      if (it.y > firstTop) continue; // Überschrift
      if (it.x < dateX) {
        if (it.y < lastRowY - 12 && !WEEKDAY_RE.test(it.str)) footerItems.push(it);
        continue;
      }
      const row = rows.filter((r) => r.top >= it.y).pop();
      if (row) row.items.push(it);
    }
    // Unter der letzten Tageszeile: Alles nach einer größeren Lücke ist Fußnote, nicht Tabelle.
    const last = rows[rows.length - 1];
    const ys = [...new Set(last.items.map((i) => Math.round(i.y)))].sort((a, b) => b - a);
    const cut = ys.find((y, k) => k > 0 && ys[k - 1] - y > 18);
    if (cut !== undefined) {
      footerItems = footerItems.concat(last.items.filter((i) => i.y <= cut));
      last.items = last.items.filter((i) => i.y > cut);
    }
    for (const row of rows) {
      for (const [i, h] of heads.entries()) {
        const next = heads[i + 1]?.x ?? Infinity;
        const parts = row.items.filter((it) => it.x >= h.x - 5 && it.x < next - 5);
        // Text, der am Zeilenende unter den nächsten Tag rutscht, gehört nicht dazu
        for (const e of entriesFromLines(textLines(parts))) events.push({ date: row.date, ...e, location: h.label });
      }
    }
  }

  // Fußnote wie "Vor TE: 07.09. von 08-16"
  for (const line of textLines(footerItems)) {
    const m = line.match(/^(.+?):\s*(\d{1,2})\.(\d{1,2})\.?\s*(?:von\s*)?(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/i);
    if (m) {
      events.push({
        date: `${yearFor(Number(m[3]), stand)}-${pad(m[3])}-${pad(m[2])}`,
        start: `${pad(m[4])}:${m[5] || '00'}`, end: `${pad(m[6])}:${m[7] || '00'}`, title: m[1].trim(), location: 'Prater',
      });
    }
  }
  events.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  return { title: standM ? `${title} (Stand ${standM[0].replace(/^Stand:?\s*/i, '')})` : title, key: title, events };
}

export async function parseProbenplanPdf(buffer) {
  const plan = probenplanFromPages(await pdfPages(buffer));
  if (!plan.events.length) throw new Error('Keine Termine im Probenplan gefunden.');
  return plan;
}
