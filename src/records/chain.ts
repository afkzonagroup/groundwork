// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tamper-evident training records: JSON Lines, one header line and one line
 * per record, each line carrying the SHA-256 hash of the previous line
 * (`prev`) and its own hash (`hash`). With a key, each line also carries an
 * HMAC-SHA256 (`mac`).
 *
 * What this detects: every change, insertion, deletion or reordering of lines
 * before the last one; with a key, also a rewritten chain by someone without
 * the key. What it cannot detect on its own: removal of lines at the end
 * (keep the head hash somewhere else and pass it to `expectHead`), or a
 * complete rewrite by someone who has the key.
 *
 * @packageDocumentation
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { type RecordInput, recordKey, validateRecordInput } from './fields.js';

/** File format identifier and version. */
export const FORMAT = 'groundwork-records';
export const FORMAT_VERSION = 1;

/** `prev` of the header line. */
export const GENESIS = '0'.repeat(64);

/** Minimum key length in characters. */
export const MIN_KEY_LENGTH = 32;

/** Link to the chain a file was rewritten from (erasure or retention). */
export interface PreviousChain {
  readonly chain: string;
  readonly head: string;
  readonly removed: number;
  readonly reason: 'erasure' | 'retention';
}

/** The header line. */
export interface HeaderEntry {
  readonly type: 'header';
  readonly format: typeof FORMAT;
  readonly v: typeof FORMAT_VERSION;
  readonly seq: 0;
  readonly chain: string;
  readonly created: string;
  readonly hmac: boolean;
  readonly keyCheck: string | null;
  readonly previous: PreviousChain | null;
  readonly prev: string;
  readonly hash: string;
  readonly mac: string | null;
}

/** A record line. */
export interface RecordEntry extends RecordInput {
  readonly type: 'record';
  readonly v: typeof FORMAT_VERSION;
  readonly seq: number;
  /** When the record was added (ISO 8601, UTC). */
  readonly ts: string;
  readonly prev: string;
  readonly hash: string;
  readonly mac: string | null;
}

/** Any line of a records file. */
export type Entry = HeaderEntry | RecordEntry;

