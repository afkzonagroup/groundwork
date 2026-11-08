// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Parses one course module file: front matter, learning objectives, body
 * with role variants, quiz bank and sources.
 *
 * File layout:
 *
 * ```text
 * ---
 * id: ai-basics
 * title: What AI systems are and how they fail
 * summary: One sentence for the course overview.
 * minutes: 15
 * ---
 *
 * ## Learning objectives
 * - ...
 *
 * ## Any content section
 * ...
 * ::: role builders managers
 * Content shown only in these role variants.
 * :::
 *
 * ## Quiz
 * ### Question ai-basics-1
 * Roles: builders            (optional; default: every role)
 * The question.
 * - [ ] wrong
 * - [x] right
 * Explanation: Why.
 *
 * ## Sources
 * - [Article 4 of the AI Act](https://eur-lex.europa.eu/...)
 * ```
 *
 * @packageDocumentation
 */

import { hasUnsafeTextCharacter } from '../util/text.js';
import { type Block, type Inline, type ParseIssue, inlineText, parseBlocks, parseInline } from './markdown.js';

/** Identifier syntax for modules, questions and roles. */
export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Container names allowed in module bodies. */
export const CALLOUT_KINDS = ['note', 'example', 'warning'] as const;

/** A body block, possibly limited to some role variants. */
export type BodyBlock = Block | { readonly t: 'role'; readonly roles: readonly string[]; readonly blocks: readonly Block[]; readonly line: number };

/** A section of the module body under a `##` heading. */
export interface Section {
  readonly heading: readonly Inline[];
  readonly headingText: string;
  readonly blocks: readonly BodyBlock[];
  readonly line: number;
}

/** One answer option. */
export interface QuizOption {
  readonly c: readonly Inline[];
  readonly correct: boolean;
}

/** A multiple-choice question with one correct answer. */
export interface Question {
  readonly id: string;
  /** Role variants that include the question; empty means every role. */
  readonly roles: readonly string[];
  readonly stem: readonly Block[];
  readonly options: readonly QuizOption[];
  readonly explanation: readonly Block[];
  readonly line: number;
}

/** A cited source. */
export interface Source {
  readonly c: readonly Inline[];
  readonly href: string;
  readonly line: number;
}

/** A parsed course module. */
export interface CourseModule {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly minutes: number;
  readonly objectives: readonly (readonly Inline[])[];
  readonly sections: readonly Section[];
  readonly questions: readonly Question[];
  readonly sources: readonly Source[];
  /** File name the module came from, for messages. */
  readonly file: string;
}

