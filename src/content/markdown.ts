// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A deliberately small Markdown dialect for course modules.
 *
 * Supported blocks: `##`, `###` and `####` headings, paragraphs, flat
 * unordered (`- `) and ordered (`1. `) lists, and containers opened with
 * `::: name args` and closed with `:::` (one level of nesting).
 * Supported inline syntax: `**strong**`, `*emphasis*`, `` `code` ``,
 * `[text](url)`, backslash escapes and the placeholders listed in
 * {@link PLACEHOLDERS}.
 *
 * There is no raw HTML: every character of the input ends up as text and is
 * escaped when rendered. The parser never throws on content; it reports
 * issues with line numbers.
 *
 * @packageDocumentation
 */

/** Placeholders an organisation can fill in when building the course. */
export const PLACEHOLDERS = ['organisation', 'ai-contact'] as const;

/** Name of a placeholder. */
export type PlaceholderName = (typeof PLACEHOLDERS)[number];

/** Inline content. */
export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'strong'; readonly c: readonly Inline[] }
  | { readonly t: 'em'; readonly c: readonly Inline[] }
  | { readonly t: 'link'; readonly href: string; readonly c: readonly Inline[] }
  | { readonly t: 'placeholder'; readonly name: PlaceholderName };

/** A list item: its raw text (for task-list parsing) and parsed inline content. */
export interface ListItem {
  readonly raw: string;
  readonly c: readonly Inline[];
  readonly line: number;
}

/** Block content. */
export type Block =
  | { readonly t: 'heading'; readonly level: 2 | 3 | 4; readonly raw: string; readonly c: readonly Inline[]; readonly line: number }
  | { readonly t: 'paragraph'; readonly raw: string; readonly c: readonly Inline[]; readonly line: number }
  | { readonly t: 'list'; readonly ordered: boolean; readonly items: readonly ListItem[]; readonly line: number }
  | { readonly t: 'container'; readonly name: string; readonly args: readonly string[]; readonly blocks: readonly Block[]; readonly line: number };

/** A problem found while parsing. */
export interface ParseIssue {
  readonly line: number;
  readonly message: string;
}

/** Limits that keep parsing cheap on hostile input. */
export const MARKDOWN_LIMITS = {
  maxLines: 5000,
  maxLineLength: 2000,
  maxInlineDepth: 6,
  /** Longest paragraph, list item or heading; keeps inline parsing fast (it is quadratic in the worst case). */
  maxInlineLength: 4000,
  maxContainerDepth: 2,
} as const;

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!:|>'.split(''));
const PLACEHOLDER_SET: ReadonlySet<string> = new Set(PLACEHOLDERS);

function isPlaceholder(name: string): name is PlaceholderName {
  return PLACEHOLDER_SET.has(name);
}

/**
 * Parses inline Markdown. Unmatched delimiters are kept as literal text.
 * `issues` receives problems such as a link with an empty target.
 */
