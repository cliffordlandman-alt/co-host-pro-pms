// Template-based .xlsx writer: the master workbook's own parts (styles, theme, column widths, row heights, merges,
// conditional formats, data validations, freeze panes, drawings and charts) are the output; only data cells are
// written, each with the style the master uses at that position. Sections whose length differs from the master
// (more properties, months, checks...) are mapped with row segments, so the master's look repeats row by row and
// everything below (totals, merges, validations, chart ranges, drawing anchors) moves with them.
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { zip, colName } from './xlsx-writer.mjs';

function addSheet(parts, name, cloneOf) {
  const esc = x => x.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let wb = parts['xl/workbook.xml'], rels = parts['xl/_rels/workbook.xml.rels'];
  const src = wb.match(new RegExp(`<sheet [^>]*name="${esc(cloneOf)}"[^>]*>`));
  if (!src) throw new Error(`template has no sheet ${cloneOf}`);
  const rid = attr(src[0], 'r:id'), rel = rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*>`))[0], target = attr(rel, 'Target');
  const srcPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const nums = Object.keys(parts).map(k => /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(k)?.[1]).filter(Boolean).map(Number);
  const n = Math.max(0, ...nums) + 1, path = `xl/worksheets/sheet${n}.xml`, newRid = `rIdAdded${n}`;
  const ids = [...wb.matchAll(/<sheet [^>]*sheetId="(\d+)"/g)].map(x => Number(x[1]));
  parts[path] = String(parts[srcPath])
    .replace(/<sheetData\s*\/>|<sheetData>[\s\S]*?<\/sheetData>/, '<sheetData/>')
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>|<conditionalFormatting[\s\S]*?<\/conditionalFormatting>|<dataValidations[\s\S]*?<\/dataValidations>|<autoFilter[^>]*\/>|<autoFilter[\s\S]*?<\/autoFilter>|<drawing [^>]*\/>|<legacyDrawing [^>]*\/>|<tableParts[\s\S]*?<\/tableParts>|<hyperlinks>[\s\S]*?<\/hyperlinks>/g, '')
    .replace(/ tabSelected="1"/g, '');
  const ns = /xmlns:r=/.test(src[0]) ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : '';
  parts['xl/workbook.xml'] = wb.replace('</sheets>', `<sheet${ns} name="${esc(name)}" sheetId="${Math.max(0, ...ids) + 1}" state="visible" r:id="${newRid}"/></sheets>`);
  parts['xl/_rels/workbook.xml.rels'] = rels.replace('</Relationships>', `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target.startsWith('/') ? `/${path}` : path.slice(3)}" Id="${newRid}"/></Relationships>`);
  parts['[Content_Types].xml'] = String(parts['[Content_Types].xml']).replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
}

