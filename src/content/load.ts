// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads a course directory from disk: `course.json` and `modules/*.md`.
 * Symbolic links and non-regular files are refused, and every file is
 * size-limited before it is read.
 *
 * @packageDocumentation
 */

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileLimited } from '../util/fs.js';
import type { Course } from './course.js';
import { MAX_COURSE_JSON_BYTES } from './course.js';
import { loadAndLint } from './lint.js';
import { ID_PATTERN, type ContentIssue, MAX_MODULE_BYTES } from './module.js';

/** Directory of the course content shipped with this package. */
export function bundledContentDir(): string {
  // src/content/load.ts and dist/content/load.js are both two levels below the package root.
  return fileURLToPath(new URL('../../content', import.meta.url));
}

/** Maximum number of files read from the modules directory. */
const MAX_MODULE_FILES = 100;

/**
 * Loads and lints the course in `dir`. Returns the course only if there are
 * no errors.
 */
export async function loadCourseDir(dir: string): Promise<{ course: Course | undefined; issues: ContentIssue[] }> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const read = async (path: string, max: number): Promise<string> => decoder.decode(await readFileLimited(path, max));
  let courseJson: string;
  try {
    courseJson = await read(join(dir, 'course.json'), MAX_COURSE_JSON_BYTES);
  } catch (error) {
    return { course: undefined, issues: [{ file: 'course.json', line: 1, severity: 'error', message: messageOf(error, 'Cannot read course.json.') }] };
  }
  const modulesDir = join(dir, 'modules');
  const issues: ContentIssue[] = [];
  const texts = new Map<string, string>();
  let names: string[];
  try {
    const info = await lstat(modulesDir);
    if (!info.isDirectory()) throw new Error('not a directory');
    names = (await readdir(modulesDir)).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return { course: undefined, issues: [{ file: 'modules/', line: 1, severity: 'error', message: 'Cannot read the modules directory.' }] };
  }
  if (names.length > MAX_MODULE_FILES) {
    return { course: undefined, issues: [{ file: 'modules/', line: 1, severity: 'error', message: `More than ${MAX_MODULE_FILES} module files.` }] };
  }
  for (const name of names) {
    const id = name.slice(0, -3);
    if (!ID_PATTERN.test(id)) {
      issues.push({ file: `modules/${name}`, line: 1, severity: 'warning', message: 'File name is not a valid module id; ignored.' });
      continue;
    }
    try {
      texts.set(id, await read(join(modulesDir, name), MAX_MODULE_BYTES));
    } catch (error) {
      issues.push({ file: `modules/${name}`, line: 1, severity: 'error', message: messageOf(error, 'Cannot read the file.') });
    }
  }
  const result = loadAndLint(courseJson, texts);
  const all = [...issues, ...result.issues];
  return { course: all.some((i) => i.severity === 'error') ? undefined : result.course, issues: all };
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return 'The file is not valid UTF-8.';
  return error instanceof Error && error.name === 'FileError' ? error.message : fallback;
}
