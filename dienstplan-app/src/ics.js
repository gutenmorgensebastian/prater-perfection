// iCalendar-Feed (RFC 5545) zum Abonnieren in Google Kalender, Apple Kalender, Outlook usw.

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const escapeText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

// Zeilen länger als 75 Byte falten (RFC 5545, 3.1).
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const dateValue = (iso) => iso.slice(0, 10).replace(/-/g, '');
const dateTimeValue = (iso) => `${dateValue(iso)}T${iso.slice(11, 13)}${iso.slice(14, 16)}00`;

// events: Zeilen aus der Tabelle "events", jeweils mit person_name (oder null)
export function buildIcs(events, { name = 'Dienstplan', host = 'dienstplan' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dienstplan-App//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`, 'X-WR-TIMEZONE:Europe/Berlin',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (const e of events) {
    const summary = e.person_name ? `${e.person_name}: ${e.title}` : e.title;
    lines.push('BEGIN:VEVENT', `UID:${e.id}@${host}`, `DTSTAMP:${stamp}`);
    if (e.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.start)}`, `DTEND;VALUE=DATE:${dateValue(e.end || e.start)}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Berlin:${dateTimeValue(e.start)}`);
      if (e.end) lines.push(`DTEND;TZID=Europe/Berlin:${dateTimeValue(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(summary)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escapeText(e.notes)}`);
    if (e.kind === 'off') lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