/** Parts of a zip (stored or deflated) by name, as Buffers. Reads the central directory. */
export function unzipParts(buf) {
  let eocd = buf.length - 22; while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const out = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(lho + 26), lxlen = buf.readUInt16LE(lho + 28), data = buf.slice(lho + 30 + lnlen + lxlen, lho + 30 + lnlen + lxlen + csize);
    out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const cache = new Map();
/** Template parts ({ path: xml text }) from the generated gzip+base64 module. */
export function loadTemplate(gzB64) {
  if (!cache.has(gzB64)) cache.set(gzB64, JSON.parse(gunzipSync(Buffer.from(gzB64, 'base64')).toString('utf8')));
  return cache.get(gzB64);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colNum = c => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const attr = (s, k) => { const m = s.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`)); return m ? m[1] : undefined; };

/** Row mapping for one sheet from segments [{ our: [a, b], master: [c, d] }] (sorted, non-overlapping). Outside the
 *  segments rows keep the offset of the last segment above (identity above the first). */
export function rowMapper(segments = []) {
  const segs = [...segments].sort((x, y) => x.our[0] - y.our[0]);
  const toMaster = n => {
    let shift = 0;
    for (const { our: [a, b], master: [c, d] } of segs) {
      if (n < a) break;
      if (n <= b) return n === b && b > a ? d : c + Math.min(n - a, Math.max(0, d - c - 1));
      shift = b - d;
    }
    return n - shift;
  };
  const fromMaster = m => {
    let shift = 0;
    for (const { our: [a, b], master: [c, d] } of [...segs].sort((x, y) => x.master[0] - y.master[0])) {
      if (m < c) break;
      if (m <= d) { if (m === d) return b; const n = a + (m - c); return n < b ? n : null; }
      shift = b - d;
    }
    return m + shift;
  };
  return { toMaster, fromMaster };
}

function parseRows(xml) {
  const rows = new Map();
  const re = /<row ([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let m;
  while ((m = re.exec(xml))) {
    const r = Number(attr(m[1], 'r')), cells = new Map();
    const rowAttrs = m[1].replace(/(^|\s)r="\d+"/, '').replace(/(^|\s)spans="[^"]*"/, '').trim();
    const cre = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let c;
    while ((c = cre.exec(m[2] ?? ''))) {
      const ref = attr(c[1], 'r'), col = ref.replace(/\d+/g, '');
      cells.set(col, { s: attr(c[1], 's'), t: attr(c[1], 't'), inner: c[2] ?? '' });
    }
    rows.set(r, { attrs: rowAttrs, cells });
  }
  return rows;
}

function cellXml(ref, o, s) {
  const sa = s != null ? ` s="${s}"` : '';
  if (o.f) return typeof o.v === 'string' ? `<c r="${ref}"${sa} t="str"><f>${esc(o.f)}</f><v>${esc(o.v)}</v></c>` : `<c r="${ref}"${sa}><f>${esc(o.f)}</f>${o.v == null || Number.isNaN(o.v) ? '' : `<v>${o.v}</v>`}</c>`;
  if (typeof o.v === 'number') return `<c r="${ref}"${sa}><v>${o.v}</v></c>`;
  if (typeof o.v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${o.v ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
}

/** Rewrite every "Sheet!$A$1:$B$9" reference in a text through that sheet's row mapping (master rows -> output rows). */
function mapRefs(text, mappers, unescape = false) {
  return text.replace(/((?:&apos;|')([^'&]+?)(?:&apos;|')|\b([A-Za-z][A-Za-z ]*?))!(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g,
    (all, q, quoted, bare, d1, c1, d2, r1, d3, c2, d4, r2) => {
      const name = (quoted ?? bare ?? '').replace(/&amp;/g, '&'), mp = mappers[name];
      if (!mp) return all;
      let a = mp.fromMaster(Number(r1)), b = r2 ? mp.fromMaster(Number(r2)) : null;
      if (a == null) a = Number(r1); if (r2 && b == null) b = a;
      return `${q ?? bare}!${d1}${c1}${d2}${a}${r2 ? `:${d3}${c2}${d4}${b}` : ''}`;
    });
}

/** Map an sqref / ref list ("A1:H1 C5") on the same sheet. */
function mapSqref(sq, mp) {
  return sq.split(/\s+/).map(part => part.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (all, d1, c, d2, r) => { const n = mp.fromMaster(Number(r)); return `${d1}${c}${d2}${n ?? r}`; })).join(' ');
}

/**
 * @param {Record<string,string>} tpl template parts
 * @param {{ name: string, rows: Record<number, any[]>, segments?: {our:[number,number], master:[number,number]}[],
 *   keep?: [number, number][], styleCols?: Record<string,string>, roleStyle?: (s:any)=>string|undefined,
 *   cols?: string, extraMerges?: string[] }[]} sheets  rows keyed by output row; cells null | string | number | {v,f,s}
 */
export function fillTemplate(tpl, sheets) {
  const parts = { ...tpl };
  // Sheets the master doesn't have (spec.cloneOf = a master sheet whose page setup / defaults they take) are added at
  // the end, blank: no cells, merges, formats, validations or drawings of the source.
  for (const sh of sheets.filter(x => x.cloneOf)) addSheet(parts, sh.name, sh.cloneOf);
  const wb = parts['xl/workbook.xml'], rels = parts['xl/_rels/workbook.xml.rels'];
  const relTarget = id => { const m = rels.match(new RegExp(`<Relationship [^>]*Id="${id}"[^>]*>`)) ?? rels.match(new RegExp(`<Relationship [^>]*Target="[^"]*"[^>]*Id="${id}"[^>]*>`)); const t = attr(m[0], 'Target'); return t.startsWith('/') ? t.slice(1) : `xl/${t}`; };
  const sheetPath = {};
  for (const m of wb.matchAll(/<sheet [^>]*>/g)) sheetPath[attr(m[0], 'name').replace(/&amp;/g, '&')] = relTarget(attr(m[0], 'r:id'));
  const mappers = Object.fromEntries(sheets.map(s => [s.name, rowMapper(s.segments)]));

  for (const sh of sheets) {
    const p = sheetPath[sh.name]; if (!p) throw new Error(`template has no sheet ${sh.name}`);
    const xml = parts[p], mp = mappers[sh.name];
    const i0 = xml.indexOf('<sheetData'), selfClosing = /^<sheetData\s*\/>/.test(xml.slice(i0));
    const i1 = selfClosing ? xml.indexOf('>', i0) + 1 : xml.indexOf('</sheetData>') + '</sheetData>'.length;
    let head = xml.slice(0, i0), tail = xml.slice(i1);
    const inner = selfClosing ? '' : xml.slice(xml.indexOf('>', i0) + 1, xml.indexOf('</sheetData>'));
    const master = parseRows(inner), masterMax = Math.max(0, ...master.keys());
    const ourRows = Object.keys(sh.rows).map(Number), ourMax = Math.max(0, ...ourRows);
    const keep = m => (sh.keep ?? []).some(([a, b]) => m >= a && m <= b);
    // Output rows: every master row (moved through the mapping) plus ours.
    const outRows = new Set(ourRows);
    for (const m of master.keys()) { const n = mp.fromMaster(m); if (n != null) outRows.add(n); }
    let maxCol = 1;
    const rowsXml = [...outRows].sort((a, b) => a - b).map(n => {
      const m = mp.toMaster(n), mr = master.get(m), cells = new Map();
      if (mr) for (const [col, c] of mr.cells) cells.set(col, keep(m) && c.inner ? `<c r="${col}${n}"${c.s != null ? ` s="${c.s}"` : ''}${c.t ? ` t="${c.t}"` : ''}>${c.inner}</c>` : `<c r="${col}${n}"${c.s != null ? ` s="${c.s}"` : ''}/>`);
      (sh.rows[n] ?? []).forEach((cell, ci) => {
        if (cell === null || cell === undefined || cell === '') return;
        const col = colName(ci), o = typeof cell === 'object' ? cell : { v: cell };
        if (!o.f && (o.v === '' || o.v == null)) return;
        let s = sh.roleStyle ? sh.roleStyle(o.s) : undefined;
        if (s === undefined) { const alias = sh.styleCols?.[col] ?? col; s = mr?.cells.get(alias)?.s ?? mr?.cells.get(col)?.s; }
        cells.set(col, cellXml(`${col}${n}`, o, s));
      });
      const ordered = [...cells.entries()].sort((x, y) => colNum(x[0]) - colNum(y[0]));
      if (ordered.length) maxCol = Math.max(maxCol, colNum(ordered[ordered.length - 1][0]));
      return `<row r="${n}"${mr?.attrs ? ` ${mr.attrs}` : ''}>${ordered.map(x => x[1]).join('')}</row>`;
    }).join('');
    const lastRow = Math.max(ourMax, ...[...outRows]);
    head = head.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${colName(maxCol - 1)}${lastRow}"/>`);
    if (sh.cols != null) head = head.replace(/<cols>[\s\S]*?<\/cols>/, sh.cols);
    // Merges, conditional formats, validations, auto filter: master refs moved with the rows; extra merges added.
    tail = tail.replace(/<mergeCell ref="([^"]+)"\/>/g, (all, r) => `<mergeCell ref="${mapSqref(r, mp)}"/>`);
    if (sh.extraMerges?.length) {
      const have = new Set([...tail.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map(x => x[1]));
      const add = sh.extraMerges.filter(x => !have.has(x));
      if (add.length) tail = /<mergeCells/.test(tail) ? tail.replace('</mergeCells>', `${add.map(x => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>`) : tail.replace(/^((?:<sheetCalcPr[^>]*\/>|<sheetProtection[^>]*\/>|<protectedRanges>[\s\S]*?<\/protectedRanges>|<scenarios>[\s\S]*?<\/scenarios>|<autoFilter[\s\S]*?<\/autoFilter>|<autoFilter[^>]*\/>|<sortState[\s\S]*?<\/sortState>|<dataConsolidate[\s\S]*?<\/dataConsolidate>|<customSheetViews>[\s\S]*?<\/customSheetViews>)*)/, `$1<mergeCells count="0">${add.map(x => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>`);
    }
    tail = tail.replace(/<mergeCells count="\d+">([\s\S]*?)<\/mergeCells>/, (all, body) => `<mergeCells count="${(body.match(/<mergeCell /g) ?? []).length}">${body}</mergeCells>`);
    tail = tail.replace(/sqref="([^"]+)"/g, (all, r) => `sqref="${mapSqref(r, mp)}"`).replace(/<autoFilter ref="([^"]+)"/g, (all, r) => `<autoFilter ref="${mapSqref(r, mp)}"`)
      .replace(/<sortState ref="([^"]+)"/g, (all, r) => `<sortState ref="${mapSqref(r, mp)}"`).replace(/<sortCondition ([^>]*)ref="([^"]+)"/g, (all, a, r) => `<sortCondition ${a}ref="${mapSqref(r, mp)}"`);
    parts[p] = head + `<sheetData>${rowsXml}</sheetData>` + tail;
    // Drawing anchors on this sheet move with the rows.
    const relPath = p.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
    if (parts[relPath]) for (const m of parts[relPath].matchAll(/Target="([^"]*drawings\/[^"]+)"/g)) {
      const dp = `xl/drawings/${m[1].split('/').pop()}`;
      if (parts[dp]) parts[dp] = parts[dp].replace(/<xdr:row>(\d+)<\/xdr:row>/g, (all, r) => `<xdr:row>${(mp.fromMaster(Number(r) + 1) ?? Number(r) + 1) - 1}</xdr:row>`);
    }
  }
  // References across the workbook (validation lists, chart series, defined names) follow the row mappings.
  for (const k of Object.keys(parts)) {
    if (/^xl\/charts\/chart\d+\.xml$/.test(k)) parts[k] = parts[k].replace(/<c:f>([^<]*)<\/c:f>/g, (all, f) => `<c:f>${mapRefs(f, mappers)}</c:f>`).replace(/<c:(?:numCache|strCache)\/>/g, '');
    else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) parts[k] = parts[k].replace(/<formula1>([^<]*)<\/formula1>/g, (all, f) => `<formula1>${mapRefs(f, mappers)}</formula1>`);
  }
  parts['xl/workbook.xml'] = wb.replace(/<definedName ([^>]*)>([^<]*)<\/definedName>/g, (all, a, f) => `<definedName ${a}>${mapRefs(f, mappers)}</definedName>`);
  parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('application/vnd.ms-excel.sheet.macroEnabled.main+xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')
    .replace(/<Override PartName="\/xl\/vbaProject\.bin"[^>]*\/>/, '').replace(/<Default Extension="bin"[^>]*\/>/, '');
  const order = ['[Content_Types].xml', '_rels/.rels'];
  return zip([...order.filter(k => parts[k] != null), ...Object.keys(parts).filter(k => !order.includes(k)).sort()].map(k => [k, parts[k]]));
}
