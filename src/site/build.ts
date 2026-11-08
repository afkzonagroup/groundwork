// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the offline course site: self-contained HTML pages with an inline
 * stylesheet and script, each allowed by hash in a strict Content Security
 * Policy. The pages work from file:// and load nothing from the network.
 *
 * @packageDocumentation
 */

import type { Course } from '../content/course.js';
import { questionsForRole } from '../content/course.js';
import type { CourseModule, Question } from '../content/module.js';
import { hasUnsafeCharacter } from '../util/text.js';
import { ATTRIBUTION, PROJECT_URL } from '../version.js';
import { CLIENT_SCRIPT } from './client-script.generated.js';
import { contentSecurityPolicy, escapeHtml, jsonForScriptElement } from './html.js';
import { DEFAULT_PLACEHOLDERS, type PlaceholderValues, type RenderContext, renderBlocks, renderInline } from './render.js';
import { STYLESHEET } from './style.js';

/** A generated file: a relative path with `/` separators, and its content. */
export interface OutputFile {
  readonly path: string;
  readonly content: string;
}

/** Options for building the course. */
export interface SiteOptions {
  /** Role variants to build (default: all roles in the course). */
  readonly roles?: readonly string[];
  /** Organisation name used for `{organisation}`. */
  readonly organisation?: string;
  /** Who to contact about AI concerns, used for `{ai-contact}`. */
  readonly aiContact?: string;
}

/** How a module page is used. */
export type PageMode = 'site' | 'scorm';

/** Error for invalid build options; the message is safe to show. */
export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

/** Maximum length of the organisation name and contact text. */
export const MAX_PLACEHOLDER_LENGTH = 200;

/** Validates option values and fills in default placeholder texts. */
export function resolvePlaceholders(options: Pick<SiteOptions, 'organisation' | 'aiContact'>): PlaceholderValues {
  const check = (value: string | undefined, name: string): string | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PLACEHOLDER_LENGTH || hasUnsafeCharacter(trimmed)) {
      throw new BuildError(`${name} must be 1 to ${MAX_PLACEHOLDER_LENGTH} characters without control or invisible characters.`);
    }
    return trimmed;
  };
  return {
    organisation: check(options.organisation, 'The organisation name') ?? DEFAULT_PLACEHOLDERS.organisation,
    'ai-contact': check(options.aiContact, 'The AI contact') ?? DEFAULT_PLACEHOLDERS['ai-contact'],
  };
}

function resolveRoles(course: Course, roles: readonly string[] | undefined): string[] {
  const all = course.roles.map((r) => r.id);
  if (roles === undefined) return all;
  if (roles.length === 0) throw new BuildError('Choose at least one role.');
  for (const r of roles) if (!all.includes(r)) throw new BuildError(`Unknown role ${JSON.stringify(r)}. Roles: ${all.join(', ')}.`);
  return [...new Set(roles)];
}

function footer(course: Course): string {
  return `<footer class="site"><div class="wrap">
<p class="attribution"><a href="${escapeHtml(ATTRIBUTION.url)}">${escapeHtml(ATTRIBUTION.text)}</a></p>
<p>Course content: ${escapeHtml(course.title)}, version ${escapeHtml(course.version)}, licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Software: <a href="${escapeHtml(PROJECT_URL)}">Groundwork</a>, AGPL-3.0-only.</p>
<p>General information, not legal advice. Completing this course is not a certificate; the AI Act does not require one.</p>
</div></footer>`;
}

interface PageInput {
  readonly course: Course;
  readonly title: string;
  readonly header: string;
  readonly main: string;
  readonly script: boolean;
  readonly scorm: boolean;
}

function page(input: PageInput): string {
  const script = input.script ? CLIENT_SCRIPT : undefined;
  const csp = contentSecurityPolicy(STYLESHEET, script);
  return `<!doctype html>
<html lang="${escapeHtml(input.course.language)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(ATTRIBUTION.text)}">
<title>${escapeHtml(input.title)}</title>
<style>${STYLESHEET}</style>
</head>
<body${input.scorm ? ' data-scorm="1"' : ''}>
<a class="skip" href="#main">Skip to main content</a>
${input.header}
<main id="main" tabindex="-1"><div class="wrap">
${input.main}
</div></main>
${footer(input.course)}
${script === undefined ? '' : `<script>${script}</script>\n`}</body>
</html>
`;
}

