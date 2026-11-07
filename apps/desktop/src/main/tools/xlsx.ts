import { buildZip } from './zip';

/**
 * Small, dependency-free .xlsx writer: one styled sheet with a bold header row,
 * frozen header, auto-filter, fitted column widths, live formulas and a totals row.
 * Excel recalculates every formula when the file opens (fullCalcOnLoad).
 */

export type ColumnType = 'text' | 'number' | 'integer' | 'money' | 'percent' | 'date';

export interface SheetColumn {
  header: string;
  type: ColumnType;
  /** Formula using other columns by header, e.g. "{Budgeted}-{Actual}". Computed columns are never asked for. */
  formula?: string;
  total?: 'sum' | 'average' | 'none';
}

export type CellValue = string | number | null;

export interface SheetSpec {
  title: string;
  sheetName?: string;
  columns: SheetColumn[];
  /** Values for the non-formula columns, in column order. */
  rows: CellValue[][];
  /** Blank rows with formulas ready to fill, when there are fewer data rows than this. */
  minRows?: number;
  totals?: boolean;
}

export const colLetter = (i: number): string => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parses 2026-03-14, 14/03/2026, 14 march 2026, march 14 2026. Returns an Excel serial date. */
export function toExcelDate(v: string): number | null {
  const s = v.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/))) [d, m, y] = [+r[1], MONTHS.indexOf(r[2].slice(0, 3)) + 1, +r[3]];
  else if ((r = s.match(/^([a-z]+) (\d{1,2}) (\d{4})$/))) [m, d, y] = [MONTHS.indexOf(r[1].slice(0, 3)) + 1, +r[2], +r[3]];
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += 2000;
  return Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / 86400000);
}

/** Turns spoken or typed numbers into numbers: "15,000", "₹1500", "12.5%", "3k". */
export function toNumber(v: string): number | null {
  const s = v.trim().toLowerCase().replace(/^(rs\.?|inr|usd|\$|₹|€|£)\s*/, '').replace(/\s*(rupees?|dollars?|euros?|pounds?|rs)$/, '').replace(/,/g, '');
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(k|thousand|lakh|lakhs|l|m|million|crore|cr|%|percent)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, l: 1e5, m: 1e6, million: 1e6, crore: 1e7, cr: 1e7 };
  return m[2] && mult[m[2]] ? n * mult[m[2]] : n;
}

// Style ids (cellXfs order in STYLES below).
const ST = { text: 0, header: 1, money: 2, percent: 3, date: 4, totalLabel: 5, totalMoney: 6, integer: 7, totalInteger: 8, totalPercent: 9, number: 10, totalNumber: 11, totalBlank: 12 } as const;
const bodyStyle: Record<ColumnType, number> = { text: ST.text, number: ST.number, integer: ST.integer, money: ST.money, percent: ST.percent, date: ST.date };
const totalStyle: Record<ColumnType, number> = { text: ST.totalBlank, number: ST.totalNumber, integer: ST.totalInteger, money: ST.totalMoney, percent: ST.totalPercent, date: ST.totalBlank };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="10" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Replaces {Header} references in a formula with cell references on row r. */
export function expandFormula(formula: string, columns: SheetColumn[], r: number): string {
  return formula.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const i = columns.findIndex((c) => c.header.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`Formula refers to unknown column ${name}`);
    return `${colLetter(i)}${r}`;
  });
}

function cell(ref: string, v: CellValue, type: ColumnType, style: number): string {
  if (v === null || v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
  if (type !== 'text') {
    const n = typeof v === 'number' ? v : type === 'date' ? toExcelDate(v) : toNumber(v);
    if (n !== null && Number.isFinite(n)) {
      const val = type === 'percent' && Math.abs(n) > 1 ? n / 100 : n;
      return `<c r="${ref}" s="${style}"><v>${val}</v></c>`;
    }
  }
  return `<c r="${ref}" s="${type === 'text' ? style : ST.text}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

export function buildXlsx(spec: SheetSpec): Buffer {
  const cols = spec.columns;
  if (!cols.length || cols.length > 40) throw new Error('A sheet needs between 1 and 40 columns.');
  const inputCols = cols.map((c, i) => ({ c, i })).filter((x) => !x.c.formula);
  const dataRows = Math.max(spec.rows.length, spec.minRows ?? 0);
  const rowsXml: string[] = [];
  const widths = cols.map((c) => Math.max(10, c.header.length + 4));

  rowsXml.push(`<row r="1" ht="22" customHeight="1">${cols.map((c, i) => cell(`${colLetter(i)}1`, c.header, 'text', ST.header)).join('')}</row>`);
  for (let k = 0; k < dataRows; k++) {
    const r = k + 2;
    const values = spec.rows[k] ?? [];
    const cells: string[] = [];
    cols.forEach((c, i) => {
      const ref = `${colLetter(i)}${r}`;
      if (c.formula) {
        cells.push(`<c r="${ref}" s="${bodyStyle[c.type]}"><f>${esc(expandFormula(c.formula, cols, r))}</f></c>`);
        return;
      }
      const v = values[inputCols.findIndex((x) => x.i === i)] ?? null;
      if (v !== null) widths[i] = Math.min(60, Math.max(widths[i], String(v).length + 2));
      const xml = cell(ref, v, c.type, bodyStyle[c.type]);
      if (xml) cells.push(xml);
    });
    rowsXml.push(`<row r="${r}">${cells.join('')}</row>`);
  }
  const last = dataRows + 1;
  if (spec.totals !== false && dataRows > 0) {
    const r = last + 1;
    const cells = cols.map((c, i) => {
      const ref = `${colLetter(i)}${r}`;
      if (i === 0) return `<c r="${ref}" s="${ST.totalLabel}" t="inlineStr"><is><t>Total</t></is></c>`;
      const kind = c.total ?? (c.type === 'money' ? 'sum' : 'none');
      if (kind === 'none') return `<c r="${ref}" s="${ST.totalBlank}"/>`;
      return `<c r="${ref}" s="${totalStyle[c.type]}"><f>${kind === 'sum' ? 'SUM' : 'AVERAGE'}(${colLetter(i)}2:${colLetter(i)}${last})</f></c>`;
    });
    rowsXml.push(`<row r="${r}">${cells.join('')}</row>`);
  }

  const lastCol = colLetter(cols.length - 1);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastCol}${Math.max(1, last + 1)}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
<autoFilter ref="A1:${lastCol}${Math.max(1, last)}"/>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

  const sheetName = esc((spec.sheetName ?? spec.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet1');
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$1:$${lastCol}$${Math.max(1, last)}</definedName></definedNames>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

  return buildZip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(spec.title)}</dc:title><dc:creator>Clickyy AI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}
