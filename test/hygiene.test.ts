// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Repository-wide checks: hidden characters, dangerous APIs, network code,
// licence headers, package and CI configuration.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_ACTS, checkCitation, eurLexUrl } from '../src/legal/sources.js';
import { VERSION } from '../src/version.js';
import { ROOT } from './helpers.js';

const FILES = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f !== '' && !f.startsWith('test/.tmp/'));
const TEXT = FILES.filter((f) => /\.(ts|mts|mjs|js|json|md|yml|yaml|txt|css|html)$|^(LICENSE|LICENSE-CONTENT|\.gitignore|\.npmrc|\.editorconfig)$/.test(f));
const CODE = FILES.filter((f) => /\.(ts|mts|mjs|js)$/.test(f));
const SOURCES = CODE.filter((f) => f.startsWith('src/') && f !== 'src/site/client-script.generated.ts');
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

describe('hidden characters (Trojan Source)', () => {
  it('finds the files to scan', () => {
    expect(TEXT.length).toBeGreaterThan(40);
    expect(TEXT).toContain('content/modules/ai-basics.md');
    expect(TEXT).toContain('src/records/chain.ts');
  });

  it('has no bidirectional controls, invisible characters, line separators or stray control characters in any text file', () => {
    // U+202A-U+202E and U+2066-U+2069 (bidi), U+200B-U+200F (zero width, marks),
    // U+2028/U+2029 (separators), U+00AD, U+061C, U+FEFF, and C0/C1 controls except tab, LF and CR.
    const hidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/; // eslint-disable-line no-control-regex -- detecting control characters is the purpose
    for (const f of TEXT) {
      const text = read(f);
      const m = hidden.exec(text);
      expect(m, `${f}: U+${(m?.[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')} at offset ${String(m?.index ?? 0)}`).toBeNull();
    }
  });

  it('keeps code files ASCII-only, so escapes stay visible', () => {
    for (const f of CODE) expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(read(f)), f).toBe(true); // eslint-disable-line no-control-regex -- the allowed range is spelled out
  });
});

describe('source code', () => {
  it('uses no eval, Function constructor, dynamic import, child processes or HTML sinks', () => {
    const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /\bimport\s*\(/, /child_process/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /setAttribute\(\s*['"](on|style|href|src)/, /\.style\./];
    for (const f of SOURCES) for (const re of forbidden) expect(re.test(read(f)), `${f} matches ${String(re)}`).toBe(false);
  });

  it('contains no network code', () => {
    const network = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /RTCPeerConnection/, /\bnew\s+(Shared)?Worker\s*\(/, /window\.open/, /\blocation\.(href|assign|replace)\b/, /\brequire\s*\(/, /node:https?\b/, /node:net\b/, /node:dgram/, /node:tls/, /node:worker_threads/, /localStorage|sessionStorage|indexedDB|document\.cookie/];
    for (const f of [...SOURCES, 'src/site/client-script.generated.ts']) for (const re of network) expect(re.test(read(f)), `${f} matches ${String(re)}`).toBe(false);
  });

  it('has a copyright and licence header in every code file', () => {
    for (const f of CODE.filter((x) => x !== 'eslint.config.js' && x !== 'vitest.config.ts')) {
      expect(read(f), f).toMatch(/^(#!\/usr\/bin\/env node\n)?\/\/ Copyright 2026 MB AFKzona Group\n\/\/ SPDX-License-Identifier: AGPL-3\.0-only\n/);
    }
  });

  it('has no any, no ts-ignore and no eslint-disable without a reason', () => {
    for (const f of CODE.filter((x) => x.endsWith('.ts') && x !== 'test/hygiene.test.ts')) {
      const text = read(f);
      for (const m of text.matchAll(/\/[/*]\s*eslint-disable[^\n]*/g)) expect(m[0], f).toMatch(/ -- \S/);
      expect(/@ts-ignore|@ts-nocheck/.test(text), f).toBe(false);
      expect(/:\s*any\b|\bas any\b|<any>/.test(text), f).toBe(false);
    }
  });
});

describe('citations', () => {
  it('accepts listed acts and existing anchors only', () => {
    const ok = [
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_4',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#rct_20',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_4a',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#anx_XIV',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32026R1744#rct_8',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679#art_33',
      'https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers',
    ];
    for (const u of ok) expect(checkCitation(u).ok, u).toBe(true);
    const bad = [
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_114',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#rct_181',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#anx_XIV',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#rct_20',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689',
      'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32099R0001#art_1',
      'http://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_4',
      'https://eur-lex.europa.eu.evil.com/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_4',
      'https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers?x',
    ];
    for (const u of bad) expect(checkCitation(u).ok, u).toBe(false);
    expect(eurLexUrl('gdpr', 'art_5')).toBe('https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679#art_5');
    expect(() => eurLexUrl('gdpr', 'art_100')).toThrow();
    expect(() => eurLexUrl('nope', 'art_1')).toThrow();
    expect(LEGAL_ACTS.map((a) => a.celex)).toEqual(['32024R1689', '02024R1689-20260727', '32026R1744', '32016R0679']);
  });
});

describe('package', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;

  it('has zero runtime dependencies and no install scripts', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    const scripts = pkg.scripts as Record<string, string>;
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(scripts[hook]).toBeUndefined();
  });

  it('pins every development dependency exactly', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies as Record<string, string>)) expect(version, name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it('declares licence, engines, repository, exports and a files allow-list', () => {
    expect(pkg).toMatchObject({
      name: '@afkzona/groundwork',
      license: 'AGPL-3.0-only',
      type: 'module',
      engines: { node: '>=22' },
      repository: { type: 'git', url: 'git+https://github.com/afkzonagroup/groundwork.git' },
      bin: { groundwork: './dist/cli/main.js' },
    });
    expect(pkg.version).toBe(VERSION);
    expect(pkg.files).toEqual(expect.arrayContaining(['dist/', 'content/', 'LICENSE', 'LICENSE-CONTENT', 'LICENSE-ADDITIONAL-TERMS.md', 'COMMERCIAL.md', 'TRADEMARKS.md']));
    expect(pkg.exports).toHaveProperty('.');
  });

  it('runs CI only on pull requests and on demand, with pinned actions and read-only permissions', () => {
    for (const f of FILES.filter((x) => x.startsWith('.github/workflows/'))) {
      const yml = read(f);
      const on = /\non:\n((?: {2}.*\n)+)/.exec(yml)?.[1] ?? '';
      // The release workflow runs on a published GitHub release; everything else only on pull requests and on demand.
      const triggers = f.endsWith('/release.yml') ? ['release:', 'workflow_dispatch:'] : ['pull_request:', 'workflow_dispatch:'];
      expect(on.split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim()), f).toEqual(triggers);
      expect(yml, f).toMatch(/\npermissions:\n {2}contents: read\n/);
      for (const m of yml.matchAll(/uses: ([^\s]+)/g)) expect(m[1], f).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('carries the licences and attribution terms', () => {
    expect(read('LICENSE')).toMatch(/^Groundwork\nCopyright 2026 MB AFKzona Group\n/);
    expect(read('LICENSE')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(read('LICENSE-CONTENT')).toContain('Attribution 4.0 International');
    expect(read('LICENSE-ADDITIONAL-TERMS.md')).toContain('Groundwork by AFKzona Group');
  });
});
