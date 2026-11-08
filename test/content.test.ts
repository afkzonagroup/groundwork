// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Content lint: the bundled course passes every rule, and each rule catches
// what it should.

import { describe, expect, it } from 'vitest';
import { questionsForRole } from '../src/content/course.js';
import { loadAndLint, lintCourse } from '../src/content/lint.js';
import { inlineLinks } from '../src/content/markdown.js';
import { checkCitation } from '../src/legal/sources.js';
import { MINIMAL_COURSE_JSON, bundledCourse, bundledTexts, minimalModule } from './helpers.js';

function lint(moduleText: string, courseJson = MINIMAL_COURSE_JSON): string[] {
  const { issues } = loadAndLint(courseJson, new Map([['m-one', moduleText]]));
  return issues.filter((i) => i.severity === 'error').map((i) => i.message);
}

describe('bundled course', () => {
  it('loads without errors or warnings', () => {
    const { courseJson, modules } = bundledTexts();
    const { course, issues } = loadAndLint(courseJson, modules);
    expect(issues).toEqual([]);
    expect(course?.moduleList.map((m) => m.id)).toEqual([
      'ai-literacy-at-work',
      'ai-basics',
      'data-protection',
      'checking-outputs',
      'transparency',
      'prohibited-practices',
      'escalation',
    ]);
  });

  it('gives every module objectives, a quiz for every role and EUR-Lex sources', async () => {
    const course = await bundledCourse();
    for (const m of course.moduleList) {
      expect(m.objectives.length, m.id).toBeGreaterThanOrEqual(3);
      for (const role of course.roles) expect(questionsForRole(m, role.id).length, `${m.id} ${role.id}`).toBeGreaterThanOrEqual(4);
      for (const q of m.questions) {
        expect(q.options.filter((o) => o.correct)).toHaveLength(1);
        expect(q.explanation.length).toBeGreaterThan(0);
      }
      const eurLex = m.sources.filter((s) => s.href.startsWith('https://eur-lex.europa.eu/'));
      expect(eurLex.length, m.id).toBeGreaterThan(0);
      for (const s of m.sources) expect(checkCitation(s.href).ok, s.href).toBe(true);
      expect(lintCourse(course)).toEqual([]);
    }
  });

  it('has role-specific content for builders and managers in every module', async () => {
    const course = await bundledCourse();
    for (const m of course.moduleList) {
      const roles = new Set(m.sections.flatMap((s) => s.blocks.flatMap((b) => (b.t === 'role' ? b.roles : []))));
      expect([...roles].sort(), m.id).toEqual(['builders', 'managers']);
    }
  });

  it('cites the current Article 4 text and the amending regulation', async () => {
    const course = await bundledCourse();
    const first = course.moduleList[0];
    const links = first?.sources.map((s) => s.href) ?? [];
    expect(links).toContain('https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_4');
    expect(links).toContain('https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32026R1744#art_1');
    expect(links).toContain('https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#rct_20');
  });

  it('never claims that a certificate is required', () => {
    const { modules } = bundledTexts();
    for (const [id, text] of modules) {
      expect(/certificate is required|must (obtain|get|hold) a certificate|certified compliant|makes you compliant/i.test(text), id).toBe(false);
    }
  });
});

