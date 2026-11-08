// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Records files on disk. Files are created with mode 0600, appended under
 * an exclusive lock, and verified completely before anything is added.
 *
 * @packageDocumentation
 */

import { acquireLock, appendFileSafe, readFileLimited, writeFileSafe } from '../util/fs.js';
import { type Entry, RecordsError, type VerifyOptions, type VerifyResult, createHeader, createRecord, isDuplicate, serializeEntry, verifyChain } from './chain.js';
import type { RecordInput } from './fields.js';

/** Maximum size of a records file. */
export const MAX_RECORDS_FILE_BYTES = 200 * 1024 * 1024;

/** Reads and verifies a records file. */
export async function readRecordsFile(path: string, options: VerifyOptions = {}): Promise<VerifyResult> {
  const bytes = await readFileLimited(path, MAX_RECORDS_FILE_BYTES);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RecordsError('The records file is not valid UTF-8.');
  }
  return verifyChain(text, options);
}

/** Creates a new records file with a header line. Fails if the file exists. */
export async function initRecordsFile(path: string, key: string | undefined, now: Date = new Date()): Promise<string> {
  const header = createHeader({ key, now });
  await writeFileSafe(path, `${serializeEntry(header)}\n`, { force: false, mode: 0o600 });
  return header.hash;
}

/** Result of {@link addRecords}. */
export interface AddResult {
  readonly added: number;
  readonly duplicates: number;
  /** Hash of the last line after adding. */
  readonly head: string;
}

/**
 * Verifies the file, then appends records. Exact duplicates of existing
 * records (and of records earlier in the same batch) are skipped. Nothing is
 * written if the file does not verify.
 */
export async function addRecords(path: string, inputs: readonly RecordInput[], key: string | undefined, now: Date = new Date()): Promise<AddResult> {
  const release = await acquireLock(path);
  try {
    const verified = await readRecordsFile(path, { key, now });
    if (!verified.ok || !verified.header || verified.head === undefined) {
      const first = verified.problems[0];
      throw new RecordsError(`The records file does not verify${first ? ` (line ${String(first.line)}: ${first.message})` : ''}. Nothing was added.`);
    }
    const known = [...verified.records];
    let last: Entry = known[known.length - 1] ?? verified.header;
    const lines: string[] = [];
    let duplicates = 0;
    for (const input of inputs) {
      if (isDuplicate(known, input)) {
        duplicates += 1;
        continue;
      }
      const entry = createRecord(verified.header, last, input, { key, now });
      lines.push(serializeEntry(entry));
      known.push(entry);
      last = entry;
    }
    if (lines.length > 0) await appendFileSafe(path, `${lines.join('\n')}\n`);
    return { added: lines.length, duplicates, head: last.hash };
  } finally {
    await release();
  }
}

