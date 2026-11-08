// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The groundwork command: validation, file safety, record flows, key
// handling and output sanitising.

import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UsageError, parseArgs } from '../src/cli/args.js';
import { insideDir, run, sanitizeOutput } from '../src/cli/run.js';
import { readZip } from '../src/zip/zip.js';
import { ROOT, captureIo, cleanTmp, tmpDir } from './helpers.js';

const dir = tmpDir('cli-');
afterAll(() => {
  cleanTmp(dir);
});

const KEY = 'test-key-0123456789-abcdefghijklmnop';
let n = 0;
const fresh = (name: string): string => join(dir, `${String(++n)}-${name}`);

async function cli(args: string[], env: Record<string, string | undefined> = {}) {
  const io = captureIo(env);
  const code = await run(args, io);
  return { code, out: io.out(), err: io.err() };
}

describe('arguments', () => {
  it('parses known options and rejects everything else', () => {
    const p = parseArgs(['--a', 'x', '--b=y', '--flag', '--m', '1', '--m', '2'], { a: 'string', b: 'string', flag: 'boolean', m: 'multi' });
    expect(p.strings.get('a')).toBe('x');
    expect(p.strings.get('b')).toBe('y');
    expect(p.flags.has('flag')).toBe(true);
    expect(p.multi.get('m')).toEqual(['1', '2']);
    expect(() => parseArgs(['--nope'], {})).toThrow(/Unknown option/);
    expect(() => parseArgs(['--a'], { a: 'string' })).toThrow(/needs a value/);
    expect(() => parseArgs(['--a', 'x', '--a', 'y'], { a: 'string' })).toThrow(/more than once/);
    expect(() => parseArgs(['--f=1'], { f: 'boolean' })).toThrow(/takes no value/);
    expect(() => parseArgs(['stray'], {})).toThrow(/Unexpected argument/);
    expect(() => parseArgs(['--a', 'x\0y'], { a: 'string' })).toThrow(/NUL/);
    expect(() => parseArgs(['--a', 'x'.repeat(5000)], { a: 'string' })).toThrow(/too long/);
    expect(() => parseArgs(['--__proto__', 'x'], { a: 'string' })).toThrow(/Unknown option/);
    expect(() => parseArgs(['--toString', 'x'], { a: 'string' })).toThrow(/Unknown option/);
  });
});

