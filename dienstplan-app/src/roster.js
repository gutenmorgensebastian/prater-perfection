// Dienstplan-Logik: Zellen aus dem PDF (oder aus der Vorschau) in Kalendereinträge übersetzen.
//
// Ein "Grid" ist das gemeinsame Zwischenformat aller Import-Wege:
// {
//   title: "Dienstplan Technik Prater 41. KW 2026",
//   dates: ["2026-10-05", ... 7 Einträge, Montag bis Sonntag],
//   rows:  [{ label: "Bühne", kind: "area", cells: [7 Strings] },
//           { label: "Schröter", kind: "person", cells: ["10:00-18:00", "F 40.2", ...] }]
// }

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Montag der ISO-Kalenderwoche.
export function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => {
  const hh = Number(h), mm = Number(m);
  if (hh > 24 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
};

// Typische Fehler der Scanner-Texterkennung in Uhrzeiten: "18:C)0", "i6:ü0", "O9:3O".
const OCR_DIGITS = { 'C)': '0', '()': '0', O: '0', o: '0', D: '0', 'ü': '0', 'Ü': '0', i: '1', I: '1', l: '1', '|': '1', '!': '1', S: '5', B: '8', Z: '2', z: '2' };
const OCR_RE = /C\)|\(\)|[OoDüÜiIl|!SBZz]/g;

function fixOcrTime(compact) {
  // Nur den Anfang der Zelle korrigieren, solange er nach Uhrzeit aussieht.
  const m = compact.match(/^[0-9:.\-–OoDCc()üÜiIl|!SBZz]+/);
  if (!m) return compact;
  return m[0].replace(OCR_RE, (c) => OCR_DIGITS[c]) + compact.slice(m[0].length);
}

export function normalizeOffCode(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const f = t.replace(/\s/g, '').match(/^F(\d+)\.(\d+)$/i);
  if (f) return `F ${f[1]}.${f[2]}`;
  return t;
}

// Text nach den ersten `n` Nicht-Leerzeichen – z. B. eine Notiz wie "Bühne" hinter der Uhrzeit.
function restAfter(text, n) {
  let i = 0;
  for (; i < text.length && n > 0; i++) if (!/\s/.test(text[i])) n--;
  return text.slice(i).trim();
}

const OFF_RE =/^(F|FÜ|FZA|U|UL|Urlaub|K|krank|frei)\b/i;

// Personen-Zelle: "10:00-18:00" | "F" | "F 40.2" | "FÜ" | "" | freier Text
export function parsePersonCell(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text === '-' || text === '–') return { type: 'empty' };
  const compact = fixOcrTime(text.replace(/\s+/g, ''));
  const m = compact.match(/^(\d{1,2})[:.](\d{2})(?:[-–](\d{1,2})[:.](\d{2}))?(.*)$/);
  if (m) {
    const start = hhmm(m[1], m[2]);
    const end = m[3] ? hhmm(m[3], m[4]) : null;
    if (start && (end || !m[3])) {
      // Die Notiz hinter der Uhrzeit aus dem Originaltext nehmen (die OCR-Korrektur ändert Längen).
      const note = m[5] ? restAfter(text, text.replace(/\s+/g, '').length - m[5].length) : '';
      return { type: 'shift', start, end, note };
    }
  }
  if (OFF_RE.test(text) || /^F\s*\d/.test(text)) return { type: 'off', code: normalizeOffCode(text) };
  return { type: 'note', text };
}

// Veranstaltungs-Zelle: "19:30 VS VB01 HOH" oder "16:00-18:15 VS A YEAR W/O SUMMER ...".
// Mehrere Veranstaltungen in einer Zelle werden an den Uhrzeiten getrennt.
const VENUE_TIME_RE = /(?<=^|\s)(\d{1,2})\s?[:.]\s?(\d{2})(?:\s*[-–]\s*(\d{1,2})\s?[:.]\s?(\d{2}))?/g;

export function parseVenueCell(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const matches = [...text.matchAll(VENUE_TIME_RE)].filter((m) => hhmm(m[1], m[2]));
  if (!matches.length) return [{ start: null, end: null, title: text }];
  const out = [];
  const lead = text.slice(0, matches[0].index).trim();
  matches.forEach((m, i) => {
    const titleEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let title = text.slice(m.index + m[0].length, titleEnd).trim();
    if (i === 0 && lead) title = `${lead} ${title}`.trim();
    out.push({ start: hhmm(m[1], m[2]), end: m[3] ? hhmm(m[3], m[4]) : null, title: title || 'Veranstaltung' });
  });
  return out;
}

function timed(date, start, end) {
  const s = `${date}T${start}`;
  if (!end) return { start: s, end: null };
  const endDate = end <= start ? addDays(date, 1) : date; // Nachtdienst über Mitternacht
  return { start: s, end: `${endDate}T${end === '24:00' ? '23:59' : end}` };
}

