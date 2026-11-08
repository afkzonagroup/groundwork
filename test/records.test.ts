// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Training records: hash chain, HMAC, tamper detection, field validation,
// rewriting for erasure.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type Entry,
  GENESIS,
  type HeaderEntry,
  RecordsError,
  canonicalJson,
  createHeader,
  createRecord,
  keyCheck,
  rewriteChain,
  serializeEntry,
  verifyChain,
} from '../src/records/chain.js';
import { type RecordInput, parseScore, validateRecordInput } from '../src/records/fields.js';

const NOW = new Date('2026-11-08T12:00:00.000Z');
const KEY = 'k'.repeat(40);
const OTHER_KEY = 'o'.repeat(40);

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return { person: 'E1001', role: 'staff', activity: 'ai-basics', date: '2026-11-01', result: 'passed', score: 90, source: 'manual', ...overrides };
}

function chain(n: number, key?: string): { text: string; lines: string[]; header: HeaderEntry } {
  const header = createHeader({ key, now: NOW, chain: '11111111-2222-4333-8444-555555555555' });
  const lines = [serializeEntry(header)];
  let last: Entry = header;
  for (let i = 0; i < n; i++) {
    last = createRecord(header, last, input({ person: `E${String(1000 + i)}` }), { key, now: NOW });
    lines.push(serializeEntry(last));
  }
  return { text: `${lines.join('\n')}\n`, lines, header };
}

const join = (lines: string[]): string => `${lines.join('\n')}\n`;

function edit(line: string, patch: Record<string, unknown>): string {
  return canonicalJson({ ...(JSON.parse(line) as Record<string, never>), ...(patch as Record<string, never>) });
}

describe('canonical JSON', () => {
  it('sorts keys, has no whitespace and allows only integers', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 's'], c: { z: 0, y: 'x' } })).toBe('{"a":[true,null,"s"],"b":1,"c":{"y":"x","z":0}}');
    expect(() => canonicalJson({ a: 1.5 })).toThrow(RecordsError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(RecordsError);
  });
});

