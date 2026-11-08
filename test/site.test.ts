// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The generated course site: escaping, CSP, offline use, accessibility
// structure, role variants and the attribution notice.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadAndLint } from '../src/content/lint.js';
import { BuildError, buildSite, renderModulePage, resolvePlaceholders } from '../src/site/build.js';
import { contentSecurityPolicy, cspHash, escapeHtml, isSafeHref, jsonForScriptElement } from '../src/site/html.js';
import { DEFAULT_PLACEHOLDERS, renderInline } from '../src/site/render.js';
import { THEME } from '../src/site/style.js';
import { MINIMAL_COURSE_JSON, bundledCourse, minimalModule } from './helpers.js';

function cspOf(html: string): string {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  if (!m?.[1]) throw new Error('no CSP');
  return m[1].replace(/&#39;/g, "'");
}

function inline(html: string, tag: 'style' | 'script'): string[] {
  return [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1] ?? '');
}

function courseWith(body: string, quizExtra = '') {
  const text = minimalModule('m-one', { body }).replace('## Sources', `${quizExtra}## Sources`);
  const { course, issues } = loadAndLint(MINIMAL_COURSE_JSON, new Map([['m-one', text]]));
  return { course, issues };
}

describe('escaping', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('escapes hostile text everywhere in a page', async () => {
    const course = await bundledCourse();
    const hostile = `"><script>alert(1)</script><img src=x onerror=alert(1)>`;
    const files = buildSite(course, { roles: ['staff'], organisation: hostile, aiContact: `'</p><iframe src=//evil>` });
    for (const f of files) {
      expect(f.content).not.toContain('<script>alert(1)');
      expect(f.content).not.toContain('<img');
      expect(f.content).not.toContain('<iframe');
    }
    expect(files.find((f) => f.path === 'data-protection.html')?.content).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes text, code and link labels from content', () => {
    const ctx = { placeholders: DEFAULT_PLACEHOLDERS, role: 'staff' };
    const hostile = `<img src=x onerror=alert(1)> & "q" 'a'`;
    const escaped = '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; &#39;a&#39;';
    expect(renderInline([{ t: 'text', v: hostile }], ctx)).toBe(escaped);
    expect(renderInline([{ t: 'code', v: hostile }], ctx)).toBe(`<code>${escaped}</code>`);
    expect(renderInline([{ t: 'strong', c: [{ t: 'em', c: [{ t: 'text', v: '</em><script>' }] }] }], ctx)).toBe('<strong><em>&lt;/em&gt;&lt;script&gt;</em></strong>');
    expect(renderInline([{ t: 'link', href: 'https://eur-lex.europa.eu/', c: [{ t: 'text', v: '</a><b>' }] }], ctx)).toBe('<a href="https://eur-lex.europa.eu/" rel="noreferrer">&lt;/a&gt;&lt;b&gt;</a>');
  });

  it('renders links only for safe targets', () => {
    const ctx = { placeholders: DEFAULT_PLACEHOLDERS, role: 'staff' };
    expect(renderInline([{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'x' }] }], ctx)).toBe('x');
    expect(renderInline([{ t: 'link', href: 'https://eur-lex.europa.eu/a"b', c: [{ t: 'text', v: 'x' }] }], ctx)).toBe('x');
    expect(renderInline([{ t: 'link', href: 'https://eur-lex.europa.eu/x?a=1&b=2', c: [{ t: 'text', v: 'x' }] }], ctx)).toBe('<a href="https://eur-lex.europa.eu/x?a=1&amp;b=2" rel="noreferrer">x</a>');
    for (const bad of ['http://x.eu', 'data:text/html,x', '//evil', 'https://user:pw@x.eu', 'vbscript:x', '../../etc/passwd', 'file:///etc/passwd', '']) expect(isSafeHref(bad), bad).toBe(false);
    for (const good of ['ai-basics.html', '#quiz-h', '../index.html'.replace('index', 'staff/index'), 'staff/index.html', 'https://eur-lex.europa.eu/']) expect(isSafeHref(good), good).toBe(true);
  });

  it('keeps the answer key inside its script element', () => {
    const json = jsonForScriptElement({ a: '</script><script>alert(1)</script>', b: '<!--', c: '\u2028\u2029&' });
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(json)).toEqual({ a: '</script><script>alert(1)</script>', b: '<!--', c: '\u2028\u2029&' });
  });

  it('validates organisation and contact values', () => {
    expect(resolvePlaceholders({})).toEqual(DEFAULT_PLACEHOLDERS);
    expect(resolvePlaceholders({ organisation: '  Example Ltd ' }).organisation).toBe('Example Ltd');
    expect(() => resolvePlaceholders({ organisation: '' })).toThrow(BuildError);
    expect(() => resolvePlaceholders({ organisation: 'x'.repeat(201) })).toThrow(BuildError);
    expect(() => resolvePlaceholders({ aiContact: 'Evil\u202ECorp' })).toThrow(BuildError);
  });
});

