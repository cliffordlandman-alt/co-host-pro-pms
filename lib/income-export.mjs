// Income per property export (Excel .xlsx and PDF), built from the same report the page shows. No dependencies:
// a small zip writer for the xlsx and a plain text PDF writer (Helvetica). Read-only.
import zlib from 'node:zlib';
import { PRODUCT_FULL } from './brand.mjs';

const r2 = v => Math.round(Number(v || 0) * 100) / 100;
const fmt = (v, c) => `${c} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodTitle = p => p.kind === 'month' ? `${MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}` : `Year ${p.year}`;
export const exportFileName = (p, ext) => `income-per-property-${p.kind === 'month' ? p.month : p.year}.${ext}`;

/** Rows (arrays of cells) for each section; shared by xlsx and PDF so both show exactly the same. */
export function exportModel(report, bookingsByProperty = {}, { generatedAt = new Date() } = {}) {
  const p = report.period, title = `Income per property · ${periodTitle(p)}`;
  const head = [[PRODUCT_FULL], [title], [`Checkouts ${p.start} – ${p.end}. Each booking counts in the month the guest checks out, as on owner statements.`], [`Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · read-only export`], []];
  const summary = [...head];
  for (const t of report.totals ?? []) {
    const c = t.currency;
    summary.push([`${c} properties`], [`${t.properties} with income · ${t.bookings} bookings · ${t.nights} nights`]);
    if (t.range) summary.push([`Checkouts ${t.range.start} – ${t.range.end}${t.range.firstCheckIn ? ` · stays counted ${t.range.firstCheckIn} – ${t.range.lastCheckOut}` : ''}`]);
    if (t.propertyNames?.length) summary.push([t.propertyNames.join(' | ')]);
    const L = (label, v) => summary.push([label, c, r2(v)]);
    L('Gross booking income', t.gross); L('Airbnb host fees', -Math.abs(t.airbnbFees)); L('Net payout', t.netPayout);
    if (t.otherDeductions) L('VAT, tourism, cleaning & owner expenses', -Math.abs(t.otherDeductions));
    L('Management fee', t.managementFee); L('Owner share', t.ownerShare); L('Net to company', t.companyNet);
    const notes = [];
    if (Math.abs(t.unexplained) >= 0.01) notes.push(`Doesn't add up: ${fmt(t.unexplained, c)} not explained.`);
    if (Math.abs(t.feeDifference) >= 0.01) notes.push(`Fee settings on net payout give ${fmt(t.expectedManagementFee, c)}; the bookings carry ${fmt(t.managementFee, c)}. Re-save them on Verify to recalculate.`);
    if (t.missingAmounts > 0) notes.push(`${t.missingAmounts} booking${t.missingAmounts === 1 ? '' : 's'} missing amounts (no gross or Airbnb host fee) and not in these figures.`);
    if (t.unverifiedBookings > 0) notes.push(`${t.unverifiedBookings} booking${t.unverifiedBookings === 1 ? '' : 's'} not verified yet and not in these figures.${t.unverifiedEstimate ? ` Airbnb host payouts recorded for them: ${fmt(t.unverifiedEstimate, c)} (estimate, not the guest total).` : ''}`);
    for (const n of notes) summary.push([`Note: ${n}`]);
    summary.push([]);
  }
  for (const o of report.companyOther ?? []) if (o.income || o.costs) summary.push([`Company income not tied to a property (${o.currency})`, o.currency, r2(o.net)]);
  const PH = ['Property', 'Owner', 'Currency', 'Bookings', 'Nights', 'Occupancy %', 'Gross booking income', 'VAT & tourism', 'Channel fees', 'Cleaning & expenses', 'Company fee', 'Owner share', 'Net to company', 'AED equivalent (gross)', 'AED equivalent (owner share)', 'FX note', 'Notes'];
  const props = [[PRODUCT_FULL], [title], [], PH];
  const bookings = [[PRODUCT_FULL], [title], [], ['Property', 'Code', 'Guest', 'Platform', 'Check-in', 'Check-out', 'Nights', 'Currency', 'Verified', 'Gross', 'VAT', 'Tourism fee', 'Channel fees', 'Cleaning', 'Management fee', 'Owner amount', 'Co-host payout', 'Estimate (unverified)']];
  for (const x of report.properties ?? []) {
    const note = [x.estimate ? `${x.unverified.count} not verified (${x.unverified.nights} nights)${x.unverified.estimates?.length ? `: Airbnb payouts ${x.unverified.estimates.map(e => fmt(e.amount, e.currency)).join(' + ')} (estimate)` : ''}` : '', x.missingAmounts ? `${x.missingAmounts} missing amounts` : '', x.held ? `Held: ${x.held}` : ''].filter(Boolean).join('; ');
    const rows = (x.rows ?? []).filter(r => r.bookings > 0 || ['gross', 'cleaning', 'expenses', 'managementFee', 'ownerShare', 'companyIncome', 'companyCosts'].some(k => r[k]));
    if (!rows.length) props.push([x.name, x.ownerName ?? '', x.currency, 0, 0, x.occupancy?.percent ?? 0, '', '', '', '', '', '', '', '', '', '', note || 'No bookings checked out in this period']);
    for (const r of rows) {
      const fx = r.aedEquivalent;
      props.push([x.name, x.ownerName ?? '', r.currency, r.bookings, r.nights, x.occupancy?.percent ?? 0, r2(r.gross), r2(r.taxes), r2(r.channelFees), r2(r.cleaning + r.expenses), r2(r.managementFee), r2(r.ownerShare), r2(r.companyNet),
        fx ? r2(fx.gross) : '', fx ? r2(fx.ownerShare) : '', fx ? `Display only: 1 ${r.currency} = ${fx.rate} AED as of ${String(fx.asOf).slice(0, 10)}` : '', note]);
    }
    for (const b of bookingsByProperty[x.propertyId] ?? []) bookings.push([x.name, b.code ?? '', b.guestName ?? '', b.platform ?? '', b.checkIn ?? '', b.checkOut ?? '', Number(b.nights || 0), b.currency ?? x.currency, b.verified ? 'Yes' : 'No',
      ...(b.verified ? [b.grossAmount, b.vatAmount, b.tourismFee, b.channelAmount, b.cleaningFee, b.managementAmount, b.ownerAmount, b.cohostPayout ?? ''].map(v => v === '' ? '' : r2(v)) : ['', '', '', '', '', '', '', '']),
      b.verified ? '' : (b.estimate && typeof b.estimate === 'object' ? fmt(b.estimate.amount, b.estimate.currency) : b.estimate ?? 'not verified')]);
  }
  return { title, sheets: [{ name: 'Summary', rows: summary, widths: [48, 10, 16], money: [2] }, { name: 'Properties', rows: props, widths: [34, 22, 9, 9, 7, 11, 16, 13, 13, 16, 13, 13, 14, 16, 16, 40, 50], money: [6, 7, 8, 9, 10, 11, 12, 13, 14] }, { name: 'Bookings', rows: bookings, widths: [30, 14, 22, 10, 11, 11, 7, 9, 8, 12, 10, 11, 12, 10, 14, 13, 13, 22], money: [9, 10, 11, 12, 13, 14, 15, 16] }] };
}

