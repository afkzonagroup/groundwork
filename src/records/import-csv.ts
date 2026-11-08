// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import of completion data from a CSV report, for example an LMS report.
 * SCORM 1.2 defines the run-time data model (cmi.core.lesson_status,
 * cmi.core.score.raw) but no export file format, and LMS reports differ, so
 * the columns are mapped explicitly. Result values may use the SCORM 1.2
 * lesson_status vocabulary.
 *
 * @packageDocumentation
 */

import { type RecordInput, type Result, parseScore, validateRecordInput } from './fields.js';
import { CsvError, parseCsv } from './csv.js';

/** Record fields that can be mapped from CSV columns. */
export const MAPPABLE_FIELDS = ['person', 'role', 'activity', 'date', 'result', 'score'] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

/** Options for {@link importCsv}. */
export interface CsvImportOptions {
  /** Column header for each field. person, activity, date and result are required; role unless `role` is set. */
  readonly columns: Partial<Record<MappableField, string>>;
  /** Role for every row when there is no role column. */
  readonly role?: string;
  readonly delimiter?: ',' | ';' | '\t';
  readonly now?: Date;
}

/** Result values accepted in CSV imports, including SCORM 1.2 lesson_status values. */
const RESULT_VALUES = new Map<string, Result | 'skip'>([
  ['passed', 'passed'],
  ['failed', 'failed'],
  ['completed', 'completed'],
  ['attended', 'attended'],
  ['incomplete', 'skip'],
  ['browsed', 'skip'],
  ['not attempted', 'skip'],
]);

/** Error listing every problem found; the message is safe to show. */
export class ImportError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.slice(0, 20).join('\n') + (problems.length > 20 ? `\n... and ${String(problems.length - 20)} more.` : ''));
    this.name = 'ImportError';
  }
}

/**
 * Converts CSV text to record inputs. Any invalid row fails the whole
 * import, so nothing is half-imported. Rows whose result is "incomplete",
 * "browsed" or "not attempted" are skipped and counted.
 */
export function importCsv(text: string, options: CsvImportOptions): { inputs: RecordInput[]; skipped: number } {
  const problems: string[] = [];
  for (const f of ['person', 'activity', 'date', 'result'] as const) if (options.columns[f] === undefined) problems.push(`Map a column to ${f} (--column ${f}=<header>).`);
  if (options.columns.role === undefined && options.role === undefined) problems.push('Give --role or map a column to role.');
  if (options.columns.role !== undefined && options.role !== undefined) problems.push('Give either --role or a role column, not both.');
  if (problems.length > 0) throw new ImportError(problems);
  let rows;
  try {
    rows = parseCsv(text, options.delimiter ?? ',');
  } catch (error) {
    throw new ImportError([error instanceof CsvError ? error.message : 'The CSV file cannot be read.']);
  }
  const head = rows[0];
  if (!head) throw new ImportError(['The CSV file is empty.']);
  const index = new Map<MappableField, number>();
  for (const f of MAPPABLE_FIELDS) {
    const name = options.columns[f];
    if (name === undefined) continue;
    const matches = head.cells.map((c, i) => [c.trim(), i] as const).filter(([c]) => c === name);
    if (matches.length !== 1) problems.push(matches.length === 0 ? `Column ${JSON.stringify(name)} not found in the header.` : `Column ${JSON.stringify(name)} appears more than once.`);
    else index.set(f, matches[0]?.[1] ?? 0);
  }
  if (problems.length > 0) throw new ImportError(problems);
  const now = options.now ?? new Date();
  const inputs: RecordInput[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const cell = (f: MappableField): string => {
      const i = index.get(f);
      return i === undefined ? '' : (row.cells[i] ?? '').trim();
    };
    if (row.cells.length !== head.cells.length) {
      problems.push(`Line ${String(row.line)}: ${String(row.cells.length)} fields, the header has ${String(head.cells.length)}.`);
      continue;
    }
    const resultValue = RESULT_VALUES.get(cell('result').toLowerCase());
    if (resultValue === undefined) {
      problems.push(`Line ${String(row.line)}: unknown result ${JSON.stringify(cell('result').slice(0, 40))}.`);
      continue;
    }
    if (resultValue === 'skip') {
      skipped += 1;
      continue;
    }
    const dateText = cell('date');
    const dm = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(T[0-9:.]+(Z|[+-][0-9]{2}:?[0-9]{2})?)?$/.exec(dateText);
    const score = parseScore(cell('score'));
    if (score === undefined) {
      problems.push(`Line ${String(row.line)}: the score must be a number from 0 to 100, or empty.`);
      continue;
    }
    const input: RecordInput = {
      person: cell('person'),
      role: options.role ?? cell('role'),
      activity: cell('activity'),
      date: dm?.[1] ?? dateText,
      result: resultValue,
      score,
      source: 'csv',
    };
    const p = validateRecordInput(input, now);
    if (p.length > 0) problems.push(`Line ${String(row.line)}: ${p.join(' ')}`);
    else inputs.push(input);
  }
  if (problems.length > 0) throw new ImportError(problems);
  return { inputs, skipped };
}