describe('hash chain', () => {
  it('verifies an untouched chain and reports the head', () => {
    const { text, lines } = chain(3);
    const r = verifyChain(text, { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.records).toHaveLength(3);
    expect(r.head).toBe((JSON.parse(lines[3] ?? '') as { hash: string }).hash);
    expect(r.header?.prev).toBe(GENESIS);
  });

  it('detects a changed field even when the hash is not updated', () => {
    const { lines } = chain(3);
    lines[2] = edit(lines[2] ?? '', { score: 100 });
    expect(verifyChain(join(lines), { now: NOW })).toMatchObject({ ok: false, problems: [{ line: 3, message: expect.stringMatching(/hash does not match/) as unknown }] });
  });

  it('detects a changed field with a recomputed hash (the next line no longer links)', () => {
    const { lines, header } = chain(3);
    const prev = JSON.parse(lines[1] ?? '') as Entry;
    const forged = createRecord(header, prev, input({ person: 'E1001', result: 'passed', score: 100 }), { now: NOW });
    lines[2] = serializeEntry(forged);
    expect(verifyChain(join(lines), { now: NOW }).problems[0]).toMatchObject({ line: 4 });
  });

  it('detects deleted, inserted and reordered lines', () => {
    const { lines } = chain(4);
    expect(verifyChain(join([lines[0] ?? '', lines[1] ?? '', lines[3] ?? '', lines[4] ?? '']), { now: NOW }).problems[0]?.message).toMatch(/Sequence number/);
    expect(verifyChain(join([lines[0] ?? '', lines[2] ?? '', lines[1] ?? '', lines[3] ?? '', lines[4] ?? '']), { now: NOW }).ok).toBe(false);
    expect(verifyChain(join([lines[0] ?? '', lines[1] ?? '', lines[1] ?? '', lines[2] ?? '']), { now: NOW }).ok).toBe(false);
    expect(verifyChain(join([lines[1] ?? '', lines[2] ?? '']), { now: NOW }).problems[0]?.message).toMatch(/first line must be the header/);
    expect(verifyChain(join([...lines, lines[0] ?? '']), { now: NOW }).problems[0]?.message).toMatch(/second header/);
  });

  it('detects removed lines at the end only with an expected head', () => {
    const { lines } = chain(3);
    const head = verifyChain(join(lines), { now: NOW }).head ?? '';
    const truncated = join(lines.slice(0, 3));
    expect(verifyChain(truncated, { now: NOW }).ok).toBe(true);
    expect(verifyChain(truncated, { now: NOW, expectHead: head }).problems[0]?.message).toMatch(/not the expected head/);
    expect(verifyChain(join(lines), { now: NOW, expectHead: head }).ok).toBe(true);
  });

  it('rejects non-canonical lines, extra fields, partial writes and garbage', () => {
    const { lines } = chain(1);
    expect(verifyChain(join([lines[0] ?? '', ` ${lines[1] ?? ''}`]), { now: NOW }).problems[0]?.message).toMatch(/canonical/);
    expect(verifyChain(join([lines[0] ?? '', edit(lines[1] ?? '', { note: 'x' })]), { now: NOW }).problems[0]?.message).toMatch(/missing or unknown fields/);
    expect(verifyChain(join(lines).slice(0, -1), { now: NOW }).problems[0]?.message).toMatch(/incomplete/);
    expect(verifyChain(`${lines[0] ?? ''}\n{"a":\n`, { now: NOW }).problems[0]?.message).toMatch(/Not valid JSON/);
    expect(verifyChain('', { now: NOW }).ok).toBe(false);
    expect(verifyChain('[]\n', { now: NOW }).ok).toBe(false);
    expect(verifyChain(join([lines[0] ?? '', (lines[1] ?? '').replace('"score":90', '"score":1.5')]), { now: NOW }).problems[0]?.message).toMatch(/not allowed/);
    expect(verifyChain(join([lines[0] ?? '', `{"__proto__":1,${(lines[1] ?? '').slice(1)}`]), { now: NOW }).problems[0]?.message).toMatch(/missing or unknown fields/);
  });

  it('rejects invalid field values inside a correctly hashed line', () => {
    const header = createHeader({ now: NOW });
    const bad = { ...createRecord(header, header, input(), { now: NOW }), person: 'x\u202Ey' };
    expect(verifyChain(join([serializeEntry(header), serializeEntry(bad)]), { now: NOW }).problems[0]?.line).toBe(2);
  });
});

describe('HMAC', () => {
  it('verifies with the right key and fails with a wrong one', () => {
    const { text } = chain(2, KEY);
    expect(verifyChain(text, { key: KEY, now: NOW, requireHmac: true }).ok).toBe(true);
    expect(verifyChain(text, { key: OTHER_KEY, now: NOW }).problems[0]?.message).toMatch(/not the key this file was created with/);
  });

  it('detects a line re-hashed by someone without the key', () => {
    const { lines } = chain(2, KEY);
    const record = JSON.parse(lines[1] ?? '') as Record<string, never>;
    const changed: Record<string, unknown> = { ...record, score: 100 };
    const unsealed = (o: Record<string, unknown>): string => canonicalJson(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'hash' && k !== 'mac')) as Record<string, never>);
    changed.hash = createHash('sha256').update(unsealed(changed)).digest('hex');
    lines[1] = canonicalJson(changed as Record<string, never>);
    // Without the key the change of record 1 shows only as a broken link from record 2 ...
    expect(verifyChain(join(lines), { now: NOW }).problems[0]?.line).toBe(3);
    // ... and if the attacker also re-links the rest, only the MAC reveals it.
    const two = JSON.parse(lines[2] ?? '') as Record<string, unknown>;
    two.prev = changed.hash;
    two.hash = createHash('sha256').update(unsealed(two)).digest('hex');
    lines[2] = canonicalJson(two as Record<string, never>);
    expect(verifyChain(join(lines), { now: NOW }).ok).toBe(true);
    expect(verifyChain(join(lines), { key: KEY, now: NOW }).problems[0]).toMatchObject({ line: 2, message: expect.stringMatching(/MAC does not match/) as unknown });
  });

  it('detects MACs computed with another key', () => {
    const { lines } = chain(1, KEY);
    const record = JSON.parse(lines[1] ?? '') as Record<string, unknown>;
    const otherChain = chain(1, OTHER_KEY);
    const otherRecord = JSON.parse(otherChain.lines[1] ?? '') as Record<string, unknown>;
    lines[1] = canonicalJson({ ...(record as Record<string, never>), mac: otherRecord.mac as never });
    expect(verifyChain(join(lines), { key: KEY, now: NOW }).problems[0]?.message).toMatch(/MAC does not match/);
  });

  it('detects a downgrade to a chain without HMAC', () => {
    const plain = chain(2).text;
    expect(verifyChain(plain, { key: KEY, now: NOW }).problems[0]?.message).toMatch(/does not use HMAC/);
    expect(verifyChain(plain, { now: NOW, requireHmac: true }).ok).toBe(false);
  });

  it('rejects a MAC field in a chain without HMAC', () => {
    const { lines } = chain(1);
    const sealed = chain(1, KEY);
    const mac = (JSON.parse(sealed.lines[1] ?? '') as { mac: string }).mac;
    // The MAC is outside the hash, so only this check notices it.
    lines[1] = edit(lines[1] ?? '', { mac });
    expect(verifyChain(join(lines), { now: NOW }).problems[0]).toMatchObject({ line: 2, message: expect.stringMatching(/MAC is present in a file without HMAC/) as unknown });
  });

  it('requires the key when asked to', () => {
    const { text } = chain(1, KEY);
    expect(verifyChain(text, { now: NOW }).ok).toBe(true);
    expect(verifyChain(text, { now: NOW, requireHmac: true }).problems[0]?.message).toMatch(/no key was given/);
  });

  it('refuses short keys, missing keys and keys for plain chains', () => {
    expect(() => createHeader({ key: 'short' })).toThrow(/at least 32/);
    const hmac = createHeader({ key: KEY, now: NOW });
    expect(() => createRecord(hmac, hmac, input(), { now: NOW })).toThrow(/uses HMAC/);
    const plain = createHeader({ now: NOW });
    expect(() => createRecord(plain, plain, input(), { key: KEY, now: NOW })).toThrow(/does not use HMAC/);
    expect(verifyChain(chain(1).text, { key: 'short', now: NOW }).ok).toBe(false);
  });

  it('stores a key check that does not reveal the key', () => {
    expect(keyCheck(KEY)).toMatch(/^[0-9a-f]{16}$/);
    expect(keyCheck(KEY)).not.toBe(keyCheck(OTHER_KEY));
    expect(chain(1, KEY).text).not.toContain(KEY);
  });
});