describe('content security policy', () => {
  it('allows only the inline style and script by hash', async () => {
    const course = await bundledCourse();
    for (const f of buildSite(course)) {
      const csp = cspOf(f.content);
      expect(csp).toMatch(/^default-src 'none'; /);
      for (const d of ["connect-src 'none'", "img-src 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'", "require-trusted-types-for 'script'"]) expect(csp, f.path).toContain(d);
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
      const styles = inline(f.content, 'style');
      expect(styles).toHaveLength(1);
      expect(csp).toContain(`style-src ${cspHash(styles[0] ?? '')}`);
      const scripts = inline(f.content, 'script');
      if (scripts.length === 0) expect(csp).toContain("script-src 'none'");
      else {
        expect(scripts).toHaveLength(1);
        const digest = createHash('sha256').update(scripts[0] ?? '').digest('base64');
        expect(csp).toContain(`script-src 'sha256-${digest}'`);
      }
    }
  });

  it('builds the policy string', () => {
    expect(contentSecurityPolicy('a', undefined)).toContain("script-src 'none'");
    expect(contentSecurityPolicy('a', 'b')).toContain(`script-src ${cspHash('b')}`);
  });
});

describe('offline pages', () => {
  it('load nothing from the network and use only relative links between pages', async () => {
    const course = await bundledCourse();
    for (const f of buildSite(course)) {
      expect(f.content, f.path).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img|<iframe|@import|url\(/);
      for (const m of f.content.matchAll(/href="([^"]+)"/g)) {
        const href = (m[1] ?? '').replace(/&amp;/g, '&');
        expect(isSafeHref(href) || href === 'https://creativecommons.org/licenses/by/4.0/', href).toBe(true);
      }
    }
  });

  it('carries the attribution notice in the footer of every page', async () => {
    const course = await bundledCourse();
    for (const f of [...buildSite(course), ...course.moduleList.map((m) => ({ path: m.id, content: renderModulePage(course, m, 'staff', 'scorm', DEFAULT_PLACEHOLDERS) }))]) {
      expect(f.content, f.path).toMatch(/<footer class="site">[\s\S]*<a href="https:\/\/afkzonagroup\.lt">Groundwork by AFKzona Group<\/a>[\s\S]*<\/footer>/);
      expect(f.content).toContain('not legal advice');
    }
  });

  it('lays out one folder per role with a chooser, or a flat site for one role', async () => {
    const course = await bundledCourse();
    const all = buildSite(course).map((f) => f.path);
    expect(all).toContain('index.html');
    expect(all).toContain('managers/escalation.html');
    expect(all).toHaveLength(1 + 3 * 8);
    expect(buildSite(course, { roles: ['staff'] }).map((f) => f.path)).toEqual(['index.html', ...course.moduleList.map((m) => `${m.id}.html`)]);
    expect(() => buildSite(course, { roles: ['nobody'] })).toThrow(BuildError);
    expect(() => buildSite(course, { roles: [] })).toThrow(BuildError);
  });
});