// --- Nur Veranstaltungen im Prater ---------------------------------------------------
// Orte, wie sie in Großbuchstaben in Dienst- und Spielplänen vor den Einträgen stehen.
const PLACES = ['PRATER-FOYER', 'PRATER', '3. STOCK', '3.STOCK', 'ROTER SALON', 'GRÜNER SALON', 'STERNFOYER', 'FOYERS', 'VORBÜHNE', 'TREFFPUNKT KASSENHALLE', 'BÜHNE'];
const PLACE_RE = new RegExp(`(?<=^|\\s)(${PLACES.map((p) => p.replace(/\./g, '\\.')).join('|')})(?=\\s|$)`, 'g');
export const isPraterPlace = (place) => /^PRATER/i.test(place || '');
const prettyPlace = (place) => place.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Zerlegt Zelltext an Ortsangaben: "3. STOCK 19:00 … PRATER 20:00 …" -> [{ place, text }].
export function splitByPlaces(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const marks = [...t.matchAll(PLACE_RE)];
  const out = [];
  const lead = t.slice(0, marks[0]?.index ?? t.length).trim();
  if (lead) out.push({ place: null, text: lead });
  marks.forEach((m, i) => out.push({ place: m[1], text: t.slice(m.index + m[0].length, marks[i + 1]?.index ?? t.length).trim() }));
  return out;
}

// Prater-Veranstaltungen aus einer Zelle. defaultPlace: Ort für Text ohne Ortsangabe
// (nur gesetzt, wenn die ganze Zeile zum Prater gehört).
export function venueEntries(cell, defaultPlace = null) {
  const out = [];
  for (const seg of splitByPlaces(cell)) {
    const place = seg.place ? prettyPlace(seg.place) : defaultPlace;
    if (!place || (seg.place && !isPraterPlace(seg.place))) continue;
    // "11-15 interne VA" -> "11:00-15:00 interne VA"
    const text = seg.text.replace(/(^|\s)(\d{1,2})-(\d{1,2})(?=\s)/g, '$1$2:00-$3:00');
    for (const v of parseVenueCell(text)) {
      const parts = v.title.split(' · ');
      const split = v.start && parts.length > 1;
      out.push({ ...v, title: split ? parts[0] : v.title, notes: split ? parts.slice(1).join(' · ') : '', location: place });
    }
  }
  return out;
}

export function venueEvent(date, v) {
  const base = { kind: 'venue', person_id: null, title: v.title, location: v.location, notes: v.notes || '' };
  if (v.start) return { ...base, ...timed(date, v.start, v.end), all_day: 0 };
  return { ...base, start: date, end: addDays(date, 1), all_day: 1 };
}

// Grid -> Liste von Kalendereinträgen. personIds[rowIndex] ordnet Personenzeilen einer Person zu
// (null = Zeile ignorieren).
export function gridToEvents(grid, personIds) {
  const events = [];
  grid.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      const date = grid.dates[c];
      if (!date) return;
      if (row.kind === 'area') {
        for (const v of venueEntries(cell, row.import ? row.label : null)) events.push(venueEvent(date, v));
        return;
      }
      const personId = personIds[r];
      if (!personId) return;
      const p = parsePersonCell(cell);
      if (p.type === 'shift') {
        events.push({ kind: 'shift', person_id: personId, title: p.note ? `Dienst (${p.note})` : 'Dienst', location: '', ...timed(date, p.start, p.end), all_day: 0 });
      } else if (p.type === 'off') {
        const label = p.code.toUpperCase() === 'F' ? 'Frei' : `Frei (${p.code})`;
        events.push({ kind: 'off', person_id: personId, title: label, location: '', start: date, end: addDays(date, 1), all_day: 1 });
      } else if (p.type === 'note') {
        events.push({ kind: 'shift', person_id: personId, title: p.text, location: '', start: date, end: addDays(date, 1), all_day: 1 });
      }
    });
  });
  return events;
}

// Sieht eine Zeile nach Dienstzeiten einer Person aus (statt nach Veranstaltungen)?
export function looksLikePersonRow(cells) {
  const parsed = cells.map(parsePersonCell);
  const clean = parsed.filter((p) => (p.type === 'shift' && !p.note) || p.type === 'off').length;
  const texty = parsed.filter((p) => (p.type === 'shift' && p.note) || p.type === 'note').length;
  return clean >= 3 && texty <= 1;
}

// Prüft und säubert ein Grid, das vom Browser (Vorschau) oder von der KI kommt.
export function sanitizeGrid(input) {
  const dates = Array.isArray(input?.dates) ? input.dates.slice(0, 7).map(String) : [];
  if (dates.length !== 7 || !dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new Error('Die Woche braucht 7 gültige Daten (Montag bis Sonntag).');
  }
  const rows = (Array.isArray(input.rows) ? input.rows : []).map((r) => ({
    label: String(r.label ?? '').trim().slice(0, 100),
    kind: r.kind === 'area' ? 'area' : 'person',
    // Bereichszeile komplett als Prater-Veranstaltungen übernehmen (sonst nur Einträge mit "PRATER")
    import: r.import === undefined ? /prater/i.test(String(r.label ?? '')) : Boolean(r.import),
    cells: Array.from({ length: 7 }, (_, i) => String(r.cells?.[i] ?? '').slice(0, 500)),
  })).filter((r) => r.label);
  return { title: String(input.title ?? '').slice(0, 200), dates, rows };
}