/** A problem in a content file. */
export interface ContentIssue {
  readonly file: string;
  readonly line: number;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/** Maximum size of one module file in bytes. */
export const MAX_MODULE_BYTES = 256 * 1024;

const FRONT_KEYS = ['id', 'title', 'summary', 'minutes'] as const;

interface FrontMatter {
  id: string;
  title: string;
  summary: string;
  minutes: number;
}

function parseFrontMatter(lines: readonly string[], file: string, issues: ContentIssue[]): { front: FrontMatter; bodyStart: number } {
  const front: FrontMatter = { id: '', title: '', summary: '', minutes: 0 };
  if (lines[0] !== '---') {
    issues.push({ file, line: 1, severity: 'error', message: 'The file must start with front matter between --- lines.' });
    return { front, bodyStart: 0 };
  }
  const seen = new Set<string>();
  let i = 1;
  for (; i < lines.length && i < 50; i++) {
    const line = lines[i] ?? '';
    if (line === '---') break;
    const m = /^([a-z]+): (.+)$/.exec(line);
    if (!m) {
      issues.push({ file, line: i + 1, severity: 'error', message: 'Front matter lines must look like "key: value".' });
      continue;
    }
    const key = m[1] ?? '';
    const value = (m[2] ?? '').trim();
    if (!(FRONT_KEYS as readonly string[]).includes(key)) {
      issues.push({ file, line: i + 1, severity: 'error', message: `Unknown front matter key "${key}". Allowed: ${FRONT_KEYS.join(', ')}.` });
      continue;
    }
    if (seen.has(key)) issues.push({ file, line: i + 1, severity: 'error', message: `Duplicate front matter key "${key}".` });
    seen.add(key);
    if (key === 'minutes') {
      const n = /^[0-9]{1,3}$/.test(value) ? Number(value) : NaN;
      if (!(n >= 1 && n <= 120)) issues.push({ file, line: i + 1, severity: 'error', message: 'minutes must be a whole number from 1 to 120.' });
      else front.minutes = n;
    } else if (key === 'id') {
      if (!ID_PATTERN.test(value) || value.length > 48) issues.push({ file, line: i + 1, severity: 'error', message: `Invalid module id "${value}".` });
      front.id = value;
    } else if (key === 'title') {
      if (value.length > 120) issues.push({ file, line: i + 1, severity: 'error', message: 'title is longer than 120 characters.' });
      front.title = value;
    } else {
      if (value.length > 300) issues.push({ file, line: i + 1, severity: 'error', message: 'summary is longer than 300 characters.' });
      front.summary = value;
    }
  }
  if (lines[i] !== '---') issues.push({ file, line: 1, severity: 'error', message: 'Front matter is not closed with ---.' });
  for (const key of FRONT_KEYS) if (!seen.has(key)) issues.push({ file, line: 1, severity: 'error', message: `Front matter is missing "${key}".` });
  return { front, bodyStart: i + 1 };
}

function toBodyBlocks(blocks: readonly Block[], file: string, issues: ContentIssue[], insideRole: boolean): BodyBlock[] {
  const out: BodyBlock[] = [];
  for (const b of blocks) {
    if (b.t === 'container') {
      if (b.name === 'role') {
        if (insideRole) issues.push({ file, line: b.line, severity: 'error', message: 'A role container cannot contain another role container.' });
        if (b.args.length === 0) issues.push({ file, line: b.line, severity: 'error', message: 'A role container needs at least one role id, e.g. "::: role managers".' });
        for (const inner of b.blocks) {
          if (inner.t === 'container' && inner.name === 'role') issues.push({ file, line: inner.line, severity: 'error', message: 'A role container cannot contain another role container.' });
          if (inner.t === 'heading' && inner.level === 2) issues.push({ file, line: inner.line, severity: 'error', message: 'Use ### or #### headings inside a role container.' });
        }
        out.push({ t: 'role', roles: b.args, blocks: b.blocks, line: b.line });
        continue;
      }
      if (!(CALLOUT_KINDS as readonly string[]).includes(b.name)) {
        issues.push({ file, line: b.line, severity: 'error', message: `Unknown container "${b.name}". Allowed: role, ${CALLOUT_KINDS.join(', ')}.` });
      }
      if (b.args.length > 0) issues.push({ file, line: b.line, severity: 'error', message: `Container "${b.name}" takes no arguments.` });
      for (const inner of b.blocks) {
        if (inner.t === 'container') issues.push({ file, line: inner.line, severity: 'error', message: 'Callouts cannot contain containers.' });
        if (inner.t === 'heading') issues.push({ file, line: inner.line, severity: 'error', message: 'Callouts cannot contain headings.' });
      }
    }
    out.push(b);
  }
  return out;
}

function parseQuiz(blocks: readonly Block[], file: string, issues: ContentIssue[]): Question[] {
  const questions: Question[] = [];
  let i = 0;
  while (i < blocks.length) {
    const head = blocks[i];
    if (!head) break;
    const m = head.t === 'heading' && head.level === 3 ? /^Question ([a-z0-9-]+)$/.exec(head.raw) : null;
    if (!m) {
      issues.push({ file, line: head.line, severity: 'error', message: 'Quiz content must be "### Question <id>" blocks.' });
      i += 1;
      continue;
    }
    const id = m[1] ?? '';
    if (!ID_PATTERN.test(id) || id.length > 64) issues.push({ file, line: head.line, severity: 'error', message: `Invalid question id "${id}".` });
    i += 1;
    const body: Block[] = [];
    while (i < blocks.length) {
      const b = blocks[i];
      if (!b || (b.t === 'heading' && b.level <= 3)) break;
      body.push(b);
      i += 1;
    }
    let roles: string[] = [];
    const stem: Block[] = [];
    const explanation: Block[] = [];
    let options: QuizOption[] | undefined;
    let phase: 'stem' | 'explanation' = 'stem';
    for (const b of body) {
      if (phase === 'stem' && b.t === 'paragraph' && /^Roles: /.test(b.raw) && stem.length === 0 && roles.length === 0) {
        roles = b.raw.slice('Roles: '.length).split(/,\s*/).map((r) => r.trim());
        continue;
      }
      if (b.t === 'list' && options === undefined && phase === 'stem') {
        options = [];
        for (const item of b.items) {
          const tm = /^\[( |x)\] (.+)$/.exec(item.raw);
          if (!tm) {
            issues.push({ file, line: item.line, severity: 'error', message: 'Answer options must start with "[ ] " or "[x] ".' });
            continue;
          }
          options.push({ c: parseInline(tm[2] ?? '', item.line), correct: tm[1] === 'x' });
        }
        continue;
      }
      if (b.t === 'paragraph' && b.raw.startsWith('Explanation: ') && phase === 'stem') {
        phase = 'explanation';
        const rest = b.raw.slice('Explanation: '.length);
        explanation.push({ t: 'paragraph', raw: rest, c: parseInline(rest, b.line), line: b.line });
        continue;
      }
      if (phase === 'explanation') {
        if (b.t === 'paragraph' || b.t === 'list') explanation.push(b);
        else issues.push({ file, line: b.line, severity: 'error', message: 'Explanations may contain only paragraphs and lists.' });
        continue;
      }
      if (options !== undefined) {
        issues.push({ file, line: b.line, severity: 'error', message: 'After the answer options, only "Explanation: ..." may follow.' });
        continue;
      }
      if (b.t === 'paragraph') stem.push(b);
      else issues.push({ file, line: b.line, severity: 'error', message: 'The question text may contain only paragraphs.' });
    }
    questions.push({ id, roles, stem, options: options ?? [], explanation, line: head.line });
  }
  return questions;
}

function parseSources(blocks: readonly Block[], file: string, issues: ContentIssue[]): Source[] {
  const sources: Source[] = [];
  for (const b of blocks) {
    if (b.t !== 'list' || b.ordered) {
      issues.push({ file, line: b.line, severity: 'error', message: 'The Sources section must be a single bulleted list of links.' });
      continue;
    }
    for (const item of b.items) {
      const links = item.c.filter((n): n is Extract<Inline, { t: 'link' }> => n.t === 'link');
      const first = links[0];
      if (links.length !== 1 || !first) {
        issues.push({ file, line: item.line, severity: 'error', message: 'Each source must contain exactly one link.' });
        continue;
      }
      sources.push({ c: item.c, href: first.href, line: item.line });
    }
  }
  return sources;
}

/**
 * Parses a module file. Always returns a module object; check `issues` for
 * errors before using it.
 */
export function parseModule(text: string, file: string): { module: CourseModule; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const empty: CourseModule = { id: '', title: '', summary: '', minutes: 0, objectives: [], sections: [], questions: [], sources: [], file };
  if (text.length > MAX_MODULE_BYTES) {
    issues.push({ file, line: 1, severity: 'error', message: `The file is larger than ${MAX_MODULE_BYTES} bytes.` });
    return { module: empty, issues };
  }
  const source = text.replace(/^\uFEFF/, '');
  if (hasUnsafeTextCharacter(source)) {
    const idx = source.split(/\r?\n/).findIndex((l) => hasUnsafeTextCharacter(l.replace(/\r$/, '')));
    issues.push({ file, line: idx + 1, severity: 'error', message: 'The file contains control, invisible or bidirectional characters.' });
    return { module: empty, issues };
  }
  const lines = source.split(/\r?\n/);
  const { front, bodyStart } = parseFrontMatter(lines, file, issues);
  const parsed = parseBlocks(lines.slice(bodyStart).join('\n'), bodyStart + 1);
  for (const p of parsed.issues) issues.push(toIssue(p, file));

  const sections: { heading: Block & { t: 'heading' }; blocks: Block[] }[] = [];
  for (const b of parsed.blocks) {
    if (b.t === 'heading' && b.level === 2) sections.push({ heading: b, blocks: [] });
    else if (sections.length === 0) issues.push({ file, line: b.line, severity: 'error', message: 'Content before the first ## heading.' });
    else sections[sections.length - 1]?.blocks.push(b);
  }

  let objectives: (readonly Inline[])[] = [];
  let questions: Question[] = [];
  let sources: Source[] = [];
  const body: Section[] = [];
  const order: string[] = [];
  for (const s of sections) {
    const name = s.heading.raw;
    if (name === 'Learning objectives') {
      order.push('objectives');
      const list = s.blocks.find((b) => b.t === 'list');
      if (s.blocks.length !== 1 || !list || list.ordered) {
        issues.push({ file, line: s.heading.line, severity: 'error', message: 'Learning objectives must be a single bulleted list.' });
      }
      objectives = list?.t === 'list' ? list.items.map((it) => it.c) : [];
    } else if (name === 'Quiz') {
      order.push('quiz');
      questions = parseQuiz(s.blocks, file, issues);
    } else if (name === 'Sources') {
      order.push('sources');
      sources = parseSources(s.blocks, file, issues);
    } else {
      order.push('body');
      body.push({ heading: s.heading.c, headingText: inlineText(s.heading.c), blocks: toBodyBlocks(s.blocks, file, issues, false), line: s.heading.line });
    }
  }
  for (const required of ['objectives', 'quiz', 'sources']) {
    const count = order.filter((o) => o === required).length;
    const label = required === 'objectives' ? 'Learning objectives' : required === 'quiz' ? 'Quiz' : 'Sources';
    if (count === 0) issues.push({ file, line: 1, severity: 'error', message: `Missing "## ${label}" section.` });
    if (count > 1) issues.push({ file, line: 1, severity: 'error', message: `More than one "## ${label}" section.` });
  }
  const expected = ['objectives', ...order.filter((o) => o === 'body'), 'quiz', 'sources'];
  if (order.length === expected.length && order.some((o, idx) => o !== expected[idx])) {
    issues.push({ file, line: 1, severity: 'error', message: 'Section order must be: Learning objectives, content sections, Quiz, Sources.' });
  }
  if (body.length === 0) issues.push({ file, line: 1, severity: 'error', message: 'The module has no content sections.' });

  return { module: { ...front, objectives, sections: body, questions, sources, file }, issues };
}

function toIssue(p: ParseIssue, file: string): ContentIssue {
  return { file, line: p.line, severity: 'error', message: p.message };
}
