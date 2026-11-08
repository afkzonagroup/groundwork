// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The course: `course.json` plus one Markdown file per module in
 * `modules/<id>.md`.
 *
 * @packageDocumentation
 */

import { hasUnsafeCharacter } from '../util/text.js';
import { type ContentIssue, type CourseModule, ID_PATTERN, parseModule } from './module.js';

/** A role variant of the course. */
export interface Role {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/** Course metadata from course.json. */
export interface CourseMeta {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Version of the course content (semantic version). */
  readonly version: string;
  /** BCP 47 language tag of the content. */
  readonly language: string;
  /** Pass mark in percent (1 to 100). */
  readonly passMark: number;
  readonly roles: readonly Role[];
  readonly modules: readonly string[];
}

/** A complete course. */
export interface Course extends CourseMeta {
  readonly moduleList: readonly CourseModule[];
}

/** Maximum size of course.json in bytes. */
export const MAX_COURSE_JSON_BYTES = 64 * 1024;

/** Maximum number of modules and roles. */
export const COURSE_LIMITS = { modules: 50, roles: 10 } as const;

const COURSE_KEYS = ['id', 'title', 'description', 'version', 'language', 'passMark', 'roles', 'modules'] as const;
const ROLE_KEYS = ['id', 'title', 'description'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !hasUnsafeCharacter(value);
}

/** Parses and validates course.json. */
export function parseCourseJson(source: string, file = 'course.json'): { meta: CourseMeta | undefined; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const err = (message: string): void => {
    issues.push({ file, line: 1, severity: 'error', message });
  };
  if (source.length > MAX_COURSE_JSON_BYTES) {
    err(`course.json is larger than ${MAX_COURSE_JSON_BYTES} bytes.`);
    return { meta: undefined, issues };
  }
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    err('course.json is not valid JSON.');
    return { meta: undefined, issues };
  }
  if (!isRecord(data)) {
    err('course.json must contain a JSON object.');
    return { meta: undefined, issues };
  }
  for (const key of Object.keys(data)) if (!(COURSE_KEYS as readonly string[]).includes(key)) err(`Unknown key "${key}" in course.json.`);
  for (const key of COURSE_KEYS) if (!Object.hasOwn(data, key)) err(`course.json is missing "${key}".`);
  if (issues.length > 0) return { meta: undefined, issues };

  const { id, title, description, version, language, passMark, roles, modules } = data;
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || id.length > 48) err('"id" must be a lower-case identifier such as "ai-literacy".');
  if (!text(title, 120)) err('"title" must be a non-empty string of at most 120 characters.');
  if (!text(description, 500)) err('"description" must be a non-empty string of at most 500 characters.');
  if (typeof version !== 'string' || !/^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/.test(version)) err('"version" must be a version such as "1.0.0".');
  if (typeof language !== 'string' || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language)) err('"language" must be a language tag such as "en".');
  if (typeof passMark !== 'number' || !Number.isInteger(passMark) || passMark < 1 || passMark > 100) err('"passMark" must be a whole number from 1 to 100.');
  const roleList: Role[] = [];
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > COURSE_LIMITS.roles) err(`"roles" must be a list of 1 to ${COURSE_LIMITS.roles} roles.`);
  else {
    for (const r of roles as unknown[]) {
      if (!isRecord(r) || Object.keys(r).some((k) => !(ROLE_KEYS as readonly string[]).includes(k))) {
        err('Each role must be an object with id, title and description only.');
        continue;
      }
      if (typeof r.id !== 'string' || !ID_PATTERN.test(r.id) || r.id.length > 32 || !text(r.title, 80) || !text(r.description, 300)) {
        err('Each role needs an id (lower-case identifier), a title (at most 80 characters) and a description (at most 300).');
        continue;
      }
      if (roleList.some((x) => x.id === r.id)) err(`Duplicate role "${r.id}".`);
      roleList.push({ id: r.id, title: r.title, description: r.description });
    }
  }
  const moduleIds: string[] = [];
  if (!Array.isArray(modules) || modules.length === 0 || modules.length > COURSE_LIMITS.modules) err(`"modules" must be a list of 1 to ${COURSE_LIMITS.modules} module ids.`);
  else {
    for (const m of modules as unknown[]) {
      if (typeof m !== 'string' || !ID_PATTERN.test(m) || m.length > 48) {
        err('Module ids must be lower-case identifiers.');
        continue;
      }
      if (moduleIds.includes(m)) err(`Module "${m}" is listed twice.`);
      moduleIds.push(m);
    }
  }
  if (issues.length > 0) return { meta: undefined, issues };
  return {
    meta: {
      id: id as string,
      title: title as string,
      description: description as string,
      version: version as string,
      language: language as string,
      passMark: passMark as number,
      roles: roleList,
      modules: moduleIds,
    },
    issues,
  };
}

/**
 * Builds a course from the text of course.json and the module files.
 *
 * @param courseJson - Text of course.json.
 * @param moduleTexts - Module file text by module id.
 */
export function assembleCourse(courseJson: string, moduleTexts: ReadonlyMap<string, string>): { course: Course | undefined; issues: ContentIssue[] } {
  const { meta, issues } = parseCourseJson(courseJson);
  if (!meta) return { course: undefined, issues };
  const moduleList: CourseModule[] = [];
  for (const id of meta.modules) {
    const file = `modules/${id}.md`;
    const textOfModule = moduleTexts.get(id);
    if (textOfModule === undefined) {
      issues.push({ file, line: 1, severity: 'error', message: `Module "${id}" is listed in course.json but the file is missing.` });
      continue;
    }
    const parsed = parseModule(textOfModule, file);
    issues.push(...parsed.issues);
    if (parsed.module.id !== '' && parsed.module.id !== id) {
      issues.push({ file, line: 2, severity: 'error', message: `The id in the front matter ("${parsed.module.id}") does not match the file name.` });
    }
    moduleList.push(parsed.module);
  }
  for (const id of moduleTexts.keys()) {
    if (!meta.modules.includes(id)) issues.push({ file: `modules/${id}.md`, line: 1, severity: 'warning', message: 'This module file is not listed in course.json and is ignored.' });
  }
  return { course: { ...meta, moduleList }, issues };
}

/** Modules and questions of a course as seen by one role variant. */
export function questionsForRole(module: CourseModule, role: string): CourseModule['questions'] {
  return module.questions.filter((q) => q.roles.length === 0 || q.roles.includes(role));
}