function header(course: Course, roleTitle: string | undefined, homeHref: string | undefined): string {
  const name = escapeHtml(course.title);
  const home = homeHref === undefined ? `<span class="course">${name}</span>` : `<a class="course" href="${escapeHtml(homeHref)}">${name}</a>`;
  const variant = roleTitle === undefined ? '' : `<span class="variant">${escapeHtml(roleTitle)}</span>`;
  return `<header class="site"><div class="wrap">${home}${variant}</div></header>`;
}

function roleTitle(course: Course, role: string): string {
  return course.roles.find((r) => r.id === role)?.title ?? role;
}

function renderQuestion(q: Question, number: number, total: number, ctx: RenderContext): string {
  const [first, ...rest] = q.stem;
  const legend = first?.t === 'paragraph' ? renderInline(first.c, ctx) : '';
  const id = escapeHtml(q.id);
  const options = q.options
    .map((o, i) => {
      const optionId = `q-${id}-${String(i)}`;
      return `<div class="opt"><input type="radio" name="q-${id}" id="${optionId}" value="${String(i)}"><label for="${optionId}">${renderInline(o.c, ctx)}</label></div>`;
    })
    .join('\n');
  return `<fieldset class="q" id="q-${id}">
<legend><span class="q-num">Question ${String(number)} of ${String(total)}</span>${legend}</legend>
${renderBlocks(rest, ctx)}${options}
<div class="feedback" id="fb-${id}" hidden><p class="verdict" id="verdict-${id}"></p>
${renderBlocks(q.explanation, ctx)}</div>
</fieldset>`;
}

/** Renders the HTML of one module page for one role. */
export function renderModulePage(course: Course, module: CourseModule, role: string, mode: PageMode, placeholders: PlaceholderValues): string {
  const ctx: RenderContext = { placeholders, role };
  const index = course.moduleList.indexOf(module);
  const questions = questionsForRole(module, role);
  const key = { passMark: course.passMark, answers: questions.map((q) => ({ id: q.id, correct: q.options.findIndex((o) => o.correct) })) };
  const parts: string[] = [];
  parts.push(`<p class="meta">Module ${String(index + 1)} of ${String(course.moduleList.length)} &middot; about ${String(module.minutes)} minutes</p>`);
  parts.push(`<h1>${escapeHtml(module.title)}</h1>`);
  parts.push(`<p class="summary">${escapeHtml(module.summary)}</p>`);
  parts.push(`<section aria-labelledby="objectives-h"><h2 id="objectives-h">What you will learn</h2>\n<ul>\n${module.objectives.map((o) => `<li>${renderInline(o, ctx)}</li>`).join('\n')}\n</ul></section>`);
  for (const s of module.sections) {
    parts.push(`<section>\n<h2>${renderInline(s.heading, ctx)}</h2>\n${renderBlocks(s.blocks, ctx)}</section>`);
  }
  parts.push(`<section aria-labelledby="quiz-h">
<h2 id="quiz-h">Check your understanding</h2>
<p>Answer every question, then select <strong>Check answers</strong>. You need ${String(course.passMark)} % to pass. You can try again as often as you like.</p>
<noscript><p>Turn on JavaScript in your browser to check your answers.</p></noscript>
<form id="gw-quiz" novalidate>
${questions.map((q, i) => renderQuestion(q, i + 1, questions.length, ctx)).join('\n')}
<div class="actions"><button type="submit" class="primary" id="gw-check">Check answers</button><button type="button" class="secondary" id="gw-retry" hidden>Try again</button></div>
<p id="gw-result" role="status" tabindex="-1"></p>
${mode === 'scorm' ? '<p id="gw-scorm-status" class="status" role="status"></p>' : ''}
</form>
<script type="application/json" id="gw-key">${jsonForScriptElement(key)}</script>
</section>`);
  parts.push(`<section aria-labelledby="sources-h"><h2 id="sources-h">Sources</h2>\n<ul class="sources">\n${module.sources.map((s) => `<li>${renderInline(s.c, ctx)}</li>`).join('\n')}\n</ul></section>`);
  if (mode === 'site') {
    const prev = course.moduleList[index - 1];
    const next = course.moduleList[index + 1];
    const prevLink = prev ? `<a href="${escapeHtml(prev.id)}.html" rel="prev">Previous: ${escapeHtml(prev.title)}</a>` : '<span></span>';
    const nextLink = next ? `<a href="${escapeHtml(next.id)}.html" rel="next">Next: ${escapeHtml(next.title)}</a>` : '<a href="index.html">Back to the course overview</a>';
    parts.push(`<nav class="pager" aria-label="Modules">${prevLink}${nextLink}</nav>`);
  } else {
    parts.push('<p class="status">When you have finished, return to your learning platform to continue.</p>');
  }
  const title = `${module.title} - ${course.title}`;
  return page({
    course,
    title,
    header: header(course, roleTitle(course, role), mode === 'site' ? 'index.html' : undefined),
    main: parts.join('\n'),
    script: questions.length > 0,
    scorm: mode === 'scorm',
  });
}

