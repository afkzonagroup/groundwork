// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// CSV export (formula injection), CSV import, xAPI statements and imports.

import { describe, expect, it } from 'vitest';
import { type Entry, type RecordEntry, createHeader, createRecord, rewriteChain, verifyChain, serializeEntry } from '../src/records/chain.js';
import { CsvError, neutraliseFormula, parseCsv, quoteCsvCell, writeCsv } from '../src/records/csv.js';
import { CSV_COLUMNS, recordsToCsv, recordsToJson } from '../src/records/export.js';
import type { RecordInput } from '../src/records/fields.js';
import { ImportError, importCsv } from '../src/records/import-csv.js';
import { VERBS, XapiError, checkActivityBase, fromStatements, toStatements, uuidV5 } from '../src/xapi/xapi.js';
import { bundledCourse } from './helpers.js';

const NOW = new Date('2026-11-08T12:00:00.000Z');

function records(inputs: Partial<RecordInput>[]): RecordEntry[] {
  const header = createHeader({ now: NOW });
  const out: RecordEntry[] = [];
  let last: Entry = header;
  for (const i of inputs) {
    const e = createRecord(header, last, { person: 'E1', role: 'staff', activity: 'ai-basics', date: '2026-11-02', result: 'passed', score: 90, source: 'manual', ...i }, { now: NOW });
    out.push(e);
    last = e;
  }
  return out;
}

describe('CSV formula injection', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1+2', "'-1+2"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=1', "'\t=1"],
    ['\r=1', "'\r=1"],
    ['  =HYPERLINK("http://x")', `'  =HYPERLINK("http://x")`],
    ['\uFF1D1+1', "'\uFF1D1+1"],
    ['\uFF0B1', "'\uFF0B1"],
    ['\u3000=1', "'\u3000=1"],
  ])('neutralises %j', (value, expected) => {
    expect(neutraliseFormula(value)).toBe(expected);
  });

  it.each(['42', '-5', '3.14', 'E1001', 'Jane Doe', '2026-11-08', 'a=b'])('leaves %j unchanged', (value) => {
    expect(neutraliseFormula(value)).toBe(value);
  });

  it('quotes cells per RFC 4180', () => {
    expect(quoteCsvCell('a,b')).toBe('"a,b"');
    expect(quoteCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCsvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(quoteCsvCell(' padded')).toBe('" padded"');
    expect(writeCsv([['=x', 'a,b']])).toBe(`'=x,"a,b"\r\n`);
  });

  it('protects every cell of a records export', () => {
    const csv = recordsToCsv(records([{ person: '=HYPERLINK("http://evil","click")' }, { person: '@cmd' }, { person: '+1 555' }]));
    const rows = parseCsv(csv);
    expect(rows[0]?.cells).toEqual([...CSV_COLUMNS]);
    expect(rows.slice(1).map((r) => r.cells[2])).toEqual([`'=HYPERLINK("http://evil","click")`, "'@cmd", "'+1 555"]);
    for (const r of rows.slice(1)) for (const c of r.cells) expect(c, c).not.toMatch(/^[=+\-@\t\r]/);
  });

  it('exports JSON with chain information', () => {
    const header = createHeader({ now: NOW });
    const r = createRecord(header, header, { person: 'E1', role: 'staff', activity: 'ai-basics', date: '2026-11-02', result: 'passed', score: null, source: 'manual' }, { now: NOW });
    const verified = verifyChain(`${serializeEntry(header)}\n${serializeEntry(r)}\n`, { now: NOW });
    const json = JSON.parse(recordsToJson(verified)) as { generator: string; head: string; records: { person: string; score: null }[] };
    expect(json.generator).toBe('Groundwork by AFKzona Group');
    expect(json.head).toBe(r.hash);
    expect(json.records[0]).toMatchObject({ person: 'E1', score: null });
  });
});

