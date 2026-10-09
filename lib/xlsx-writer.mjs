// Minimal .xlsx writer (no dependencies): inline strings, numbers, dates, formulas with cached values, a few
// fixed styles and column widths. Parts are deflated with node:zlib into a plain zip (valid OOXML; Excel, Numbers,
// LibreOffice and openpyxl read them).
import { deflateRawSync } from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'), packed = deflateRawSync(data), nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, packed); centrals.push(ch, nameBuf); offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
export const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/** Excel serial day for YYYY-MM-DD (1900 date system). */
export const excelDate = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);

// Style ids used by callers (0-6 since M2; 7+ for the M3 sheets, copied from the master's look).
export const STYLE = { none: 0, header: 1, date: 2, aed: 3, usd: 4, rate: 5, title: 6, banner: 7, pct: 8, monthYear: 9, greyLabel: 10, greyDate: 11,
  kpiTeal: 12, kpiRed: 13, kpiNavy: 14, kpiAmber: 15, kpiAed: 16, kpiInt: 17, headerAed: 18, headerPct: 19, note: 20, headerWrap: 21, listHeader: 22, checkNum: 23, checkText: 24,
  fInAed: 25, fInMonth: 26, fInDate: 27, fInInt: 28, fCalcDate: 29, fAed: 30, fMonth: 31, bannerDark: 32 };
const NUMFMTS = { 164: 'dd\\ mmm\\ yyyy', 165: '&quot;AED &quot;#,##0.00;[Red]\\(&quot;AED &quot;#,##0.00\\);\\-', 166: '&quot;USD &quot;#,##0.00;[Red]\\(&quot;USD &quot;#,##0.00\\);\\-', 167: '0.0000', 168: 'mmm\\ yyyy', 169: '0.0%' };
const FONTS = ['<font><sz val="11"/><name val="Calibri"/></font>', '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>', '<font><b/><sz val="14"/><name val="Calibri"/></font>',
  '<font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>', '<font><b/><sz val="16"/><color rgb="FF243247"/><name val="Calibri"/></font>', '<font><b/><sz val="11"/><color rgb="FF243247"/><name val="Calibri"/></font>', '<font><sz val="11"/><color rgb="FF243247"/><name val="Calibri"/></font>'];
const solid = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', solid('FF12213D'), solid('FF13B8A6'), solid('FFF05A67'), solid('FFF4B942'), solid('FFD8D8D8'), solid('FFEAF7F5'), solid('FFFFFFFF'), solid('FFFFF7D6'), solid('FFF6F8FB'), solid('FF11213D')];
// [numFmtId, fontId, fillId, alignment]
const XF = [[0, 0, 0], [0, 1, 2], [164, 0, 0], [165, 0, 0], [166, 0, 0], [167, 0, 0], [0, 2, 0], [0, 3, 2, 'v'], [169, 0, 0], [168, 0, 0], [0, 5, 6, 'v'], [164, 5, 6, 'v'],
  [0, 1, 3, 'c'], [0, 1, 4, 'c'], [0, 1, 2, 'c'], [0, 1, 5, 'c'], [165, 4, 8, 'c'], [1, 4, 8, 'c'], [165, 1, 2], [169, 1, 2], [0, 6, 7, 'w'], [0, 1, 2, 'w'], [0, 0, 6], [4, 6, 0], [0, 6, 0],
  [165, 6, 9], [168, 6, 9], [164, 6, 9], [1, 6, 9], [164, 6, 10], [165, 6, 0], [168, 6, 0], [0, 3, 11, 'v']];
const ALIGN = { v: '<alignment vertical="center"/>', c: '<alignment horizontal="center" vertical="center"/>', w: '<alignment vertical="center" wrapText="1"/>' };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${Object.keys(NUMFMTS).length}">${Object.entries(NUMFMTS).map(([id, f]) => `<numFmt numFmtId="${id}" formatCode="${f}"/>`).join('')}</numFmts>
<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>
<fills count="${FILLS.length}">${FILLS.join('')}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XF.length}">${XF.map(([n, f, fl, a]) => `<xf numFmtId="${n}" fontId="${f}" fillId="${fl}" borderId="0" xfId="0"${n ? ' applyNumberFormat="1"' : ''}${f ? ' applyFont="1"' : ''}${fl ? ' applyFill="1"' : ''}${a ? ` applyAlignment="1">${ALIGN[a]}</xf>` : '/>'}`).join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="1"><dxf><font><color rgb="FF1B5E20"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor rgb="FFD9EAD3"/></patternFill></fill></dxf></dxfs>
</styleSheet>`;

/**
 * A cell is null/undefined (skipped), a string, a number, or { v, s, f } where f is a formula (without "=")
 * and v its cached value (number or string). s is a STYLE id.
 * @param {{name:string, rows:Record<number,(any)[]>, widths?:Record<string,number>, heights?:Record<number,number>, merges?:string[], okHighlight?:string}[]} sheets
 *   rows keyed by 1-based row number; merges like "A1:H1"; heights in points; okHighlight: a range (e.g. "F4:F11")
 *   whose cells containing "OK" get the master's green conditional format
 */
export function writeXlsx(sheets) {
  const files = [];
  files.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
  files.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  files.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`]);
  files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  files.push(['xl/styles.xml', STYLES]);
  sheets.forEach((sh, i) => {
    const cols = Object.entries(sh.widths ?? {}).map(([c, w]) => { const n = c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0); return `<col min="${n}" max="${n}" width="${w}" customWidth="1"/>`; }).join('');
    const rowsXml = Object.keys(sh.rows).map(Number).sort((a, b) => a - b).map(r => {
      const cells = sh.rows[r].map((cell, c) => {
        if (cell === null || cell === undefined || cell === '') return '';
        const ref = colName(c) + r;
        const o = typeof cell === 'object' ? cell : { v: cell };
        const s = o.s ? ` s="${o.s}"` : '';
        if (o.f) return typeof o.v === 'string' ? `<c r="${ref}"${s} t="str"><f>${esc(o.f)}</f><v>${esc(o.v)}</v></c>` : `<c r="${ref}"${s}><f>${esc(o.f)}</f>${o.v == null ? '' : `<v>${o.v}</v>`}</c>`;
        if (typeof o.v === 'number') return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
      }).join('');
      const ht = sh.heights?.[r];
      return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowsXml}</sheetData>${sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}${sh.okHighlight ? `<conditionalFormatting sqref="${sh.okHighlight}"><cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="OK"><formula>NOT(ISERROR(SEARCH("OK",${sh.okHighlight.split(':')[0]})))</formula></cfRule></conditionalFormatting>` : ''}</worksheet>`]);
  });
  return zip(files);
}