describe('content rules', () => {
  it('accepts the minimal module', () => {
    expect(lint(minimalModule('m-one'))).toEqual([]);
  });

  it('requires learning objectives', () => {
    const text = minimalModule('m-one').replace('- One.\n- Two.\n- Three.\n', '- One.\n');
    expect(lint(text).join(' ')).toMatch(/3 to 8 learning objectives/);
    expect(lint(minimalModule('m-one').replace('## Learning objectives\n\n- One.\n- Two.\n- Three.\n\n', '')).join(' ')).toMatch(/Missing "## Learning objectives"/);
  });

  it('requires a quiz with enough questions for every role', () => {
    const q = (n: number): string => `### Question m-one-${String(n)}\nQ?\n\n- [x] A\n- [ ] B\n- [ ] C\n\nExplanation: E.\n`;
    expect(lint(minimalModule('m-one', { quiz: [1, 2, 3].map(q).join('\n') })).join(' ')).toMatch(/3 questions for role "staff"/);
    expect(lint(minimalModule('m-one').replace(/## Quiz[\s\S]*?## Sources/, '## Sources')).join(' ')).toMatch(/Missing "## Quiz"/);
  });

  it('counts role-limited questions only for their role', () => {
    const q = (n: number, roles: string): string => `### Question m-one-${String(n)}\n${roles}Q?\n\n- [x] A\n- [ ] B\n- [ ] C\n\nExplanation: E.\n`;
    const quiz = [q(1, ''), q(2, ''), q(3, ''), q(4, 'Roles: managers\n\n')].join('\n');
    expect(lint(minimalModule('m-one', { quiz })).join(' ')).toMatch(/3 questions for role "staff"/);
  });

  it('requires exactly one correct answer, enough options and an explanation', () => {
    const base = minimalModule('m-one');
    expect(lint(base.replace('- [ ] Wrong A 1', '- [x] Wrong A 1')).join(' ')).toMatch(/exactly one correct option/);
    expect(lint(base.replace('- [x] Right 1', '- [ ] Right 1')).join(' ')).toMatch(/exactly one correct option/);
    expect(lint(base.replace('- [ ] Wrong B 1\n', '').replace('- [ ] Wrong A 1\n', '')).join(' ')).toMatch(/3 to 5 answer options/);
    expect(lint(base.replace('Explanation: Because 1.', '')).join(' ')).toMatch(/no "Explanation/);
    expect(lint(base.replace('- [ ] Wrong A 1', '- Wrong A 1')).join(' ')).toMatch(/must start with "\[ \] "/);
  });

  it('warns when the correct answer is always in the same position', () => {
    const q = (n: number): string => `### Question m-one-${String(n)}\nQ${String(n)}?\n\n- [x] A\n- [ ] B\n- [ ] C\n\nExplanation: E.\n`;
    const { issues } = loadAndLint(MINIMAL_COURSE_JSON, new Map([['m-one', minimalModule('m-one', { quiz: [1, 2, 3, 4].map(q).join('\n') })]]));
    expect(issues).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/same position/) as unknown })]);
  });

  it('requires question ids to be unique and prefixed with the module id', () => {
    const base = minimalModule('m-one');
    expect(lint(base.replace('### Question m-one-2', '### Question m-one-1')).join(' ')).toMatch(/also used/);
    expect(lint(base.replace('### Question m-one-2', '### Question other-2')).join(' ')).toMatch(/must start with the module id/);
  });

  it('requires an EUR-Lex source and allows only listed citations', () => {
    const faq = '- [FAQ](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers)';
    expect(lint(minimalModule('m-one', { sources: faq })).join(' ')).toMatch(/at least one EUR-Lex citation/);
    expect(lint(minimalModule('m-one', { sources: '- [Blog](https://example.com/ai-act)' })).join(' ')).toMatch(/not allowed/);
    expect(lint(minimalModule('m-one', { body: 'See [this](javascript:alert(1)).' })).join(' ')).toMatch(/not allowed/);
    expect(lint(minimalModule('m-one', { body: 'See [x](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_999).' })).join(' ')).toMatch(/does not exist/);
  });

  it('rejects unknown roles, placeholders, containers, HTML and control characters', () => {
    expect(lint(minimalModule('m-one', { body: '::: role builders\nX\n:::' })).join(' ')).toMatch(/Unknown role "builders"/);
    expect(lint(minimalModule('m-one', { body: 'Ask {boss}.' })).join(' ')).toMatch(/Unknown placeholder/);
    expect(lint(minimalModule('m-one', { body: '::: aside\nX\n:::' })).join(' ')).toMatch(/Unknown container/);
    expect(lint(minimalModule('m-one', { body: 'Hello <script>alert(1)</script>' })).join(' ')).toMatch(/HTML tag/);
    expect(lint(minimalModule('m-one', { body: 'Bidi \u202E text' })).join(' ')).toMatch(/control, invisible or bidirectional/);
  });

  it('lints a maximum-size module of unclosed tags and brackets quickly', () => {
    // An unanchored /<\/?[a-zA-Z][^>]*>/ was quadratic on "<a<a<a...": about 11 s for one 240 KB paragraph.
    for (const unit of ['<a', '[a']) {
      const body = Array.from({ length: 120 }, () => unit.repeat(990)).join('\n');
      const start = performance.now();
      lint(minimalModule('m-one', { body }));
      expect(performance.now() - start, unit).toBeLessThan(1000);
    }
    expect(lint(minimalModule('m-one', { body: 'a <b and <i>x</i>' })).join(' ')).toMatch(/HTML tag/);
  });

  it('checks front matter and the file name', () => {
    expect(lint(minimalModule('m-one').replace('minutes: 5', 'minutes: 500')).join(' ')).toMatch(/minutes must be/);
    expect(lint(minimalModule('m-one').replace('id: m-one', 'id: m-two')).join(' ')).toMatch(/does not match the file name/);
    expect(lint(minimalModule('m-one').replace('summary:', 'author:')).join(' ')).toMatch(/Unknown front matter key/);
    expect(lint('no front matter').join(' ')).toMatch(/front matter/);
  });

  it('validates course.json strictly', () => {
    const bad = (patch: Record<string, unknown>): string => lint(minimalModule('m-one'), JSON.stringify({ ...JSON.parse(MINIMAL_COURSE_JSON), ...patch })).join(' ');
    expect(bad({ passMark: 0 })).toMatch(/passMark/);
    expect(bad({ extra: true })).toMatch(/Unknown key/);
    expect(bad({ modules: ['m-one', 'm-one'] })).toMatch(/listed twice/);
    expect(bad({ modules: ['m-two'] })).toMatch(/file is missing/);
    expect(bad({ roles: [{ id: 'Staff', title: 'x', description: 'y' }] })).toMatch(/Each role needs/);
    expect(bad({ language: 'english' })).toMatch(/language/);
    expect(lint(minimalModule('m-one'), '{').join(' ')).toMatch(/not valid JSON/);
    expect(lint(minimalModule('m-one'), '{"__proto__": {}}').join(' ')).toMatch(/Unknown key "__proto__"/);
  });

  it('collects every link for checking, including links in options', () => {
    expect(inlineLinks([{ t: 'strong', c: [{ t: 'link', href: 'https://a', c: [] }] }])).toEqual(['https://a']);
    const option = minimalModule('m-one').replace('- [ ] Wrong A 1', '- [ ] [Bad](https://example.com) A 1');
    expect(lint(option).join(' ')).toMatch(/not allowed/);
  });
});