describe('record fields', () => {
  it('accepts a valid record', () => {
    expect(validateRecordInput(input(), NOW)).toEqual([]);
    expect(validateRecordInput(input({ score: null, result: 'attended' }), NOW)).toEqual([]);
    expect(validateRecordInput(input({ date: '2026-11-09' }), NOW)).toEqual([]);
  });

  it.each([
    ['empty person', { person: '' }],
    ['person with spaces around', { person: ' E1 ' }],
    ['person too long', { person: 'x'.repeat(201) }],
    ['person with control character', { person: 'E1\u0007' }],
    ['person with bidi override', { person: 'E1\u202EE2' }],
    ['person with zero-width space', { person: 'E1\u200BE2' }],
    ['role not an id', { role: 'All Staff' }],
    ['activity with path', { activity: '../x' }],
    ['invalid date', { date: '2026-02-30' }],
    ['date format', { date: '08.11.2026' }],
    ['future date', { date: '2026-11-10' }],
    ['score too high', { score: 101 }],
    ['score negative', { score: -1 }],
    ['score decimal', { score: 50.5 }],
    ['unknown result', { result: 'excellent' }],
    ['unknown source', { source: 'web' }],
  ])('rejects %s', (_name, patch) => {
    expect(validateRecordInput(input(patch as Partial<RecordInput>), NOW).length).toBeGreaterThan(0);
  });

  it('parses scores', () => {
    expect(parseScore('')).toBeNull();
    expect(parseScore('85')).toBe(85);
    expect(parseScore('85,6')).toBe(86);
    expect(parseScore('100.0')).toBe(100);
    for (const bad of ['101', '-1', 'abc', '1e2', '0x10']) expect(parseScore(bad), bad).toBeUndefined();
  });
});

describe('rewriting for erasure and retention', () => {
  it('removes records, re-links the chain and documents the old chain', () => {
    const { text } = chain(3, KEY);
    const verified = verifyChain(text, { key: KEY, now: NOW });
    const { text: rewritten, removed } = rewriteChain(verified, (r) => r.person !== 'E1001', 'erasure', { key: KEY, now: NOW });
    expect(removed).toBe(1);
    const again = verifyChain(rewritten, { key: KEY, now: NOW });
    expect(again.ok).toBe(true);
    expect(again.records.map((r) => r.person)).toEqual(['E1000', 'E1002']);
    expect(again.records.map((r) => r.seq)).toEqual([1, 2]);
    expect(again.header?.previous).toEqual({ chain: verified.header?.chain, head: verified.head, removed: 1, reason: 'erasure' });
    expect(rewritten).not.toContain('E1001');
  });

  it('refuses to rewrite a chain that does not verify', () => {
    const { lines } = chain(2);
    lines[1] = edit(lines[1] ?? '', { score: 1 });
    expect(() => rewriteChain(verifyChain(join(lines), { now: NOW }), () => true, 'retention')).toThrow(RecordsError);
  });
});
