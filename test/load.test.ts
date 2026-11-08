// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Loading content from disk, file helpers, text helpers and module parsing
// edge cases.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadCourseDir } from '../src/content/load.js';
import { parseModule } from '../src/content/module.js';
import { DEFAULT_PLACEHOLDERS, renderBlocks } from '../src/site/render.js';
import { FileError, acquireLock, appendFileSafe, ensureDirectory, readFileLimited, writeFileSafe } from '../src/util/fs.js';
import { hasUnsafeCharacter, hasUnsafeTextCharacter, isIsoDate } from '../src/util/text.js';
import { MINIMAL_COURSE_JSON, cleanTmp, minimalModule, tmpDir } from './helpers.js';

const dir = tmpDir('load-');
afterAll(() => {
  cleanTmp(dir);
});
let n = 0;
const fresh = (name: string): string => join(dir, `${String(++n)}-${name}`);

function contentDir(modules: Record<string, string | Uint8Array>, courseJson: string = MINIMAL_COURSE_JSON): string {
  const d = fresh('content');
  mkdirSync(join(d, 'modules'), { recursive: true });
  writeFileSync(join(d, 'course.json'), courseJson);
  for (const [name, text] of Object.entries(modules)) writeFileSync(join(d, 'modules', name), text);
  return d;
}

describe('loading a course directory', () => {
  it('loads a valid course', async () => {
    const r = await loadCourseDir(contentDir({ 'm-one.md': minimalModule('m-one') }));
    expect(r.issues).toEqual([]);
    expect(r.course?.moduleList).toHaveLength(1);
  });

  it('accepts a byte order mark and CRLF line endings', async () => {
    const r = await loadCourseDir(contentDir({ 'm-one.md': `\uFEFF${minimalModule('m-one').replace(/\n/g, '\r\n')}` }));
    expect(r.issues).toEqual([]);
  });

  it('warns about unlisted and badly named files', async () => {
    const r = await loadCourseDir(contentDir({ 'm-one.md': minimalModule('m-one'), 'extra.md': minimalModule('extra'), 'Bad Name.md': 'x', 'notes.txt': 'x' }));
    expect(r.course).toBeDefined();
    expect(r.issues.map((i) => `${i.severity} ${i.file}`).sort()).toEqual(['warning modules/Bad Name.md', 'warning modules/extra.md']);
  });

  it('refuses symbolic links, invalid UTF-8 and oversized files', async () => {
    const target = fresh('secret.txt');
    writeFileSync(target, 'secret');
    const d = contentDir({});
    symlinkSync(target, join(d, 'modules', 'm-one.md'));
    const r = await loadCourseDir(d);
    expect(r.course).toBeUndefined();
    expect(r.issues.map((i) => i.message).join(' ')).toMatch(/symbolic link/);
    expect(JSON.stringify(r)).not.toContain('secret');
    const latin = await loadCourseDir(contentDir({ 'm-one.md': new Uint8Array([0xff, 0xfe, 0x41]) }));
    expect(latin.issues[0]?.message).toMatch(/not valid UTF-8/);
    const big = await loadCourseDir(contentDir({ 'm-one.md': 'x'.repeat(300 * 1024) }));
    expect(big.issues[0]?.message).toMatch(/limit/);
  });

  it('reports a missing course.json or modules directory', async () => {
    const empty = fresh('empty');
    mkdirSync(empty);
    expect((await loadCourseDir(empty)).issues[0]?.message).toMatch(/Cannot open/);
    writeFileSync(join(empty, 'course.json'), MINIMAL_COURSE_JSON);
    expect((await loadCourseDir(empty)).issues[0]?.message).toMatch(/modules directory/);
  });
});