function renderRoleIndex(course: Course, role: string, placeholders: PlaceholderValues, multipleRoles: boolean): string {
  const r = course.roles.find((x) => x.id === role);
  const ctx: RenderContext = { placeholders, role };
  const minutes = course.moduleList.reduce((sum, m) => sum + m.minutes, 0);
  const items = course.moduleList
    .map((m, i) => `<li><a href="${escapeHtml(m.id)}.html">${String(i + 1)}. ${escapeHtml(m.title)}</a><p>${escapeHtml(m.summary)} About ${String(m.minutes)} minutes.</p></li>`)
    .join('\n');
  const main = `<h1>${escapeHtml(course.title)}</h1>
<p class="summary">${escapeHtml(course.description)}</p>
<p>This version is for: <strong>${escapeHtml(r?.title ?? role)}</strong>. ${escapeHtml(r?.description ?? '')}${multipleRoles ? ' <a href="../index.html">Choose another version</a>.' : ''}</p>
<p>The course has ${String(course.moduleList.length)} modules and takes about ${String(minutes)} minutes. Each module ends with a short quiz; you need ${String(course.passMark)} % to pass it.</p>
<h2>Modules</h2>
<ul class="modules">
${items}
</ul>
<h2>About this course</h2>
<p>This course is one way for ${renderInline([{ t: 'placeholder', name: 'organisation' }], ctx)} to support AI literacy, as Article 4 of the EU AI Act asks providers and deployers of AI systems to do. The AI Act does not require a certificate or a specific course. It gives general information and is not legal advice.</p>
<p>Questions about AI at work? Contact ${renderInline([{ t: 'placeholder', name: 'ai-contact' }], ctx)}.</p>`;
  return page({ course, title: `${course.title} - ${r?.title ?? role}`, header: header(course, r?.title, multipleRoles ? '../index.html' : undefined), main, script: false, scorm: false });
}

function renderRootIndex(course: Course, roles: readonly string[]): string {
  const items = roles
    .map((id) => {
      const r = course.roles.find((x) => x.id === id);
      return `<li><a href="${escapeHtml(id)}/index.html">${escapeHtml(r?.title ?? id)}</a><p>${escapeHtml(r?.description ?? '')}</p></li>`;
    })
    .join('\n');
  const main = `<h1>${escapeHtml(course.title)}</h1>
<p class="summary">${escapeHtml(course.description)}</p>
<h2>Choose your version</h2>
<ul class="modules">
${items}
</ul>`;
  return page({ course, title: course.title, header: header(course, undefined, undefined), main, script: false, scorm: false });
}

/**
 * Builds the course site. With several roles, each role gets a folder and a
 * root `index.html` lets learners choose; with one role, the pages are at
 * the top level.
 *
 * @example
 * ```ts
 * const files = buildSite(course, { roles: ['staff'], organisation: 'Example Ltd' });
 * // files: index.html, ai-literacy-at-work.html, ...
 * ```
 */
export function buildSite(course: Course, options: SiteOptions = {}): OutputFile[] {
  const roles = resolveRoles(course, options.roles);
  const placeholders = resolvePlaceholders(options);
  const multiple = roles.length > 1;
  const files: OutputFile[] = [];
  if (multiple) files.push({ path: 'index.html', content: renderRootIndex(course, roles) });
  for (const role of roles) {
    const prefix = multiple ? `${role}/` : '';
    files.push({ path: `${prefix}index.html`, content: renderRoleIndex(course, role, placeholders, multiple) });
    for (const m of course.moduleList) files.push({ path: `${prefix}${m.id}.html`, content: renderModulePage(course, m, role, 'site', placeholders) });
  }
  return files;
}

