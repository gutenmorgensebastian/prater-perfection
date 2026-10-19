// Liest aus dem Monats-Spielplan der Volksbühne alle Veranstaltungen im Prater
// (Einträge, die mit "PRATER" oder "PRATER-FOYER" beginnen – meist in der Spalte "3.Stock & Prater").
import { pdfPages, textLines } from './pdf-text.js';
import { venueEntries } from './roster.js';

const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const DAY_RE = /^(\d{1,2})\.(\d{1,2})\.?$/;

// Text einer Zelle: alle Zeilen hintereinander; ein Trennstrich am Zeilenende verbindet mit der
// nächsten Zeile ("Self-" "Defense").
function cellText(items) {
  let text = '';
  for (const line of textLines(items)) text += !text || /-$/.test(text) ? line : ` ${line}`;
  return text.replace(/\s+/g, ' ').trim();
}

export function spielplanFromPages(pages) {
  const all = pages.flat().map((i) => i.str).join(' ');
  const head = all.match(/Spielplan\s+([A-Za-zäÄ]+)\s+(\d{4})/i);
  const monthIdx = head ? MONTHS.indexOf(head[1].toLowerCase()) : -1;
  const year = head ? Number(head[2]) : null;
  const stand = all.match(/Stand vom\s+(\d{1,2}\.\d{1,2}\.\d{4})/i)?.[1];
  const events = [];

  for (const items of pages) {
    const datumHead = items.find((i) => /^Datum$/i.test(i.str));
    if (!datumHead) continue;
    // Spaltenköpfe in derselben Zeile wie "Datum"
    const headers = items.filter((i) => Math.abs(i.y - datumHead.y) < 3).sort((a, b) => a.x - b.x);
    const firstColX = headers[1]?.x ?? datumHead.x + 25;
    const body = items.filter((i) => i.y < datumHead.y - 4);
    // Zeilen beginnen mit dem Datum in der ersten Spalte ("So," darüber, "01.11." darunter).
    const rows = body.filter((i) => i.x < firstColX - 2 && DAY_RE.test(i.str))
      .map((i) => {
        const [, d, m] = i.str.match(DAY_RE);
        const mm = Number(m);
        let y = year ?? new Date().getFullYear();
        if (monthIdx >= 0 && mm - 1 < monthIdx - 6) y += 1; // Spielplan Dezember mit Januar-Terminen
        return { top: i.y + 9, date: `${y}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`, cells: new Map() };
      })
      .sort((a, b) => b.top - a.top);
    for (const it of body) {
      if (it.x < firstColX - 2) continue;
      const row = rows.filter((r) => r.top >= it.y).pop();
      if (!row) continue;
      const col = headers.filter((h) => h.x <= it.x + 3).pop()?.x ?? 0;
      if (!row.cells.has(col)) row.cells.set(col, []);
      row.cells.get(col).push(it);
    }
    for (const row of rows) {
      for (const parts of row.cells.values()) {
        for (const v of venueEntries(cellText(parts))) events.push({ date: row.date, ...v });
      }
    }
  }
  events.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  const title = head ? `Spielplan ${head[1]} ${head[2]}${stand ? ` (Stand ${stand})` : ''}` : 'Spielplan';
  const month = head && monthIdx >= 0 ? `${year}-${String(monthIdx + 1).padStart(2, '0')}` : (events[0]?.date.slice(0, 7) || '');
  return { title, month, events };
}

export async function parseSpielplanPdf(buffer) {
  const pages = await pdfPages(buffer);
  if (!pages.some((p) => p.length > 10)) throw new Error('Das PDF enthält keinen lesbaren Text.');
  const plan = spielplanFromPages(pages);
  if (!plan.month) throw new Error('Monat des Spielplans nicht erkannt.');
  return plan;
}