describe('module parsing edge cases', () => {
  const messages = (text: string): string => parseModule(text, 'm.md').issues.map((i) => i.message).join(' | ');

  it('reports quiz structure problems', () => {
    const base = minimalModule('m-one');
    expect(messages(base.replace('### Question m-one-1', 'Stray paragraph.\n\n### Question m-one-1'))).toMatch(/must be "### Question <id>" blocks/);
    expect(messages(base.replace('### Question m-one-1', '### Question M_ONE'))).toMatch(/Quiz content must be/);
    expect(messages(base.replace('Explanation: Because 1.', 'Explanation: Because 1.\n\n::: note\nx\n:::'))).toMatch(/only paragraphs and lists/);
    expect(messages(base.replace('- [ ] Wrong B 1\n', '- [ ] Wrong B 1\n\nAfter options.\n'))).toMatch(/only "Explanation/);
    expect(messages(base.replace('Question 1 text?', '#### Sub\n\nQuestion 1 text?'))).toMatch(/question text may contain only paragraphs/);
  });

  it('reports section, container and source problems', () => {
    const base = minimalModule('m-one');
    expect(messages(base.replace('## Learning objectives', 'Before.\n\n## Learning objectives'))).toMatch(/before the first ## heading/);
    expect(messages(base.replace('Plain text.', '::: role\nx\n:::'))).toMatch(/needs at least one role id/);
    expect(messages(base.replace('Plain text.', '::: role staff\n## Big\n:::'))).toMatch(/Use ### or ####/);
    expect(messages(base.replace('Plain text.', '::: role staff\n::: role staff\nx\n:::\n:::'))).toMatch(/cannot contain another role container/);
    expect(messages(base.replace('Plain text.', '::: note staff\nx\n:::'))).toMatch(/takes no arguments/);
    expect(messages(base.replace('Plain text.', '::: note\n### H\n:::'))).toMatch(/cannot contain headings/);
    expect(messages(base.replace('- [AI Act', 'Text.\n\n- [AI Act'))).toMatch(/single bulleted list of links/);
    expect(messages(base.replace('- [AI Act, Article 4]', '- No link here [AI Act, Article 4]').replace(/\(https:[^)]*\)\n$/, '\n'))).toMatch(/exactly one link/);
    expect(messages(base.replace('## Sources', '## Quiz\n\n## Sources'))).toMatch(/More than one "## Quiz"/);
    expect(messages(base.replace('## Content\n\nPlain text.\n\n', ''))).toMatch(/no content sections/);
    expect(messages(base.replace('## Learning objectives', '## Sources\n\n- [x](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_4)\n\n## Learning objectives').replace(/\n## Sources\n\n- \[AI Act[^\n]*\n$/, '\n'))).toMatch(/Section order/);
  });

  it('reports front matter problems', () => {
    const base = minimalModule('m-one');
    expect(messages(base.replace('id: m-one', 'id: m-one\nid: m-one'))).toMatch(/Duplicate front matter key/);
    expect(messages(base.replace('id: m-one', 'id: M One'))).toMatch(/Invalid module id/);
    expect(messages(base.replace('title: Module m-one', `title: ${'t'.repeat(121)}`))).toMatch(/title is longer/);
    expect(messages(base.replace('summary: Summary of m-one.', `summary: ${'s'.repeat(301)}`))).toMatch(/summary is longer/);
    expect(messages(base.replace('minutes: 5\n', 'minutes: 5\nnot a pair\n'))).toMatch(/key: value/);
    expect(messages(base.replace('minutes: 5\n---', 'minutes: 5\n'))).toMatch(/not closed/);
    expect(messages(base.replace('minutes: 5\n', ''))).toMatch(/missing "minutes"/);
  });
});

describe('rendering', () => {
  it('renders code, emphasis, ordered lists and callouts', () => {
    const { module } = parseModule(minimalModule('m-one', { body: 'A `x<y` and *e*.\n\n1. one\n2. two\n\n::: warning\nCareful.\n:::\n\n::: example\nE.\n:::' }), 'm.md');
    const html = renderBlocks(module.sections[0]?.blocks ?? [], { placeholders: DEFAULT_PLACEHOLDERS, role: 'staff' });
    expect(html).toContain('<code>x&lt;y</code>');
    expect(html).toContain('<em>e</em>');
    expect(html).toContain('<ol>');
    expect(html).toContain('class="callout callout-warning" role="note" aria-label="Important"');
    expect(html).toContain('class="callout callout-example" role="note" aria-label="Example"');
  });
});

describe('file helpers', () => {
  it('writes new files with mode 0600 and refuses to overwrite', async () => {
    const f = fresh('a.txt');
    await writeFileSafe(f, 'one', { force: false });
    expect(statSync(f).mode & 0o777).toBe(0o600);
    await expect(writeFileSafe(f, 'two', { force: false })).rejects.toThrow(/already exists/);
    await writeFileSafe(f, 'three', { force: true, mode: 0o644 });
    expect(readFileSync(f, 'utf8')).toBe('three');
    expect(statSync(f).mode & 0o777).toBe(0o644);
    await expect(writeFileSafe(join(fresh('missing-dir'), 'x'), 'x', { force: false })).rejects.toThrow(/Cannot write/);
    await expect(writeFileSafe('', 'x', { force: false })).rejects.toThrow(/Invalid file path/);
    await expect(writeFileSafe('a\0b', 'x', { force: false })).rejects.toThrow(FileError);
  });

  it('refuses symbolic links and directories', async () => {
    const target = fresh('target');
    writeFileSync(target, 'keep');
    const link = fresh('link');
    symlinkSync(target, link);
    await expect(readFileLimited(link, 100)).rejects.toThrow(/symbolic link/);
    await expect(writeFileSafe(link, 'x', { force: true })).rejects.toThrow(/symbolic link/);
    await expect(writeFileSafe(link, 'x', { force: false })).rejects.toThrow(/already exists|symbolic link/);
    await expect(appendFileSafe(link, 'x')).rejects.toThrow(/symbolic link/);
    expect(readFileSync(target, 'utf8')).toBe('keep');
    await expect(readFileLimited(dir, 100)).rejects.toThrow(/not a regular file/);
    await expect(appendFileSafe(fresh('nope'), 'x')).rejects.toThrow(/Cannot open/);
    await expect(appendFileSafe(dir, 'x')).rejects.toThrow(FileError);
  });

  it('enforces read limits', async () => {
    const f = fresh('big');
    writeFileSync(f, 'x'.repeat(101));
    await expect(readFileLimited(f, 100)).rejects.toThrow(/limit is 100 bytes/);
    expect((await readFileLimited(f, 101)).length).toBe(101);
  });

  it('refuses FIFOs without blocking', async () => {
    const fifo = fresh('fifo');
    const mk = spawnSync('mkfifo', [fifo]);
    if (mk.error || mk.status !== 0) return;
    await expect(readFileLimited(fifo, 100)).rejects.toThrow(/not a regular file/);
  });

  it('creates directories but refuses links and files as directories', async () => {
    const d = join(fresh('nested'), 'a', 'b');
    await ensureDirectory(d);
    await ensureDirectory(d);
    expect(statSync(d).isDirectory()).toBe(true);
    const file = fresh('file');
    writeFileSync(file, '');
    await expect(ensureDirectory(file)).rejects.toThrow(/not a directory/);
    const link = fresh('dirlink');
    symlinkSync(d, link);
    await expect(ensureDirectory(link)).rejects.toThrow(/symbolic link/);
  });

  it('takes and releases an exclusive lock', async () => {
    const f = fresh('locked');
    const release = await acquireLock(f);
    await expect(acquireLock(f)).rejects.toThrow(/locked/);
    await release();
    const again = await acquireLock(f);
    await again();
  });
});

describe('text helpers', () => {
  it('finds unsafe characters', () => {
    for (const ch of ['\u0000', '\u0007', '\n', '\u007f', '\u0085', '\u00ad', '\u061C', '\u200B', '\u200E', '\u2028', '\u2029', '\u202A', '\u202E', '\u2066', '\u2069', '\uFEFF']) {
      expect(hasUnsafeCharacter(`a${ch}b`), ch.codePointAt(0)?.toString(16)).toBe(true);
    }
    expect(hasUnsafeCharacter('Zo\u00eb O\u2019Brien-\u0160imkut\u0117')).toBe(false);
    expect(hasUnsafeTextCharacter('line\r\nnext\tcol')).toBe(false);
    expect(hasUnsafeTextCharacter('a\u202Eb')).toBe(true);
    expect(hasUnsafeTextCharacter('a\u0001b')).toBe(true);
  });

  it('checks calendar dates', () => {
    for (const ok of ['2024-02-29', '2026-12-31', '1970-01-01']) expect(isIsoDate(ok), ok).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '1969-12-31', '2026-1-1', '20260101', '']) expect(isIsoDate(bad), bad).toBe(false);
  });
});
