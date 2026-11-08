// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Content rules beyond syntax: every module has objectives, a usable quiz
 * for every role and official sources; every link is an allowed citation.
 *
 * @packageDocumentation
 */

import { checkCitation } from '../legal/sources.js';
import { type Course, assembleCourse, questionsForRole } from './course.js';
import { type Block, inlineLinks, inlineText } from './markdown.js';
import type { BodyBlock, ContentIssue, CourseModule } from './module.js';

/** Content rule thresholds. */
export const LINT_RULES = {
  minObjectives: 3,
  maxObjectives: 8,
  minQuestionsPerRole: 4,
  minOptions: 3,
  maxOptions: 5,
  minEurLexSources: 1,
} as const;

function blockLinks(blocks: readonly (Block | BodyBlock)[]): { href: string; line: number }[] {
  const out: { href: string; line: number }[] = [];
  for (const b of blocks) {
    if (b.t === 'heading' || b.t === 'paragraph') for (const href of inlineLinks(b.c)) out.push({ href, line: b.line });
    else if (b.t === 'list') for (const item of b.items) for (const href of inlineLinks(item.c)) out.push({ href, line: item.line });
    else out.push(...blockLinks(b.blocks));
  }
  return out;
}

function blockText(blocks: readonly (Block | BodyBlock)[]): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const b of blocks) {
    if (b.t === 'heading' || b.t === 'paragraph') out.push({ text: inlineText(b.c), line: b.line });
    else if (b.t === 'list') for (const item of b.items) out.push({ text: inlineText(item.c), line: item.line });
    else out.push(...blockText(b.blocks));
  }
  return out;
}

function roleIdsUsed(blocks: readonly BodyBlock[]): { role: string; line: number }[] {
  const out: { role: string; line: number }[] = [];
  for (const b of blocks) if (b.t === 'role') for (const role of b.roles) out.push({ role, line: b.line });
  return out;
}

function lintModule(course: Course, m: CourseModule, seenQuestionIds: Map<string, string>): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const err = (line: number, message: string): void => {
    issues.push({ file: m.file, line, severity: 'error', message });
  };
  const warn = (line: number, message: string): void => {
    issues.push({ file: m.file, line, severity: 'warning', message });
  };
  const roleIds = new Set(course.roles.map((r) => r.id));

  if (m.objectives.length < LINT_RULES.minObjectives || m.objectives.length > LINT_RULES.maxObjectives) {
    err(1, `A module needs ${LINT_RULES.minObjectives} to ${LINT_RULES.maxObjectives} learning objectives; found ${m.objectives.length}.`);
  }

  for (const s of m.sections) for (const { role, line } of roleIdsUsed(s.blocks)) if (!roleIds.has(role)) err(line, `Unknown role "${role}".`);

  for (const q of m.questions) {
    if (!q.id.startsWith(`${m.id}-`)) err(q.line, `Question id "${q.id}" must start with the module id "${m.id}-".`);
    const other = seenQuestionIds.get(q.id);
    if (other !== undefined) err(q.line, `Question id "${q.id}" is also used in ${other}.`);
    seenQuestionIds.set(q.id, m.file);
    for (const role of q.roles) if (!roleIds.has(role)) err(q.line, `Unknown role "${role}" in question ${q.id}.`);
    if (q.stem.length === 0) err(q.line, `Question ${q.id} has no question text.`);
    if (q.options.length < LINT_RULES.minOptions || q.options.length > LINT_RULES.maxOptions) {
      err(q.line, `Question ${q.id} needs ${LINT_RULES.minOptions} to ${LINT_RULES.maxOptions} answer options; found ${q.options.length}.`);
    }
    const correct = q.options.filter((o) => o.correct).length;
    if (correct !== 1) err(q.line, `Question ${q.id} must have exactly one correct option ([x]); found ${correct}.`);
    if (q.explanation.length === 0) err(q.line, `Question ${q.id} has no "Explanation: ...".`);
    const texts = q.options.map((o) => inlineText(o.c).trim().toLowerCase());
    if (new Set(texts).size !== texts.length) err(q.line, `Question ${q.id} has two identical options.`);
  }

  for (const role of course.roles) {
    const n = questionsForRole(m, role.id).length;
    if (n < LINT_RULES.minQuestionsPerRole) err(1, `The quiz has ${n} questions for role "${role.id}"; at least ${LINT_RULES.minQuestionsPerRole} are needed.`);
  }
  const positions = new Set(m.questions.map((q) => q.options.findIndex((o) => o.correct)));
  if (m.questions.length >= 4 && positions.size === 1) warn(1, 'The correct answer is in the same position in every question.');

  // Links: every link anywhere in the module must be an allowed citation.
  const links: { href: string; line: number }[] = [];
  for (const s of m.sections) links.push(...blockLinks(s.blocks));
  for (const q of m.questions) {
    links.push(...blockLinks(q.stem), ...blockLinks(q.explanation));
    for (const o of q.options) for (const href of inlineLinks(o.c)) links.push({ href, line: q.line });
  }
  for (const o of m.objectives) for (const href of inlineLinks(o)) links.push({ href, line: 1 });
  for (const s of m.sources) links.push({ href: s.href, line: s.line });
  for (const { href, line } of links) {
    const check = checkCitation(href);
    if (!check.ok) err(line, `Link ${href} is not allowed: ${check.reason}.`);
  }
  const eurLex = m.sources.filter((s) => {
    const c = checkCitation(s.href);
    return c.ok && c.kind === 'eur-lex';
  });
  if (eurLex.length < LINT_RULES.minEurLexSources) err(1, 'The Sources section needs at least one EUR-Lex citation.');
  const sourceSet = new Set(m.sources.map((s) => s.href));
  if (sourceSet.size !== m.sources.length) warn(1, 'The Sources section lists the same link twice.');
  for (const { href, line } of links) {
    if (!sourceSet.has(href)) warn(line, `Link ${href} is used in the text but not listed under Sources.`);
  }

  // Text that looks like HTML is shown literally; flag it because it is almost always a mistake.
  const allText: { text: string; line: number }[] = [];
  for (const s of m.sections) allText.push(...blockText(s.blocks));
  for (const q of m.questions) allText.push(...blockText(q.stem), ...blockText(q.explanation), ...q.options.map((o) => ({ text: inlineText(o.c), line: q.line })));
  for (const { text, line } of allText) {
    if (/<\/?[a-zA-Z][^<>]*>/.test(text)) err(line, 'Text contains an HTML tag; raw HTML is not supported and would be shown as text.');
  }
  return issues;
}

/** Runs every content rule on an assembled course. */
export function lintCourse(course: Course): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seen = new Map<string, string>();
  for (const m of course.moduleList) issues.push(...lintModule(course, m, seen));
  return issues;
}

/**
 * Parses and lints a course from its files. Returns the course only if
 * there are no errors.
 */
export function loadAndLint(courseJson: string, moduleTexts: ReadonlyMap<string, string>): { course: Course | undefined; issues: ContentIssue[] } {
  const assembled = assembleCourse(courseJson, moduleTexts);
  const issues = [...assembled.issues];
  if (assembled.course) issues.push(...lintCourse(assembled.course));
  const hasErrors = issues.some((i) => i.severity === 'error');
  return { course: hasErrors ? undefined : assembled.course, issues };
}

