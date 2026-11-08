// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exports of verified records: CSV (spreadsheet-safe) and JSON.
 *
 * @packageDocumentation
 */

import { ATTRIBUTION } from '../version.js';
import type { RecordEntry, VerifyResult } from './chain.js';
import { writeCsv } from './csv.js';

/** CSV column headers, in order. */
export const CSV_COLUMNS = ['seq', 'date', 'person', 'role', 'activity', 'result', 'score', 'source', 'recorded_at', 'hash'] as const;

/** Exports records as CSV. Every cell is protected against formula injection. */
export function recordsToCsv(records: readonly RecordEntry[]): string {
  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const r of records) rows.push([String(r.seq), r.date, r.person, r.role, r.activity, r.result, r.score === null ? '' : String(r.score), r.source, r.ts, r.hash]);
  return writeCsv(rows);
}

/** Exports a verified file as JSON with chain information. */
export function recordsToJson(verified: VerifyResult): string {
  return `${JSON.stringify(
    {
      generator: ATTRIBUTION.text,
      chain: verified.header?.chain ?? null,
      hmac: verified.header?.hmac ?? false,
      head: verified.head ?? null,
      previous: verified.header?.previous ?? null,
      records: verified.records.map((r) => ({
        seq: r.seq,
        date: r.date,
        person: r.person,
        role: r.role,
        activity: r.activity,
        result: r.result,
        score: r.score,
        source: r.source,
        recordedAt: r.ts,
        hash: r.hash,
      })),
    },
    null,
    2,
  )}\n`;
}
