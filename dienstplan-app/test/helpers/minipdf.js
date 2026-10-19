// Erzeugt ein einfaches PDF mit Text an festen Positionen (für Tests, ohne echte Pläne im Repository).
export function makePdf(items, { width = 595, height = 842 } = {}) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = items.map(({ str, x, y, size = 8 }) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(str)}) Tj ET`).join('\n');
  const contentBytes = Buffer.from(content, 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    null, // Inhalt
  ];
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objects.forEach((obj, i) => {
    const body = obj === null
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`, 'latin1'), contentBytes, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1');
    offsets.push(pos);
    parts.push(body);
    pos += body.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

// Baut eine E-Mail (MIME) mit PDF-Anhängen.
export function makeEmail({ from, subject, messageId, pdfs }) {
  const b = 'GRENZE123';
  const lines = [`From: ${from}`, 'To: dienstplan@example.de', `Subject: ${subject}`, `Message-ID: <${messageId}>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`, '', `--${b}`, 'Content-Type: text/plain; charset=utf-8', '', 'Siehe Anhang.'];
  for (const { name, data } of pdfs) {
    lines.push(`--${b}`, `Content-Type: application/pdf; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64', '', data.toString('base64').replace(/.{76}/g, '$&\r\n'));
  }
  lines.push(`--${b}--`, '');
  return Buffer.from(lines.join('\r\n'));
}
