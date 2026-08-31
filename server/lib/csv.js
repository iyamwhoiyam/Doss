/**
 * A small, dependency-free CSV reader and writer.
 *
 * Handles the parts of RFC 4180 that real spreadsheet exports use: quoted
 * fields, commas and newlines inside quotes, "" as an escaped quote, CRLF or LF
 * line endings, and a UTF-8 BOM (which Excel loves to prepend). It does not try
 * to be a full dialect engine — it reads what "Save As CSV" produces.
 */

/**
 * Parse CSV text into a header list and an array of row objects keyed by header.
 * Blank lines are skipped; a row with fewer cells than headers is padded, more
 * cells than headers are dropped.
 */
export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => { pushField(); records.push(record); record = []; };

  while (i < clean.length) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { pushField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { pushRecord(); i += 1; continue; }
    field += ch; i += 1;
  }
  // flush the trailing field/record if the file did not end with a newline
  if (field.length > 0 || record.length > 0) pushRecord();

  // drop fully-empty records (e.g. a trailing blank line)
  const rows = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  const out = rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
    return obj;
  });
  return { headers, rows: out };
}

/** Quote a single cell only when it needs it. */
function quoteCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Turn a list of header names and an array of row objects into CSV text.
 * Cells are pulled from each row by header name; missing keys become empty.
 */
export function toCsv(headers, rows = []) {
  const head = headers.map(quoteCell).join(',');
  const body = rows.map((row) => headers.map((h) => quoteCell(row[h])).join(',')).join('\r\n');
  return rows.length ? `${head}\r\n${body}\r\n` : `${head}\r\n`;
}