export function parseInline(source: string, line = 0, issues: ParseIssue[] = [], depth = 0): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = (): void => {
    if (text.length > 0) {
      const last = out[out.length - 1];
      if (last?.t === 'text') out[out.length - 1] = { t: 'text', v: last.v + text };
      else out.push({ t: 'text', v: text });
      text = '';
    }
  };
  if (depth === 0 && source.length > MARKDOWN_LIMITS.maxInlineLength) {
    issues.push({ line, message: `Paragraph, list item or heading longer than ${String(MARKDOWN_LIMITS.maxInlineLength)} characters; split it.` });
    return [{ t: 'text', v: source }];
  }
  if (depth > MARKDOWN_LIMITS.maxInlineDepth) {
    issues.push({ line, message: 'Inline formatting is nested too deeply.' });
    return [{ t: 'text', v: source }];
  }
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (ch === '\\' && ESCAPABLE.has(next)) {
      text += next;
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && next === '*') {
      const end = findClosing(source, '**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(source.slice(i + 2, end), line, issues, depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' && next !== '*' && next !== ' ') {
      const end = findClosing(source, '*', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'em', c: parseInline(source.slice(i + 1, end), line, issues, depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const link = parseLink(source, i);
      if (link) {
        flush();
        if (link.href.length === 0) issues.push({ line, message: 'Link without a target.' });
        if (/\[[^[\]]*\]\(/.test(link.label)) issues.push({ line, message: 'Links cannot contain links.' });
        out.push({ t: 'link', href: link.href, c: parseInline(link.label, line, issues, depth + 1) });
        i = link.end;
        continue;
      }
    }
    if (ch === '{') {
      const m = /^\{([a-z][a-z-]{0,30})\}/.exec(source.slice(i, i + 34));
      if (m) {
        const name = m[1] ?? '';
        if (isPlaceholder(name)) {
          flush();
          out.push({ t: 'placeholder', name });
          i += m[0].length;
          continue;
        }
        issues.push({ line, message: `Unknown placeholder {${name}}. Known: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.` });
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Index of the closing delimiter, skipping backslash escapes and code spans; -1 if none. */
function findClosing(source: string, delimiter: string, from: number): number {
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i) {
        i = end + 1;
        continue;
      }
    }
    if (source.startsWith(delimiter, i)) {
      if (delimiter === '*' && source[i + 1] === '*') {
        // Skip a strong delimiter inside emphasis.
        const strongEnd = findClosing(source, '**', i + 2);
        if (strongEnd < 0) return -1;
        i = strongEnd + 2;
        continue;
      }
      if (source[i - 1] !== ' ') return i;
    }
    i += 1;
  }
  return -1;
}

function parseLink(source: string, start: number): { label: string; href: string; end: number } | undefined {
  let depth = 0;
  let i = start;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (i >= source.length || source[i + 1] !== '(') return undefined;
  const close = source.indexOf(')', i + 2);
  if (close < 0) return undefined;
  const href = source.slice(i + 2, close);
  if (/\s/.test(href)) return undefined;
  return { label: source.slice(start + 1, i), href, end: close + 1 };
}

/** `#` to `######`, whitespace, then text; checked without backtracking-heavy patterns. */
const HEADING_START = /^(#{1,6})\s+(\S.*)$/;

/**
 * Matches an ATX heading line. A closing run of `#` is removed when it is
 * preceded by whitespace (as in CommonMark), so "## C#" keeps its text.
 * Linear in the line length (the previous single regular expression
 * backtracked cubically on long lines).
 */
function matchHeading(text: string): { level: number; content: string } | undefined {
  const m = HEADING_START.exec(text);
  if (!m) return undefined;
  let content = (m[2] ?? '').trimEnd();
  let end = content.length;
  while (end > 0 && content[end - 1] === '#') end -= 1;
  if (end > 0 && end < content.length && /\s/.test(content[end - 1] ?? '')) content = content.slice(0, end).trimEnd();
  return { level: (m[1] ?? '').length, content };
}
const BULLET = /^- (.*)$/;
const ORDERED = /^([0-9]{1,3})\. (.*)$/;
const CONTAINER_OPEN = /^:::\s*([a-z][a-z-]*)((?:\s+[a-z0-9][a-z0-9-]*)*)\s*$/;
const CONTAINER_CLOSE = /^:::\s*$/;

interface Line {
  readonly n: number;
  readonly text: string;
}

/**
 * Parses a Markdown document body into blocks.
 *
 * @param source - The Markdown text (line endings LF or CRLF).
 * @param firstLine - Line number of the first line, for messages.
 */
export function parseBlocks(source: string, firstLine = 1): { blocks: Block[]; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const raw = source.split(/\r?\n/);
  if (raw.length > MARKDOWN_LIMITS.maxLines) {
    return { blocks: [], issues: [{ line: firstLine, message: `Too many lines (limit ${MARKDOWN_LIMITS.maxLines}).` }] };
  }
  // trimEnd() is linear; a /\s+$/ replacement is quadratic on long runs of spaces.
  const lines: Line[] = raw.map((full, idx) => {
    const n = firstLine + idx;
    let text = full.trimEnd();
    if (text.length > MARKDOWN_LIMITS.maxLineLength) {
      issues.push({ line: n, message: `Line longer than ${MARKDOWN_LIMITS.maxLineLength} characters.` });
      // Parse only the allowed length, so no later step works on an overlong line.
      text = text.slice(0, MARKDOWN_LIMITS.maxLineLength);
    }
    if (text.includes('\t')) issues.push({ line: n, message: 'Tab character; use spaces.' });
    return { n, text };
  });
  const state = { pos: 0 };
  const { blocks } = parseUntil(lines, state, issues, 0);
  return { blocks, issues };
}

function parseUntil(lines: readonly Line[], state: { pos: number }, issues: ParseIssue[], depth: number): { blocks: Block[]; closed: boolean } {
  const blocks: Block[] = [];
  while (state.pos < lines.length) {
    const line = lines[state.pos];
    if (!line) break;
    const text = line.text;
    if (text.trim() === '') {
      state.pos += 1;
      continue;
    }
    if (CONTAINER_CLOSE.test(text)) {
      if (depth === 0) {
        issues.push({ line: line.n, message: 'Closing ::: without an open container.' });
        state.pos += 1;
        continue;
      }
      state.pos += 1;
      return { blocks, closed: true };
    }
    const open = CONTAINER_OPEN.exec(text);
    if (open) {
      state.pos += 1;
      if (depth + 1 > MARKDOWN_LIMITS.maxContainerDepth) {
        issues.push({ line: line.n, message: 'Containers are nested too deeply.' });
      }
      const { blocks: inner, closed } = parseUntil(lines, state, issues, depth + 1);
      if (!closed) issues.push({ line: line.n, message: `Container ::: ${open[1] ?? ''} is not closed.` });
      const args = (open[2] ?? '').trim();
      blocks.push({ t: 'container', name: open[1] ?? '', args: args === '' ? [] : args.split(/\s+/), blocks: inner, line: line.n });
      continue;
    }
    if (text.startsWith(':::')) {
      issues.push({ line: line.n, message: 'Malformed container line. Use "::: name" and ":::".' });
      state.pos += 1;
      continue;
    }
    const heading = matchHeading(text);
    if (heading) {
      const { level, content } = heading;
      if (level < 2 || level > 4) issues.push({ line: line.n, message: `Heading level ${level} is not allowed; use ## to ####.` });
      const clamped = (level < 2 ? 2 : level > 4 ? 4 : level) as 2 | 3 | 4;
      blocks.push({ t: 'heading', level: clamped, raw: content, c: parseInline(content, line.n, issues), line: line.n });
      state.pos += 1;
      continue;
    }
    if (BULLET.test(text) || ORDERED.test(text)) {
      blocks.push(parseList(lines, state, issues));
      continue;
    }
    if (/^\s/.test(text)) issues.push({ line: line.n, message: 'Unexpected indentation.' });
    // Paragraph: consecutive lines until a blank line or another block starts.
    const start = line.n;
    const parts: string[] = [];
    while (state.pos < lines.length) {
      const l = lines[state.pos];
      if (!l || l.text.trim() === '' || matchHeading(l.text) !== undefined || BULLET.test(l.text) || ORDERED.test(l.text) || l.text.startsWith(':::')) break;
      parts.push(l.text.trim());
      state.pos += 1;
    }
    const joined = parts.join(' ');
    blocks.push({ t: 'paragraph', raw: joined, c: parseInline(joined, start, issues), line: start });
  }
  // Reaching the end inside a container means it was not closed; the caller reports it.
  return { blocks, closed: depth === 0 };
}

function parseList(lines: readonly Line[], state: { pos: number }, issues: ParseIssue[]): Block {
  const first = lines[state.pos];
  const ordered = ORDERED.test(first?.text ?? '');
  const items: ListItem[] = [];
  while (state.pos < lines.length) {
    const l = lines[state.pos];
    if (!l) break;
    const m = ordered ? ORDERED.exec(l.text) : BULLET.exec(l.text);
    if (!m) break;
    const parts = [(ordered ? m[2] : m[1]) ?? ''];
    const lineNo = l.n;
    state.pos += 1;
    // Continuation lines are indented by at least two spaces.
    while (state.pos < lines.length) {
      const c = lines[state.pos];
      if (!c || !/^ {2,}\S/.test(c.text)) break;
      if (/^ {2,}(- |[0-9]{1,3}\. )/.test(c.text)) issues.push({ line: c.n, message: 'Nested lists are not supported.' });
      parts.push(c.text.trim());
      state.pos += 1;
    }
    const raw = parts.join(' ');
    items.push({ raw, c: parseInline(raw, lineNo, issues), line: lineNo });
  }
  return { t: 'list', ordered, items, line: first?.n ?? 0 };
}

/** Plain text of inline content, with placeholders shown as `{name}`. */
export function inlineText(nodes: readonly Inline[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text' || n.t === 'code') out += n.v;
    else if (n.t === 'placeholder') out += `{${n.name}}`;
    else out += inlineText(n.c);
  }
  return out;
}

/** Every link target in inline content. */
export function inlineLinks(nodes: readonly Inline[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.t === 'link') out.push(n.href, ...inlineLinks(n.c));
    else if (n.t === 'strong' || n.t === 'em') out.push(...inlineLinks(n.c));
  }
  return out;
}
