// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Course } from '../src/content/course.js';
import { bundledContentDir, loadCourseDir } from '../src/content/load.js';
import type { CliIo } from '../src/cli/run.js';

export const ROOT = join(import.meta.dirname, '..');
const TMP_BASE = join(import.meta.dirname, '.tmp');

/** Creates a fresh temporary directory under test/.tmp (removed by cleanTmp). */
export function tmpDir(prefix = 'gw-'): string {
  mkdirSync(TMP_BASE, { recursive: true });
  return mkdtempSync(join(TMP_BASE, prefix));
}

export function cleanTmp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

let cached: Course | undefined;

/** The bundled course, loaded once. */
export async function bundledCourse(): Promise<Course> {
  if (cached) return cached;
  const { course, issues } = await loadCourseDir(bundledContentDir());
  if (!course) throw new Error(`Bundled course has errors: ${JSON.stringify(issues)}`);
  cached = course;
  return course;
}

/** Text of course.json and every module file, for building variants in tests. */
export function bundledTexts(): { courseJson: string; modules: Map<string, string> } {
  const dir = bundledContentDir();
  const modules = new Map<string, string>();
  for (const name of readdirSync(join(dir, 'modules'))) modules.set(name.replace(/\.md$/, ''), readFileSync(join(dir, 'modules', name), 'utf8'));
  return { courseJson: readFileSync(join(dir, 'course.json'), 'utf8'), modules };
}

/** CLI I/O that captures output. */
export function captureIo(env: Record<string, string | undefined> = {}, now = new Date('2026-11-08T12:00:00.000Z')): CliIo & { out: () => string; err: () => string } {
  let out = '';
  let err = '';
  return {
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    env,
    now: () => now,
    out: () => out,
    err: () => err,
  };
}

/** A minimal valid module for building test courses. */
export function minimalModule(id: string, extra: { body?: string; quiz?: string; sources?: string } = {}): string {
  const q = (n: number, roles = ''): string => `### Question ${id}-${String(n)}
${roles}Question ${String(n)} text?

${n % 2 === 0 ? `- [x] Right ${String(n)}\n- [ ] Wrong A ${String(n)}` : `- [ ] Wrong A ${String(n)}\n- [x] Right ${String(n)}`}
- [ ] Wrong B ${String(n)}

Explanation: Because ${String(n)}.
`;
  return `---
id: ${id}
title: Module ${id}
summary: Summary of ${id}.
minutes: 5
---

## Learning objectives

- One.
- Two.
- Three.

## Content

${extra.body ?? 'Plain text.'}

## Quiz

${extra.quiz ?? [1, 2, 3, 4].map((n) => q(n)).join('\n')}
## Sources

${extra.sources ?? '- [AI Act, Article 4](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_4)'}
`;
}

export const MINIMAL_COURSE_JSON = JSON.stringify({
  id: 'test-course',
  title: 'Test course',
  description: 'A course for tests.',
  version: '1.0.0',
  language: 'en',
  passMark: 80,
  roles: [
    { id: 'staff', title: 'All staff', description: 'Everyone.' },
    { id: 'managers', title: 'Managers', description: 'Managers.' },
  ],
  modules: ['m-one'],
});