describe('help and errors', () => {
  it('shows help with the attribution notice', async () => {
    const r = await cli(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Groundwork by AFKzona Group <https://afkzonagroup.lt>');
    expect(r.out).toContain('not legal advice');
    expect((await cli([])).code).toBe(2);
    const pkgVersion = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    expect((await cli(['--version'])).out).toBe(`${pkgVersion}\n`);
  });

  it('exits with 2 and a clear message for usage errors, without stack traces', async () => {
    for (const args of [['nope'], ['build'], ['record'], ['record', 'add', '--file', 'x'], ['build', '--out', dir, '--bogus', '1']]) {
      const r = await cli(args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.err).toMatch(/^groundwork: /);
      expect(r.err).not.toMatch(/\n\s+at /);
    }
  });

  it('escapes control and bidirectional characters in everything it prints', async () => {
    expect(sanitizeOutput('a\u001b[31mred\u202Ex\r\ny\rz\u2028')).toBe('a\\u{1b}[31mred\\u{202e}x\r\ny\\u{d}z\\u{2028}');
    const r = await cli(['nope\u202Eevil']);
    expect(r.err).toContain('\\u{202e}');
    expect(r.err).not.toContain('\u202E');
  });
});

describe('lint, build and scorm', () => {
  it('lints the bundled content', async () => {
    const r = await cli(['lint']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Content OK: 7 modules, \d+ questions, 3 roles/);
  });

  it('fails lint for broken content', async () => {
    const content = fresh('content');
    mkdirSync(join(content, 'modules'), { recursive: true });
    writeFileSync(join(content, 'course.json'), '{}');
    const r = await cli(['lint', '--content', content]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/error course.json:1 course.json is missing "id"/);
    expect((await cli(['build', '--content', content, '--out', fresh('site')])).code).toBe(1);
  });

  it('builds the site and refuses to overwrite without --force', async () => {
    const out = fresh('site');
    const r = await cli(['build', '--out', out, '--role', 'staff', '--organisation', 'Example Ltd']);
    expect(r.code).toBe(0);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('Groundwork by AFKzona Group');
    expect(statSync(join(out, 'ai-basics.html')).mode & 0o777).toBe(0o644);
    expect((await cli(['build', '--out', out, '--role', 'staff'])).err).toMatch(/already exists/);
    expect((await cli(['build', '--out', out, '--role', 'staff', '--force'])).code).toBe(0);
    const all = fresh('site-all');
    expect((await cli(['build', '--out', all])).code).toBe(0);
    expect(existsSync(join(all, 'managers', 'escalation.html'))).toBe(true);
  });

  it('keeps generated paths inside the output directory', () => {
    const base = fresh('site-paths');
    expect(insideDir(base, 'staff/index.html')).toBe(join(resolve(base), 'staff', 'index.html'));
    for (const bad of ['../escape.html', 'staff/../../escape.html', '/etc/passwd', '.', '']) expect(() => insideDir(base, bad), bad).toThrow(UsageError);
  });

  it('refuses symbolic links as output directory or file', async () => {
    const real = fresh('real');
    mkdirSync(real);
    const link = fresh('link');
    symlinkSync(real, link);
    expect((await cli(['build', '--out', link, '--role', 'staff'])).err).toMatch(/symbolic link/);
    const target = fresh('target.txt');
    writeFileSync(target, 'keep');
    const zipLink = fresh('pkg.zip');
    symlinkSync(target, zipLink);
    const r = await cli(['scorm', '--out', zipLink, '--force']);
    expect(r.err).toMatch(/symbolic link/);
    expect(readFileSync(target, 'utf8')).toBe('keep');
  });

  it('writes and checks a SCORM package', async () => {
    const out = fresh('pkg.zip');
    const r = await cli(['scorm', '--out', out, '--role', 'builders']);
    expect(r.code).toBe(0);
    expect(readZip(readFileSync(out)).map((e) => e.name)[0]).toBe('imsmanifest.xml');
    expect((await cli(['check-scorm', out])).out).toMatch(/passed the SCORM 1.2 structure checks/);
    const bad = fresh('bad.zip');
    writeFileSync(bad, 'nope');
    expect((await cli(['check-scorm', bad])).code).toBe(1);
    expect((await cli(['scorm', '--out', fresh('x.zip'), '--role', 'ceo'])).err).toMatch(/Unknown role/);
  });
});

describe('records', () => {
  it('runs init, add, verify and export', async () => {
    const file = fresh('records.jsonl');
    expect((await cli(['record', 'init', '--file', file])).code).toBe(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const add = ['record', 'add', '--file', file, '--person', 'E1001', '--role', 'staff', '--activity', 'ai-basics', '--result', 'passed', '--score', '90', '--date', '2026-11-01'];
    expect((await cli(add)).out).toMatch(/Added 1 record/);
    expect((await cli(add)).out).toMatch(/identical record already exists/);
    expect((await cli(['record', 'add', '--file', file, '--person', 'E1002', '--role', 'staff', '--activity', 'escalation', '--result', 'attended'])).code).toBe(0);
    const verify = await cli(['record', 'verify', '--file', file]);
    expect(verify.code).toBe(0);
    expect(verify.out).toMatch(/OK: 2 records, hashes verified \(no HMAC\)/);
    const head = /Head: ([0-9a-f]{64})/.exec(verify.out)?.[1] ?? '';
    expect((await cli(['record', 'verify', '--file', file, '--expect-head', head])).code).toBe(0);
    const csv = await cli(['record', 'export', '--file', file, '--format', 'csv', '--out', '-']);
    expect(csv.out.split('\r\n')[2]).toMatch(/^2,2026-11-08,E1002,staff,escalation,attended,,manual,/);
    const out = fresh('export.json');
    expect((await cli(['record', 'export', '--file', file, '--format', 'json', '--out', out])).code).toBe(0);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const xapi = await cli(['record', 'export', '--file', file, '--format', 'xapi', '--out', '-', '--account-home-page', 'https://hr.example.com']);
    expect(JSON.parse(xapi.out)).toHaveLength(2);
    expect((await cli(['record', 'export', '--file', file, '--format', 'xapi', '--out', '-'])).err).toMatch(/--account-home-page is required/);
  });

  it('validates record input', async () => {
    const file = fresh('records.jsonl');
    await cli(['record', 'init', '--file', file]);
    const base = ['record', 'add', '--file', file, '--person', 'E1', '--role', 'staff', '--activity', 'ai-basics'];
    expect((await cli([...base, '--result', 'great'])).err).toMatch(/--result must be one of/);
    expect((await cli([...base, '--result', 'passed', '--score', '101'])).err).toMatch(/--score/);
    expect((await cli([...base, '--result', 'passed', '--date', '2030-01-01'])).err).toMatch(/future/);
    expect((await cli([...base.slice(0, 4), '--person', '=evil\u0007', '--role', 'staff', '--activity', 'x', '--result', 'passed'])).err).toMatch(/person must be/);
  });

  it('fails verification and refuses to add to a tampered file', async () => {
    const file = fresh('records.jsonl');
    await cli(['record', 'init', '--file', file]);
    await cli(['record', 'add', '--file', file, '--person', 'E1', '--role', 'staff', '--activity', 'ai-basics', '--result', 'failed', '--score', '40']);
    await cli(['record', 'add', '--file', file, '--person', 'E2', '--role', 'staff', '--activity', 'ai-basics', '--result', 'passed', '--score', '90']);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"result":"failed"', '"result":"passed"'));
    const v = await cli(['record', 'verify', '--file', file]);
    expect(v.code).toBe(1);
    expect(v.out).toMatch(/line 2: The hash does not match/);
    const add = await cli(['record', 'add', '--file', file, '--person', 'E3', '--role', 'staff', '--activity', 'ai-basics', '--result', 'passed']);
    expect(add.code).toBe(2);
    expect(add.err).toMatch(/does not verify.*Nothing was added/);
    expect((await cli(['record', 'export', '--file', file, '--format', 'csv', '--out', '-'])).code).toBe(1);
  });

  it('uses HMAC with a key from the environment and never prints the key', async () => {
    const file = fresh('records.jsonl');
    const env = { GROUNDWORK_RECORD_KEY: KEY };
    expect((await cli(['record', 'init', '--file', file, '--hmac'])).err).toMatch(/needs the key/);
    expect((await cli(['record', 'init', '--file', file], env)).err).toMatch(/add --hmac/);
    const outputs: string[] = [];
    for (const args of [
      ['record', 'init', '--file', file, '--hmac'],
      ['record', 'add', '--file', file, '--person', 'E1', '--role', 'staff', '--activity', 'ai-basics', '--result', 'passed'],
      ['record', 'verify', '--file', file, '--require-hmac'],
    ]) {
      const r = await cli(args, env);
      expect(r.code, args.join(' ')).toBe(0);
      outputs.push(r.out, r.err);
    }
    expect(outputs.join('')).toMatch(/hashes and HMAC verified/);
    const wrong = await cli(['record', 'verify', '--file', file], { GROUNDWORK_RECORD_KEY: 'x'.repeat(40) });
    expect(wrong.code).toBe(1);
    outputs.push(wrong.out, wrong.err);
    expect((await cli(['record', 'add', '--file', file, '--person', 'E2', '--role', 'staff', '--activity', 'ai-basics', '--result', 'passed'])).err).toMatch(/uses HMAC/);
    expect((await cli(['record', 'verify', '--file', file, '--require-hmac'])).code).toBe(1);
    expect((await cli(['record', 'verify', '--file', file], { GROUNDWORK_RECORD_KEY: 'short' })).code).toBe(1);
    const exported = await cli(['record', 'export', '--file', file, '--format', 'csv', '--out', '-']);
    expect(exported.err).toMatch(/HMAC not checked/);
    expect((await cli(['record', 'erase', '--file', file, '--out', fresh('erased.jsonl'), '--person', 'E1'])).err).toMatch(/uses HMAC; set GROUNDWORK_RECORD_KEY/);
    const erased = fresh('erased-with-key.jsonl');
    expect((await cli(['record', 'erase', '--file', file, '--out', erased, '--person', 'E1'], env)).code).toBe(0);
    expect((await cli(['record', 'verify', '--file', erased, '--require-hmac'], env)).code).toBe(0);
    for (const o of outputs) expect(o).not.toContain(KEY);
    expect(readFileSync(file, 'utf8')).not.toContain(KEY);
  });

  it('refuses to append while another process holds the lock', async () => {
    const file = fresh('records.jsonl');
    await cli(['record', 'init', '--file', file]);
    writeFileSync(`${file}.lock`, '123\n');
    const r = await cli(['record', 'add', '--file', file, '--person', 'E1', '--role', 'staff', '--activity', 'ai-basics', '--result', 'passed']);
    expect(r.err).toMatch(/locked/);
  });

  it('imports CSV and xAPI', async () => {
    const file = fresh('records.jsonl');
    await cli(['record', 'init', '--file', file]);
    const csv = fresh('report.csv');
    writeFileSync(csv, 'User;Lesson;Date;Status;Score\nE1;ai-basics;2026-11-01;passed;95\nE2;ai-basics;2026-11-01;incomplete;\n');
    const columns = ['--column', 'person=User', '--column', 'activity=Lesson', '--column', 'date=Date', '--column', 'result=Status', '--column', 'score=Score'];
    const r = await cli(['record', 'import', '--file', file, '--format', 'csv', '--input', csv, '--role', 'staff', '--delimiter', 'semicolon', ...columns]);
    expect(r.out).toMatch(/Imported 1 records \(0 duplicates skipped\)\. Skipped 1 rows/);
    const again = await cli(['record', 'import', '--file', file, '--format', 'csv', '--input', csv, '--role', 'staff', '--delimiter', 'semicolon', ...columns]);
    expect(again.out).toMatch(/Imported 0 records \(1 duplicates skipped\)/);
    const statements = fresh('statements.json');
    writeFileSync(statements, JSON.stringify([{ actor: { account: { homePage: 'https://hr.example.com', name: 'E3' } }, verb: { id: 'http://adlnet.gov/expapi/verbs/passed' }, object: { id: 'urn:groundwork:ai-literacy/escalation' }, result: { score: { scaled: 0.8 } }, timestamp: '2026-11-02T10:00:00Z' }]));
    const x = await cli(['record', 'import', '--file', file, '--format', 'xapi', '--input', statements, '--role', 'managers']);
    expect(x.out).toMatch(/Imported 1 records/);
    expect((await cli(['record', 'verify', '--file', file])).out).toMatch(/OK: 2 records/);
    expect((await cli(['record', 'import', '--file', file, '--format', 'xapi', '--input', statements])).err).toMatch(/--role is required/);
    // An invalid role is a usage error, not a silent "Imported 0 records".
    expect((await cli(['record', 'import', '--file', file, '--format', 'xapi', '--input', statements, '--role', 'All Staff'])).err).toMatch(/--role must be a lower-case id/);
    expect((await cli(['record', 'import', '--file', file, '--format', 'csv', '--input', csv, '--role', 'staff', '--column', 'nope=X'])).err).toMatch(/--column must look like/);
    const badCsv = fresh('bad.csv');
    writeFileSync(badCsv, 'User;Lesson;Date;Status;Score\nE1;ai-basics;2026-11-01;passed;999\n');
    expect((await cli(['record', 'import', '--file', file, '--format', 'csv', '--input', badCsv, '--role', 'staff', '--delimiter', 'semicolon', ...columns])).code).toBe(1);
  });

  it('erases a person into a new verified file', async () => {
    const file = fresh('records.jsonl');
    await cli(['record', 'init', '--file', file]);
    for (const p of ['E1', 'E2']) await cli(['record', 'add', '--file', file, '--person', p, '--role', 'staff', '--activity', 'ai-basics', '--result', 'passed']);
    const out = fresh('erased.jsonl');
    expect((await cli(['record', 'erase', '--file', file, '--out', file, '--person', 'E1'])).err).toMatch(/must be a new file/);
    expect((await cli(['record', 'erase', '--file', file, '--out', out])).err).toMatch(/exactly one/);
    // The same file under another name (hard link, or another letter case on macOS) is refused even with --force.
    const alias = fresh('alias.jsonl');
    linkSync(file, alias);
    expect((await cli(['record', 'erase', '--file', file, '--out', alias, '--person', 'E1', '--force'])).err).toMatch(/must be a new file/);
    expect((await cli(['record', 'verify', '--file', file])).out).toMatch(/OK: 2 records/);
    const r = await cli(['record', 'erase', '--file', file, '--out', out, '--person', 'E1']);
    expect(r.out).toMatch(/without 1 records/);
    expect(readFileSync(out, 'utf8')).not.toContain('"E1"');
    const v = await cli(['record', 'verify', '--file', out]);
    expect(v.out).toMatch(/OK: 1 records[\s\S]*for erasure; 1 records removed/);
    const retained = fresh('retained.jsonl');
    expect((await cli(['record', 'erase', '--file', file, '--out', retained, '--before', '2026-11-09'])).out).toMatch(/without 2 records/);
  });

  it('refuses FIFOs, oversized and non-UTF-8 inputs', async () => {
    const fifo = fresh('fifo');
    const mk = spawnSync('mkfifo', [fifo]);
    if (!mk.error && mk.status === 0) expect((await cli(['record', 'verify', '--file', fifo])).err).toMatch(/not a regular file/);
    const latin = fresh('latin.jsonl');
    writeFileSync(latin, Buffer.from([0xff, 0xfe, 0x0a]));
    expect((await cli(['record', 'verify', '--file', latin])).err).toMatch(/not valid UTF-8/);
    expect((await cli(['record', 'verify', '--file', fresh('missing')])).err).toMatch(/Cannot open/);
  });
});

describe('installed command', () => {
  it('has a shebang and runs through Node', () => {
    expect(readFileSync(join(ROOT, 'src/cli/main.ts'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});