// ── xlsx ──
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
function sheetXml({ rows, widths, money = [] }) {
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => v === '' || v == null ? '' : typeof v === 'number'
    ? `<c r="${col(j)}${i + 1}"${money.includes(j) || !Number.isInteger(v) ? ' s="1"' : ''}><v>${v}</v></c>` : `<c r="${col(j)}${i + 1}" t="inlineStr"${i < 2 ? ' s="2"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text), data = zlib.deflateRawSync(raw), nb = Buffer.from(name), crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0x21, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0x21, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, data); central.push(c, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
export function toXlsx(model) {
  const S = model.sheets;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${S.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(model.title)}</dc:title><dc:creator>${esc(PRODUCT_FULL)}</dc:creator></cp:coreProperties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${S.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${S.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${S.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf numFmtId="164" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`],
    ...S.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]);
}

// ── PDF (A4 landscape, Helvetica, text lines) ──
const pdfText = s => String(s).replace(/[−–—]/g, '-').replace(/[·•]/g, '-').replace(/≈/g, '~').replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, c => '\\' + c);
const cellText = (v, m) => typeof v === 'number' ? (Number.isInteger(v) && !m ? String(v) : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : String(v ?? '');
export function toPdf(model) {
  const W = 842, H = 595, M = 32, lines = [];
  const wrap = (s, n) => { const out = []; let cur = ''; for (const w of String(s).split(' ')) { if ((cur + ' ' + w).trim().length > n) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out.length ? out : ['']; };
  const add = (text, size = 8, bold = false, x = M) => lines.push({ text, size, bold, x });
  add(PRODUCT_FULL, 14, true); add(model.title, 11, true);
  for (const s of model.sheets) {
    add('', 6); add(s.name, 11, true);
    for (const r of s.rows.slice(s.name === 'Summary' ? 2 : 3)) {
      if (!r.length) { add('', 5); continue; }
      if (s.name === 'Summary') { if (r.length === 3) add(`${r[0]}`.padEnd(46) + ` ${r[1]} ${cellText(r[2], true).padStart(14)}`, 8, false); else for (const l of wrap(r[0], 150)) add(l, 8, /properties$/.test(r[0])); continue; }
      const keep = s.name === 'Properties' ? [0, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13] : [0, 1, 2, 4, 5, 6, 7, 8, 9, 12, 14, 15];
      const wd = s.name === 'Properties' ? [30, 4, 4, 4, 6, 13, 13, 13, 13, 13, 12] : [22, 11, 18, 10, 10, 4, 4, 4, 12, 11, 11, 12];
      const SH = s.name === 'Properties' ? ['Property', 'Cur', 'Bkgs', 'Nts', 'Occ %', 'Gross', 'Channel fees', 'Company fee', 'Owner share', 'Net company', 'AED equiv.'] : ['Property', 'Code', 'Guest', 'Check-in', 'Check-out', 'Nts', 'Cur', 'Ver', 'Gross', 'Channel', 'Mgmt fee', 'Owner amt'];
      if (r === s.rows[3]) { add(SH.map((h, i) => i === 0 ? h.padEnd(wd[i]) : h.slice(0, wd[i]).padStart(wd[i])).join(' '), 7, true); continue; }
      add(keep.map((k, i) => { const t = cellText(r[k], s.money.includes(k)); return (typeof r[k] === 'number' ? t.padStart(wd[i]) : t.slice(0, wd[i]).padEnd(wd[i])); }).join(' '), 7, r === s.rows[3]);
      if (s.name === 'Properties' && r !== s.rows[3]) for (const k of [15, 16]) if (r[k]) for (const l of wrap(String(r[k]), 170)) add('    ' + l, 6.5);
      if (s.name === 'Bookings' && r[17] && r !== s.rows[3]) add(`    Not verified - Airbnb payout estimate ${r[17]}`, 6.5);
    }
  }
  const pages = []; let y = H - M, cur = [];
  for (const l of lines) { const lh = l.size + 3; if (y - lh < M + 14) { pages.push(cur); cur = []; y = H - M; } y -= lh; cur.push({ ...l, y }); }
  pages.push(cur);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  pages.forEach((pg, i) => {
    const content = pg.map(l => `BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${l.x} ${l.y} Td (${pdfText(l.text)}) Tj ET`).join('\n') + `\nBT /F1 7 Tf ${M} 18 Td (${pdfText(`${PRODUCT_FULL} - ${model.title} - page ${i + 1} of ${pages.length}`)}) Tj ET`;
    objs.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(objs.length);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  objs.push(`<< /Title (${pdfText(model.title)}) /Producer (${pdfText(PRODUCT_FULL)}) >>`);
  let out = '%PDF-1.4\n'; const xref = [];
  objs.forEach((o, i) => { xref.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const at = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
