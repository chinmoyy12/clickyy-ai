/**
 * Minimal text-only PDF writer (A4, Helvetica, word-wrapped, multi-page).
 * Characters outside Latin-1 are replaced with "?" because the standard fonts only cover WinAnsi.
 */
const W = 595, H = 842, MARGIN = 56, SIZE = 11, LEAD = 15, TITLE = 18;
const MAX_CHARS = Math.floor((W - 2 * MARGIN) / (SIZE * 0.5));

const esc = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/([\\()])/g, '\\$1');

function wrap(line: string): string[] {
  if (line.length <= MAX_CHARS) return [line];
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(' ')) {
    if ((cur + ' ' + word).trim().length > MAX_CHARS) {
      if (cur) out.push(cur);
      cur = word;
      while (cur.length > MAX_CHARS) { out.push(cur.slice(0, MAX_CHARS)); cur = cur.slice(MAX_CHARS); }
    } else cur = (cur + ' ' + word).trim();
  }
  if (cur) out.push(cur);
  return out;
}

export function buildPdf(title: string, body: string): Buffer {
  const lines = body.replace(/\r/g, '').split('\n').flatMap(wrap);
  const perPage = Math.floor((H - 2 * MARGIN - TITLE - LEAD) / LEAD);
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) pages.push(lines.slice(i, i + perPage));
  const objects: string[] = [];
  const add = (s: string) => objects.push(s) - 1 + 1; // 1-based object numbers
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  pages.forEach((pl, idx) => {
    let y = H - MARGIN;
    let s = '';
    if (idx === 0) { s += `BT /F2 ${TITLE} Tf ${MARGIN} ${y - TITLE} Td (${esc(title)}) Tj ET\n`; y -= TITLE + LEAD; }
    s += `BT /F1 ${SIZE} Tf ${LEAD} TL ${MARGIN} ${y - SIZE} Td\n`;
    for (const l of pl) s += `(${esc(l)}) Tj T*\n`;
    s += 'ET\n';
    s += `BT /F1 8 Tf ${W / 2 - 10} 30 Td (${idx + 1} / ${pages.length}) Tj ET\n`;
    const content = add(`<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}endstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(title)}) /Producer (Clickyy AI) >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
