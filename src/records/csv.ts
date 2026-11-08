// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CSV writing (RFC 4180) with protection against formula injection, and a
 * strict CSV reader with limits for imports.
 *
 * @packageDocumentation
 */

/**
 * Characters that make spreadsheet programs treat a cell as a formula when
 * they start it, including full-width forms that some programs normalise.
 */
const FORMULA_START = /^[\s\u3000]*[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;

/**
 * Neutralises a value for a spreadsheet: a value that could start a formula
 * gets a leading apostrophe (OWASP guidance on CSV injection). Plain
 * numbers, including negative ones, are left alone.
 */
export function neutraliseFormula(value: string): string {
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return value;
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Quotes a cell when needed (RFC 4180): commas, quotes, line breaks, or edge spaces. */
export function quoteCsvCell(value: string, delimiter = ','): string {
  if (value.includes(delimiter) || /["\r\n]/.test(value) || value !== value.trim()) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Writes rows as CSV with CRLF line endings; every cell is neutralised and quoted as needed. */
export function writeCsv(rows: readonly (readonly string[])[], delimiter = ','): string {
  return rows.map((row) => row.map((cell) => quoteCsvCell(neutraliseFormula(cell), delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

/** Limits for {@link parseCsv}. */
export interface CsvLimits {
  readonly maxRows: number;
  readonly maxFields: number;
  readonly maxFieldLength: number;
}

/** Default import limits. */
export const DEFAULT_CSV_LIMITS: CsvLimits = { maxRows: 200_000, maxFields: 100, maxFieldLength: 10_000 };

/** Error with a line number; the message is safe to show. */
export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${String(line)}: ${message}`);
    this.name = 'CsvError';
  }
}

/**
 * Parses RFC 4180 CSV strictly: quotes only around whole fields, doubled
 * quotes inside, CRLF or LF line ends, optional BOM. Blank lines are skipped.
 * Each row is returned with the line number where it starts.
 */
export function parseCsv(text: string, delimiter = ',', limits: CsvLimits = DEFAULT_CSV_LIMITS): { line: number; cells: string[] }[] {
  if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') throw new CsvError('Unsupported delimiter.', 1);
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: { line: number; cells: string[] }[] = [];
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const startLine = line;
    const cells: string[] = [];
    let field = '';
    let atFieldStart = true;
    let quoted = false;
    let rowDone = false;
    while (i < src.length && !rowDone) {
      const ch = src[i] ?? '';
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          quoted = false;
          i += 1;
          const next = src[i];
          if (next !== undefined && next !== delimiter && next !== '\n' && next !== '\r') throw new CsvError('Text after a closing quote.', line);
          continue;
        }
        if (ch === '\n') line += 1;
        field += ch;
        i += 1;
      } else if (ch === '"' && atFieldStart) {
        quoted = true;
        atFieldStart = false;
        i += 1;
      } else if (ch === '"') {
        throw new CsvError('A quote inside an unquoted field.', line);
      } else if (ch === delimiter) {
        cells.push(field);
        field = '';
        atFieldStart = true;
        i += 1;
      } else if (ch === '\r' || ch === '\n') {
        i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
        line += 1;
        rowDone = true;
      } else {
        field += ch;
        atFieldStart = false;
        i += 1;
      }
      if (field.length > limits.maxFieldLength) throw new CsvError(`A field is longer than ${String(limits.maxFieldLength)} characters.`, startLine);
      if (cells.length > limits.maxFields) throw new CsvError(`More than ${String(limits.maxFields)} fields.`, startLine);
    }
    if (quoted) throw new CsvError('A quoted field is not closed.', startLine);
    cells.push(field);
    if (cells.length === 1 && cells[0] === '') continue;
    rows.push({ line: startLine, cells });
    if (rows.length > limits.maxRows) throw new CsvError(`More than ${String(limits.maxRows)} rows.`, startLine);
  }
  return rows;
}
