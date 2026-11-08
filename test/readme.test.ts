// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Runs the TypeScript examples in README.md, so the documentation stays true.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT } from './helpers.js';

const TMP = join(import.meta.dirname, '.tmp', 'readme');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

function examples(): [string, string][] {
  const out: [string, string][] = [];
  for (const m of README.matchAll(/<!-- example:([a-z-]+) -->\n```ts\n([\s\S]*?)```/g)) out.push([m[1] ?? '', m[2] ?? '']);
  return out;
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('README examples', () => {
  it('has the expected examples', () => {
    expect(examples().map(([name]) => name)).toEqual(['course', 'records']);
  });

  it.each(examples())('runs the %s example', async (name, code) => {
    mkdirSync(TMP, { recursive: true });
    const file = join(TMP, `${name}.ts`);
    writeFileSync(file, code.replace(/'@afkzona\/groundwork'/g, `'${pathToFileURL(join(ROOT, 'src/index.ts')).href}'`));
    // eslint-disable-next-line no-restricted-syntax -- loads the README example written above, not user input
    await expect(import(pathToFileURL(file).href)).resolves.toBeDefined();
  });

  it('documents every CLI command in the help text and the README', async () => {
    const { run } = await import('../src/cli/run.js'); // eslint-disable-line no-restricted-syntax -- static module under test
    let help = '';
    await run(['--help'], { stdout: (t) => (help += t), stderr: () => undefined, env: {}, now: () => new Date() });
    for (const cmd of ['lint', 'build', 'scorm', 'check-scorm', 'record init', 'record add', 'record verify', 'record export', 'record import', 'record erase']) {
      expect(help, cmd).toContain(`groundwork ${cmd}`);
    }
    expect(README).toContain('Translations are welcome');
    expect(README).toContain('not legal advice');
  });
});