describe('accessibility structure', () => {
  it('has language, title, skip link, landmarks and one h1 per page', async () => {
    const course = await bundledCourse();
    for (const f of buildSite(course)) {
      expect(f.content).toMatch(/<html lang="en">/);
      expect(f.content).toMatch(/<title>[^<]+<\/title>/);
      expect(f.content).toContain('<a class="skip" href="#main">');
      expect(f.content).toMatch(/<main id="main"/);
      expect(f.content).toMatch(/<header class="site">/);
      expect(f.content.match(/<h1>/g)).toHaveLength(1);
      expect(f.content).toContain('name="viewport"');
    }
  });

  it('labels every answer option and groups each question in a fieldset with a legend', async () => {
    const course = await bundledCourse();
    const page = buildSite(course, { roles: ['staff'] }).find((f) => f.path === 'ai-basics.html')?.content ?? '';
    const radios = [...page.matchAll(/<input type="radio" name="q-([a-z0-9-]+)" id="([a-z0-9-]+)"/g)];
    expect(radios.length).toBeGreaterThan(10);
    for (const r of radios) expect(page).toContain(`<label for="${r[2] ?? ''}">`);
    const fieldsets = page.match(/<fieldset class="q"/g) ?? [];
    expect(page.match(/<legend>/g)).toHaveLength(fieldsets.length);
    expect(page).toContain('role="status"');
  });

  it('uses colour pairs that meet WCAG 2.1 AA contrast', () => {
    const lum = (hex: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    };
    const ratio = (a: string, b: string): number => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
    };
    for (const t of [THEME.light, THEME.dark]) {
      for (const [fg, bg] of [
        [t.text, t.bg],
        [t.text, t.surface],
        [t.muted, t.bg],
        [t.muted, t.surface],
        [t.accent, t.bg],
        [t.accent, t.surface],
        [t.accentText, t.accent],
        [t.okText, t.okBg],
        [t.badText, t.badBg],
        [t.text, t.okBg],
        [t.text, t.badBg],
      ] as const) {
        expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(t.border, t.bg), 'non-text contrast of borders').toBeGreaterThanOrEqual(1.5);
      expect(ratio(t.focus, t.bg), 'focus indicator').toBeGreaterThanOrEqual(3);
    }
  });
});

describe('role variants and quiz', () => {
  it('shows role blocks and role questions only in their variant', () => {
    const quiz = `### Question m-one-5\nRoles: managers\n\nManagers only?\n\n- [x] Yes\n- [ ] No\n- [ ] Maybe\n\nExplanation: Only managers.\n\n`;
    const { course } = courseWith('Shared text.\n\n::: role managers\n### For managers\n\nSecret manager text.\n:::', quiz);
    if (!course) throw new Error('course');
    const m = course.moduleList[0];
    if (!m) throw new Error('module');
    const staff = renderModulePage(course, m, 'staff', 'site', DEFAULT_PLACEHOLDERS);
    const managers = renderModulePage(course, m, 'managers', 'site', DEFAULT_PLACEHOLDERS);
    expect(staff).toContain('Shared text.');
    expect(staff).not.toContain('Secret manager text.');
    expect(staff).not.toContain('Managers only?');
    expect(managers).toContain('Secret manager text.');
    expect(managers).toContain('Managers only?');
    expect(managers).toContain('Question 5 of 5');
  });

  it('embeds an answer key that matches the options', async () => {
    const course = await bundledCourse();
    const m = course.moduleList[1];
    if (!m) throw new Error('module');
    const html = renderModulePage(course, m, 'builders', 'site', DEFAULT_PLACEHOLDERS);
    const key = JSON.parse(/<script type="application\/json" id="gw-key">([^<]+)<\/script>/.exec(html)?.[1] ?? '{}') as { passMark: number; answers: { id: string; correct: number }[] };
    expect(key.passMark).toBe(80);
    const expected = m.questions.filter((q) => q.roles.length === 0 || q.roles.includes('builders'));
    expect(key.answers.map((a) => a.id)).toEqual(expected.map((q) => q.id));
    for (const a of key.answers) expect(expected.find((q) => q.id === a.id)?.options[a.correct]?.correct).toBe(true);
    expect(html).toMatch(/<div class="feedback" id="fb-[a-z0-9-]+" hidden>/);
  });

  it('marks SCORM pages and drops links to other pages', async () => {
    const course = await bundledCourse();
    const m = course.moduleList[0];
    if (!m) throw new Error('module');
    const html = renderModulePage(course, m, 'staff', 'scorm', DEFAULT_PLACEHOLDERS);
    expect(html).toContain('<body data-scorm="1">');
    expect(html).toContain('id="gw-scorm-status"');
    expect(html).not.toMatch(/href="[a-z0-9-]+\.html"/);
  });

  it('fills in placeholders', async () => {
    const course = await bundledCourse();
    const files = buildSite(course, { roles: ['staff'], organisation: 'Example Ltd', aiContact: 'the AI desk' });
    const escalation = files.find((f) => f.path === 'escalation.html')?.content ?? '';
    expect(escalation).toContain('Tell the AI desk.');
    expect(escalation).toContain('Know who to tell in Example Ltd.');
    expect(escalation).not.toContain('{ai-contact}');
  });
});
