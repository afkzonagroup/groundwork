// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { type ParseIssue, inlineText, parseBlocks, parseInline } from '../src/content/markdown.js';

describe('parseInline', () => {
  it('parses strong, emphasis, code, links and placeholders', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.eu/) {organisation}')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://x.eu/', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'placeholder', name: 'organisation' },
    ]);
  });

  it('keeps unmatched delimiters and escaped characters as text', () => {
    expect(inlineText(parseInline('2 * 3 = 6, **open, [x] and \\*star\\* and `tick'))).toBe('2 * 3 = 6, **open, [x] and *star* and `tick');
    expect(parseInline('a [b](c d)')).toEqual([{ t: 'text', v: 'a [b](c d)' }]);
  });

  it('nests emphasis in strong and strong in links', () => {
    expect(parseInline('**a *b* c**')[0]).toEqual({ t: 'strong', c: [{ t: 'text', v: 'a ' }, { t: 'em', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }] });
    expect(parseInline('[**a**](https://x)')[0]).toEqual({ t: 'link', href: 'https://x', c: [{ t: 'strong', c: [{ t: 'text', v: 'a' }] }] });
  });

  it('reports unknown placeholders, empty links and deep nesting', () => {
    const issues: ParseIssue[] = [];
    parseInline('{unknown} [x]()', 3, issues);
    expect(issues.map((i) => i.message).join(' ')).toMatch(/Unknown placeholder.*Link without a target/);
    const deep: ParseIssue[] = [];
    parseInline(`${'['.repeat(9)}x${'](https://a)'.repeat(9)}`, 1, deep);
    expect(deep.map((i) => i.message)).toContain('Inline formatting is nested too deeply.');
    const nested = '[' + '**x '.repeat(10) + ']';
    expect(() => parseInline(nested)).not.toThrow();
  });

  it('stays fast on hostile input', () => {
    const start = performance.now();
    for (const unit of ['**a ', '*a ', '[a ', '*a **b ', '`a ']) parseInline(unit.repeat(Math.floor(4000 / unit.length)));
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it('refuses overlong paragraphs instead of parsing them', () => {
    const issues: ParseIssue[] = [];
    const long = '**a '.repeat(50_000);
    const start = performance.now();
    expect(parseInline(long, 7, issues)).toEqual([{ t: 'text', v: long }]);
    expect(performance.now() - start).toBeLessThan(100);
    expect(issues[0]).toEqual({ line: 7, message: 'Paragraph, list item or heading longer than 4000 characters; split it.' });
  });

  it('lints a hostile module of the maximum size quickly', () => {
    const start = performance.now();
    const { issues } = parseBlocks(Array.from({ length: 120 }, () => '**a '.repeat(500)).join('\n'));
    expect(issues.some((i) => /longer than 4000/.test(i.message))).toBe(true);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe('parseBlocks', () => {
  it('parses headings, paragraphs, lists and containers', () => {
    const { blocks, issues } = parseBlocks('## Title\n\nLine one\nline two\n\n- a\n  continued\n- b\n\n1. x\n2. y\n\n::: note\nInside\n:::\n');
    expect(issues).toEqual([]);
    expect(blocks.map((b) => b.t)).toEqual(['heading', 'paragraph', 'list', 'list', 'container']);
    expect(blocks[1]).toMatchObject({ raw: 'Line one line two', line: 3 });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [{ raw: 'a continued' }, { raw: 'b' }] });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[4]).toMatchObject({ name: 'note', args: [], blocks: [{ t: 'paragraph', raw: 'Inside' }] });
  });

  it('reports structural problems with line numbers', () => {
    const messages = (s: string): string[] => parseBlocks(s).issues.map((i) => `${String(i.line)}: ${i.message}`);
    expect(messages('# Top')).toEqual(['1: Heading level 1 is not allowed; use ## to ####.']);
    expect(messages('::: note\nopen')[0]).toMatch(/1: Container ::: note is not closed/);
    expect(messages(':::')[0]).toMatch(/without an open container/);
    expect(messages('::: a\n::: b\n::: c\nx\n:::\n:::\n:::').join(' ')).toMatch(/nested too deeply/);
    expect(messages('- a\n  - b').join(' ')).toMatch(/Nested lists/);
    expect(messages('a\tb').join(' ')).toMatch(/Tab/);
    expect(messages(':::bad line!').join(' ')).toMatch(/Malformed container/);
  });

  it('enforces size limits', () => {
    expect(parseBlocks('x\n'.repeat(6000)).issues[0]?.message).toMatch(/Too many lines/);
    expect(parseBlocks('x'.repeat(2001)).issues[0]?.message).toMatch(/longer than 2000/);
  });

  it('stays fast on hostile lines: long headings, trailing spaces, containers and closing hashes', () => {
    // The former heading pattern /^(#{1,6})\s+(.+?)\s*#*\s*$/ took minutes on one 10,000-character line.
    const hostile = [
      `## a${' '.repeat(250_000)}b`,
      Array.from({ length: 120 }, () => `## a${' '.repeat(1990)}b`).join('\n'),
      `a${' '.repeat(250_000)}b`,
      `::: a${' '.repeat(250_000)}!`,
      `## a ${'#'.repeat(250_000)}`,
      Array.from({ length: 120 }, () => `- x${' '.repeat(1990)}y`).join('\n'),
    ];
    for (const text of hostile) {
      const start = performance.now();
      parseBlocks(text);
      expect(performance.now() - start, text.slice(0, 20)).toBeLessThan(500);
    }
  });

  it('parses only the allowed length of an overlong line', () => {
    const { blocks, issues } = parseBlocks(`## ${'a'.repeat(3000)}`);
    expect(issues.map((i) => i.message)).toEqual(['Line longer than 2000 characters.']);
    expect(blocks[0]).toMatchObject({ t: 'heading', raw: 'a'.repeat(1997) });
  });

  it('removes a closing run of hashes only after whitespace', () => {
    expect(parseBlocks('## Title ##').blocks[0]).toMatchObject({ t: 'heading', raw: 'Title' });
    expect(parseBlocks('## C#').blocks[0]).toMatchObject({ t: 'heading', raw: 'C#' });
    expect(parseBlocks('### Question a-1   ').blocks[0]).toMatchObject({ t: 'heading', level: 3, raw: 'Question a-1' });
    expect(parseBlocks('##no space').blocks[0]).toMatchObject({ t: 'paragraph' });
  });

  it('treats raw HTML as text', () => {
    const { blocks } = parseBlocks('<img src=x onerror=alert(1)>');
    expect(blocks[0]).toMatchObject({ t: 'paragraph', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] });
  });
});