/** Error with a message that is safe to show. */
export class RecordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordsError';
  }
}

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/**
 * Canonical JSON: object keys sorted by UTF-16 code units, no whitespace,
 * only safe integers as numbers.
 */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RecordsError('Only whole numbers are allowed in records.');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((v: Json) => canonicalJson(v)).join(',')}]`;
  const obj = value as { readonly [key: string]: Json };
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k] ?? null)}`).join(',')}}`;
}

function withoutSeal(entry: Entry): Json {
  const copy: Record<string, Json> = {};
  for (const [k, v] of Object.entries(entry)) if (k !== 'hash' && k !== 'mac') copy[k] = v as Json;
  return copy;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hmacHex(key: string, text: string): string {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex');
}

/** Compares two hex strings in constant time (for equal lengths). */
export function hexEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checks a key from the environment. */
export function checkKey(key: string): void {
  if (key.length < MIN_KEY_LENGTH) throw new RecordsError(`The record key must be at least ${MIN_KEY_LENGTH} characters long.`);
  if (key.length > 1024) throw new RecordsError('The record key is too long.');
}

/** A short value that identifies a key without revealing it. */
export function keyCheck(key: string): string {
  return hmacHex(key, 'groundwork key check v1').slice(0, 16);
}

function seal<T extends Entry>(unsealed: Omit<T, 'hash' | 'mac'>, key: string | undefined): T {
  const body = canonicalJson(withoutSeal({ ...unsealed, hash: '', mac: null } as unknown as Entry));
  const hash = sha256Hex(body);
  return { ...unsealed, hash, mac: key === undefined ? null : hmacHex(key, body) } as T;
}

/** Serialises an entry as one canonical JSON line (without the newline). */
export function serializeEntry(entry: Entry): string {
  return canonicalJson(entry as unknown as Json);
}

/** Options for a new chain. */
export interface NewChainOptions {
  /** Key for HMAC; undefined for hash-only chains. */
  readonly key?: string | undefined;
  /** Creation time; default now. */
  readonly now?: Date;
  /** Chain id; default a random UUID. */
  readonly chain?: string;
  readonly previous?: PreviousChain;
}

/** Creates the header line of a new chain. */
export function createHeader(options: NewChainOptions = {}): HeaderEntry {
  if (options.key !== undefined) checkKey(options.key);
  return seal<HeaderEntry>(
    {
      type: 'header',
      format: FORMAT,
      v: FORMAT_VERSION,
      seq: 0,
      chain: options.chain ?? randomUUID(),
      created: (options.now ?? new Date()).toISOString(),
      hmac: options.key !== undefined,
      keyCheck: options.key === undefined ? null : keyCheck(options.key),
      previous: options.previous ?? null,
      prev: GENESIS,
    },
    options.key,
  );
}

/**
 * Creates the next record entry after `last`. The input is validated; a
 * key is required exactly when the chain uses HMAC.
 */
export function createRecord(header: HeaderEntry, last: Entry, input: RecordInput, options: { key?: string | undefined; now?: Date } = {}): RecordEntry {
  const now = options.now ?? new Date();
  const problems = validateRecordInput(input, now);
  if (problems.length > 0) throw new RecordsError(problems.join(' '));
  if (header.hmac && options.key === undefined) throw new RecordsError('This records file uses HMAC; set GROUNDWORK_RECORD_KEY.');
  if (!header.hmac && options.key !== undefined) throw new RecordsError('This records file does not use HMAC, but a key was given. Unset GROUNDWORK_RECORD_KEY or start a new file with --hmac.');
  if (options.key !== undefined && header.keyCheck !== null && !hexEqual(keyCheck(options.key), header.keyCheck)) {
    throw new RecordsError('GROUNDWORK_RECORD_KEY is not the key this file was created with.');
  }
  return seal<RecordEntry>(
    {
      type: 'record',
      v: FORMAT_VERSION,
      seq: last.seq + 1,
      ts: now.toISOString(),
      person: input.person,
      role: input.role,
      activity: input.activity,
      date: input.date,
      result: input.result,
      score: input.score,
      source: input.source,
      prev: last.hash,
    },
    options.key,
  );
}

/** A problem found while verifying, with its 1-based line number. */
export interface ChainProblem {
  readonly line: number;
  readonly message: string;
}

/** Result of {@link verifyChain}. */
export interface VerifyResult {
  readonly ok: boolean;
  readonly header: HeaderEntry | undefined;
  readonly records: readonly RecordEntry[];
  /** Hash of the last valid line, to store somewhere else as an anchor. */
  readonly head: string | undefined;
  readonly problems: readonly ChainProblem[];
}

/** Options for {@link verifyChain}. */
export interface VerifyOptions {
  readonly key?: string | undefined;
  /** Fail unless the chain uses HMAC and the key verifies it. */
  readonly requireHmac?: boolean;
  /** Expected hash of the last line (detects removed lines at the end). */
  readonly expectHead?: string;
  /** "Now" for the not-in-the-future check on dates (default: now). */
  readonly now?: Date;
}

/** Maximum number of lines in a records file. */
export const MAX_LINES = 1_000_000;

const HEADER_KEYS = ['chain', 'created', 'format', 'hash', 'hmac', 'keyCheck', 'mac', 'prev', 'previous', 'seq', 'type', 'v'];
const RECORD_KEYS = ['activity', 'date', 'hash', 'mac', 'person', 'prev', 'result', 'role', 'score', 'seq', 'source', 'ts', 'type', 'v'];
const PREVIOUS_KEYS = ['chain', 'head', 'reason', 'removed'];
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_TS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((k, i) => k === keys[i]);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHeader(value: Record<string, unknown>): string | undefined {
  if (!exactKeys(value, HEADER_KEYS)) return 'The header has missing or unknown fields.';
  if (value.format !== FORMAT || value.v !== FORMAT_VERSION || value.seq !== 0) return 'Not a groundwork-records version 1 header.';
  if (typeof value.chain !== 'string' || !UUID.test(value.chain)) return 'Invalid chain id.';
  if (typeof value.created !== 'string' || !ISO_TS.test(value.created)) return 'Invalid creation time.';
  if (typeof value.hmac !== 'boolean') return 'Invalid hmac flag.';
  if (value.hmac ? typeof value.keyCheck !== 'string' || !/^[0-9a-f]{16}$/.test(value.keyCheck) : value.keyCheck !== null) return 'Invalid keyCheck.';
  const previous = value.previous;
  if (previous !== null) {
    if (!isRecordObject(previous) || !exactKeys(previous, PREVIOUS_KEYS)) return 'Invalid previous-chain information.';
    if (typeof previous.chain !== 'string' || !UUID.test(previous.chain) || typeof previous.head !== 'string' || !HEX64.test(previous.head)) return 'Invalid previous-chain information.';
    if (typeof previous.removed !== 'number' || !Number.isSafeInteger(previous.removed) || previous.removed < 0) return 'Invalid previous-chain information.';
    if (previous.reason !== 'erasure' && previous.reason !== 'retention') return 'Invalid previous-chain information.';
  }
  return undefined;
}

function parseRecord(value: Record<string, unknown>, now: Date): string | undefined {
  if (!exactKeys(value, RECORD_KEYS)) return 'The record has missing or unknown fields.';
  if (value.v !== FORMAT_VERSION) return 'Unsupported record version.';
  if (typeof value.ts !== 'string' || !ISO_TS.test(value.ts)) return 'Invalid time stamp.';
  const input = { person: value.person, role: value.role, activity: value.activity, date: value.date, result: value.result, score: value.score, source: value.source };
  const problems = validateRecordInput(input as RecordInput, now);
  return problems.length > 0 ? problems.join(' ') : undefined;
}

/**
 * Verifies a records file. Every line must be canonical JSON with the right
 * fields; sequence numbers, `prev` links and hashes must match; with a key,
 * every MAC must match.
 */
export function verifyChain(text: string, options: VerifyOptions = {}): VerifyResult {
  const problems: ChainProblem[] = [];
  const records: RecordEntry[] = [];
  let header: HeaderEntry | undefined;
  const fail = (line: number, message: string): VerifyResult => {
    problems.push({ line, message });
    return { ok: false, header, records, head: undefined, problems };
  };
  if (options.key !== undefined) {
    try {
      checkKey(options.key);
    } catch (error) {
      return fail(0, error instanceof Error ? error.message : 'Invalid key.');
    }
  }
  if (text.length === 0) return fail(1, 'The file is empty.');
  if (!text.endsWith('\n')) return fail(text.split('\n').length, 'The last line is incomplete (no line break at the end). It may be a partial write.');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > MAX_LINES) return fail(0, `More than ${MAX_LINES} lines.`);
  let prevHash = GENESIS;
  let lastSeq = -1;
  const now = options.now ?? new Date();
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i] ?? '';
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return fail(lineNo, 'Not valid JSON.');
    }
    if (!isRecordObject(value)) return fail(lineNo, 'Not a JSON object.');
    let canonical: string;
    try {
      canonical = canonicalJson(value as Json);
    } catch {
      return fail(lineNo, 'Contains a value that is not allowed.');
    }
    if (canonical !== line) return fail(lineNo, 'The line is not in canonical form (it was edited by hand or by another tool).');
    if (i === 0) {
      if (value.type !== 'header') return fail(lineNo, 'The first line must be the header.');
      const problem = parseHeader(value);
      if (problem) return fail(lineNo, problem);
      header = value as unknown as HeaderEntry;
    } else {
      if (value.type !== 'record') return fail(lineNo, value.type === 'header' ? 'A second header line.' : 'Unknown line type.');
      const problem = parseRecord(value, now);
      if (problem) return fail(lineNo, problem);
    }
    const entry = value as unknown as Entry;
    if (entry.seq !== lastSeq + 1) return fail(lineNo, `Sequence number ${String(entry.seq)} where ${String(lastSeq + 1)} was expected: a line was removed, added or moved.`);
    if (typeof entry.prev !== 'string' || !hexEqual(entry.prev, prevHash)) return fail(lineNo, 'The link to the previous line does not match: a line before it was changed, removed or moved.');
    const body = canonicalJson(withoutSeal(entry));
    if (typeof entry.hash !== 'string' || !HEX64.test(entry.hash) || !hexEqual(sha256Hex(body), entry.hash)) return fail(lineNo, 'The hash does not match the content: this line was changed.');
    if (header?.hmac) {
      if (typeof entry.mac !== 'string' || !HEX64.test(entry.mac)) return fail(lineNo, 'The MAC is missing.');
      if (options.key !== undefined && !hexEqual(hmacHex(options.key, body), entry.mac)) {
        return fail(lineNo, i === 0 && header.keyCheck !== null && !hexEqual(keyCheck(options.key), header.keyCheck) ? 'The key is not the key this file was created with.' : 'The MAC does not match: this line was changed by someone without the key.');
      }
    } else if (entry.mac !== null) return fail(lineNo, 'A MAC is present in a file without HMAC.');
    if (entry.type === 'record') records.push(entry);
    prevHash = entry.hash;
    lastSeq = entry.seq;
  }
  if (options.key !== undefined && header && !header.hmac) {
    problems.push({ line: 1, message: 'A key was given, but this file does not use HMAC. If it was created with HMAC, it has been replaced.' });
  }
  if (options.requireHmac && !header?.hmac) problems.push({ line: 1, message: 'HMAC is required, but this file does not use it.' });
  if (options.requireHmac && header?.hmac && options.key === undefined) problems.push({ line: 0, message: 'HMAC is required, but no key was given (GROUNDWORK_RECORD_KEY).' });
  if (options.expectHead !== undefined && !hexEqual(options.expectHead, prevHash)) {
    problems.push({ line: lines.length, message: 'The last line is not the expected head: lines were removed at the end, or records were added since the head was noted.' });
  }
  return { ok: problems.length === 0, header, records, head: prevHash, problems };
}

/** Returns true if an equal record (same person, role, activity, date, result and score) exists. */
export function isDuplicate(records: readonly RecordEntry[], input: RecordInput): boolean {
  const k = recordKey(input);
  return records.some((r) => recordKey(r) === k);
}

/**
 * Rewrites a chain without some records, for erasure requests or retention
 * limits. The new header names the old chain, its head hash and the number
 * of removed records, so the gap is documented without keeping the removed
 * personal data.
 */
export function rewriteChain(verified: VerifyResult, keep: (r: RecordEntry) => boolean, reason: PreviousChain['reason'], options: { key?: string | undefined; now?: Date } = {}): { text: string; removed: number } {
  if (!verified.ok || !verified.header || verified.head === undefined) throw new RecordsError('Verify the records file before rewriting it.');
  const kept = verified.records.filter(keep);
  const removed = verified.records.length - kept.length;
  const now = options.now ?? new Date();
  const header = createHeader({ key: options.key, now, previous: { chain: verified.header.chain, head: verified.head, removed, reason } });
  const lines = [serializeEntry(header)];
  let last: Entry = header;
  for (const r of kept) {
    const entry: RecordEntry = seal<RecordEntry>({ ...r, seq: last.seq + 1, prev: last.hash }, options.key);
    lines.push(serializeEntry(entry));
    last = entry;
  }
  return { text: `${lines.join('\n')}\n`, removed };
}