describe('CSV parser', () => {
  it('parses quoted fields, CRLF, BOM and blank lines', () => {
    expect(parseCsv('\uFEFFa,"b ""q"", c"\r\n\r\n1,"multi\nline"\n').map((r) => [r.line, r.cells])).toEqual([
      [1, ['a', 'b "q", c']],
      [3, ['1', 'multi\nline']],
    ]);
    expect(parseCsv('a;b\n1;2', ';').map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it.each([
    ['a"b,c', /quote inside an unquoted field/],
    ['"a"b,c', /Text after a closing quote/],
    ['"open,c', /not closed/],
  ])('rejects %j', (text, pattern) => {
    expect(() => parseCsv(text)).toThrow(CsvError);
    expect(() => parseCsv(text)).toThrow(pattern);
  });

  it('enforces limits', () => {
    expect(() => parseCsv('a\n'.repeat(20), ',', { maxRows: 10, maxFields: 5, maxFieldLength: 10 })).toThrow(/More than 10 rows/);
    expect(() => parseCsv('a,b,c,d,e,f,g', ',', { maxRows: 10, maxFields: 5, maxFieldLength: 10 })).toThrow(/More than 5 fields/);
    expect(() => parseCsv('x'.repeat(11), ',', { maxRows: 10, maxFields: 5, maxFieldLength: 10 })).toThrow(/longer than 10/);
    expect(() => parseCsv('a', '|')).toThrow(/delimiter/);
  });
});

describe('CSV import', () => {
  const columns = { person: 'Employee', activity: 'Module', date: 'Completed', result: 'Status', score: 'Score' };
  const csv = 'Employee,Module,Completed,Status,Score\r\nE1,ai-basics,2026-11-01,passed,85\r\nE2,ai-basics,2026-11-02T09:30:00Z,Failed,40.4\r\nE3,escalation,2026-11-03,incomplete,\r\nE4,escalation,2026-11-03,not attempted,\r\n';

  it('maps columns and the SCORM 1.2 lesson_status vocabulary', () => {
    const r = importCsv(csv, { columns, role: 'staff', now: NOW });
    expect(r.skipped).toBe(2);
    expect(r.inputs).toEqual([
      { person: 'E1', role: 'staff', activity: 'ai-basics', date: '2026-11-01', result: 'passed', score: 85, source: 'csv' },
      { person: 'E2', role: 'staff', activity: 'ai-basics', date: '2026-11-02', result: 'failed', score: 40, source: 'csv' },
    ]);
  });

  it('fails the whole import on any invalid row, with line numbers', () => {
    const bad = `${csv}E5,../x,2026-11-03,passed,\r\nE6,ai-basics,2099-01-01,passed,\r\nE7,ai-basics,2026-11-01,great,\r\nE8,ai-basics,2026-11-01,passed,150\r\n`;
    try {
      importCsv(bad, { columns, role: 'staff', now: NOW });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      const problems = (error as ImportError).problems.join('\n');
      expect(problems).toMatch(/Line 6: .*activity/);
      expect(problems).toMatch(/Line 7: .*future/);
      expect(problems).toMatch(/Line 8: unknown result/);
      expect(problems).toMatch(/Line 9: the score/);
    }
  });

  it('checks the column mapping', () => {
    expect(() => importCsv(csv, { columns: { person: 'Employee' }, role: 'staff' })).toThrow(/Map a column to activity/);
    expect(() => importCsv(csv, { columns: { ...columns, person: 'Name' }, role: 'staff' })).toThrow(/not found/);
    expect(() => importCsv(csv, { columns })).toThrow(/--role/);
    expect(() => importCsv('Employee,Employee,Module,Completed,Status\n', { columns, role: 'staff' })).toThrow(/more than once|not found/);
    expect(() => importCsv('', { columns, role: 'staff' })).toThrow(/empty/);
  });

  it('rejects rows with the wrong number of fields', () => {
    expect(() => importCsv('Employee,Module,Completed,Status,Score\nE1,ai-basics\n', { columns, role: 'staff', now: NOW })).toThrow(/2 fields/);
  });
});

describe('xAPI', () => {
  const home = 'https://hr.example.com';

  it('creates statements with ADL verbs, deterministic ids and scaled scores', async () => {
    const course = await bundledCourse();
    const recs = records([{}, { result: 'failed', score: 40, activity: 'escalation' }, { result: 'attended', score: null, activity: 'tool-briefing' }, { result: 'completed', score: null }]);
    const statements = toStatements(recs, course, { accountHomePage: home });
    expect(statements.map((s) => s.verb.id)).toEqual([VERBS.passed, VERBS.failed, VERBS.attended, VERBS.completed]);
    expect(VERBS).toEqual({
      passed: 'http://adlnet.gov/expapi/verbs/passed',
      failed: 'http://adlnet.gov/expapi/verbs/failed',
      completed: 'http://adlnet.gov/expapi/verbs/completed',
      attended: 'http://adlnet.gov/expapi/verbs/attended',
    });
    const [first, second, third] = statements;
    expect(first).toMatchObject({
      actor: { objectType: 'Agent', account: { homePage: home, name: 'E1' } },
      object: { id: 'urn:groundwork:ai-literacy/ai-basics', definition: { type: 'http://adlnet.gov/expapi/activities/module' } },
      result: { score: { scaled: 0.9, raw: 90, min: 0, max: 100 }, success: true, completion: true },
      context: { contextActivities: { parent: [{ id: 'urn:groundwork:ai-literacy', definition: { type: 'http://adlnet.gov/expapi/activities/course' } }] } },
      timestamp: '2026-11-02T00:00:00.000Z',
    });
    expect(second?.result).toEqual({ score: { scaled: 0.4, raw: 40, min: 0, max: 100 }, success: false });
    expect(third?.object.definition).toBeUndefined();
    for (const s of statements) expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(toStatements(recs, course, { accountHomePage: home })[0]?.id).toBe(first?.id);
    expect(new Set(statements.map((s) => s.id)).size).toBe(statements.length);
  });

  it('keeps statement ids when an erasure rewrites the chain', async () => {
    const course = await bundledCourse();
    const recs = records([{ person: 'E1' }, { person: 'E2' }, { person: 'E3' }]);
    const header = createHeader({ now: NOW });
    let last: Entry = header;
    const lines = [serializeEntry(header)];
    for (const r of recs) {
      const e = createRecord(header, last, r, { now: new Date(r.ts) });
      lines.push(serializeEntry(e));
      last = e;
    }
    const verified = verifyChain(`${lines.join('\n')}\n`, { now: NOW });
    const before = toStatements(verified.records, course, { accountHomePage: home });
    const rewritten = verifyChain(rewriteChain(verified, (r) => r.person !== 'E1', 'erasure', { now: NOW }).text, { now: NOW });
    const after = toStatements(rewritten.records, course, { accountHomePage: home });
    expect(rewritten.records[0]?.hash).not.toBe(verified.records[1]?.hash);
    expect(after.map((s) => s.id)).toEqual(before.slice(1).map((s) => s.id));
  });

  it('computes RFC 4122 version 5 UUIDs', () => {
    // RFC 4122 appendix B errata / common test vector: DNS namespace, "www.example.com".
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('round-trips through statements', async () => {
    const course = await bundledCourse();
    const recs = records([{}, { person: 'E2', result: 'failed', score: 40 }]);
    const statements = toStatements(recs, course, { accountHomePage: home });
    const back = fromStatements({ statements, more: '' }, { courseId: course.id, role: 'staff', accountHomePage: home }, NOW);
    expect(back.inputs.map((i) => [i.person, i.result, i.score, i.date])).toEqual([
      ['E1', 'passed', 90, '2026-11-02'],
      ['E2', 'failed', 40, '2026-11-02'],
    ]);
    expect(back.skipped.size).toBe(0);
  });

  it('skips statements it cannot map, and counts why', () => {
    const base = { actor: { account: { homePage: home, name: 'E1' } }, verb: { id: VERBS.passed }, object: { id: 'urn:groundwork:ai-literacy/ai-basics' }, timestamp: '2026-11-01T10:00:00Z' };
    const r = fromStatements(
      [
        base,
        { ...base, verb: { id: 'http://adlnet.gov/expapi/verbs/experienced' } },
        { ...base, verb: { id: 'http://adlnet.gov/expapi/verbs/voided' } },
        { ...base, actor: { mbox: 'mailto:a@example.com' } },
        { ...base, actor: { account: { homePage: 'https://other.example', name: 'E9' } } },
        { ...base, object: { id: 'urn:groundwork:other-course/ai-basics' } },
        { ...base, object: { id: 'urn:groundwork:ai-literacy/../../x' } },
        { ...base, result: { score: { scaled: 7 } } },
        { ...base, timestamp: 'yesterday' },
        { ...base, timestamp: '2099-01-01T00:00:00Z' },
        { ...base, actor: { account: { homePage: home, name: 'E1\u202E' } } },
        'garbage',
      ],
      { courseId: 'ai-literacy', role: 'staff', accountHomePage: home },
      NOW,
    );
    expect(r.inputs).toHaveLength(1);
    expect(Object.fromEntries(r.skipped)).toEqual({
      'other verb': 2,
      'actor without account': 1,
      'account from another system': 1,
      'activity not in this course': 2,
      'invalid score': 1,
      'invalid timestamp': 1,
      'invalid record': 2,
      'not a statement': 1,
    });
  });

  it('accepts email actors only when allowed, and raw scores', () => {
    const s = { actor: { mbox: 'mailto:jane@example.com' }, verb: { id: VERBS.completed }, object: { id: 'urn:groundwork:ai-literacy/ai-basics' }, result: { score: { raw: 15, min: 0, max: 20 } }, timestamp: '2026-11-01T23:30:00-02:00' };
    expect(fromStatements([s], { courseId: 'ai-literacy', role: 'staff' }, NOW).inputs).toHaveLength(0);
    expect(fromStatements([s], { courseId: 'ai-literacy', role: 'staff', allowEmail: true }, NOW).inputs[0]).toMatchObject({ person: 'jane@example.com', score: 75, date: '2026-11-01' });
  });

  it('validates options and input shape', () => {
    expect(() => { checkActivityBase('urn:groundwork:'); }).not.toThrow();
    expect(() => { checkActivityBase('https://lms.example.com/activities/'); }).not.toThrow();
    for (const bad of ['http://x/', 'https://x', 'javascript:x', 'urn:a b:', 'https://u:p@x/']) expect(() => { checkActivityBase(bad); }, bad).toThrow(XapiError);
    expect(() => fromStatements({ nope: [] }, { courseId: 'c', role: 'staff' })).toThrow(XapiError);
    expect(() => fromStatements(new Array(100_001).fill({}), { courseId: 'c', role: 'staff' })).toThrow(/More than/);
  });
});
