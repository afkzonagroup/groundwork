// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Browser code: grading, answer key validation, SCORM 1.2 API discovery and
// cmi calls, and the generated bundle.

import { describe, expect, it } from 'vitest';
import { grade, parseAnswerKey } from '../src/client/grade.js';
import { MAX_API_SEARCH_DEPTH, type Scorm12Api, ScormSession, type WindowLike, findScormApi, formatCmiTimespan } from '../src/client/scorm.js';
import { CLIENT_SCRIPT } from '../src/site/client-script.generated.js';
import { OUTPUT, bundleClient } from '../scripts/client-bundle.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.js';

describe('grading', () => {
  const key = { passMark: 80, answers: [0, 1, 2, 0, 1].map((correct, i) => ({ id: `q-${String(i)}`, correct })) };

  it('scores and applies the pass mark', () => {
    const all = new Map(key.answers.map((a) => [a.id, a.correct]));
    expect(grade(key, all)).toMatchObject({ correct: 5, total: 5, percent: 100, passed: true });
    all.set('q-0', 2);
    expect(grade(key, all)).toMatchObject({ correct: 4, percent: 80, passed: true });
    all.set('q-1', 0);
    expect(grade(key, all)).toMatchObject({ correct: 3, percent: 60, passed: false });
  });

  it('rounds down, so 79.9 % never passes an 80 % mark', () => {
    const k = { passMark: 80, answers: Array.from({ length: 6 }, (_, i) => ({ id: `q-${String(i)}`, correct: 0 })) };
    const r = new Map(k.answers.map((a) => [a.id, 0]));
    r.set('q-0', 1);
    expect(grade(k, r)).toMatchObject({ correct: 5, percent: 83, passed: true });
    const k7 = { passMark: 86, answers: Array.from({ length: 7 }, (_, i) => ({ id: `q-${String(i)}`, correct: 0 })) };
    const r7 = new Map(k7.answers.map((a) => [a.id, 0]));
    r7.set('q-0', 1);
    expect(grade(k7, r7)).toMatchObject({ correct: 6, percent: 85, passed: false });
  });

  it('marks unanswered questions', () => {
    expect(grade(key, new Map()).perQuestion.every((q) => !q.answered && !q.correct)).toBe(true);
  });

  it('accepts only a well-formed answer key', () => {
    expect(parseAnswerKey(JSON.stringify(key))).toEqual(key);
    for (const bad of ['', 'null', '[]', '{"passMark":0,"answers":[{"id":"a","correct":0}]}', '{"passMark":80,"answers":[]}', '{"passMark":80,"answers":[{"id":"A B","correct":0}]}', '{"passMark":80,"answers":[{"id":"a","correct":-1}]}', '{"passMark":80,"answers":[{"id":"a","correct":0},{"id":"a","correct":1}]}', '{"passMark":80.5,"answers":[{"id":"a","correct":0}]}']) {
      expect(parseAnswerKey(bad), bad).toBeUndefined();
    }
  });
});

function fakeApi(initialStatus = 'not attempted'): Scorm12Api & { calls: string[]; data: Map<string, string> } {
  const calls: string[] = [];
  const data = new Map<string, string>([['cmi.core.lesson_status', initialStatus]]);
  return {
    calls,
    data,
    LMSInitialize: (p) => (calls.push(`init${p}`), 'true'),
    LMSFinish: (p) => (calls.push(`finish${p}`), 'true'),
    LMSGetValue: (k) => (calls.push(`get ${k}`), data.get(k) ?? ''),
    LMSSetValue: (k, v) => (calls.push(`set ${k}=${v}`), data.set(k, v), 'true'),
    LMSCommit: (p) => (calls.push(`commit${p}`), 'true'),
    LMSGetLastError: () => '0',
  };
}

describe('SCORM 1.2 API discovery', () => {
  it('finds the API on this window, a parent or the opener', () => {
    const api = fakeApi();
    const top: WindowLike = { parent: null, API: api };
    const middle: WindowLike = { parent: top };
    const frame: WindowLike = { parent: middle };
    expect(findScormApi(frame)).toBe(api);
    expect(findScormApi(top)).toBe(api);
    const popup: WindowLike = { parent: null, opener: frame };
    expect(findScormApi(popup)).toBe(api);
  });

  it('stops at the depth limit, at cross-origin parents and at self-parented windows', () => {
    const api = fakeApi();
    let win: WindowLike = { parent: null, API: api };
    for (let i = 0; i < MAX_API_SEARCH_DEPTH + 2; i++) win = { parent: win };
    expect(findScormApi(win)).toBeUndefined();
    const crossOrigin = {
      get API(): unknown {
        throw new Error('SecurityError');
      },
      parent: null,
    };
    expect(findScormApi({ parent: crossOrigin })).toBeUndefined();
    const self: { parent: WindowLike | null } = { parent: null };
    self.parent = self;
    expect(findScormApi(self)).toBeUndefined();
  });

  it('ignores objects that are not a SCORM 1.2 API', () => {
    expect(findScormApi({ parent: null, API: { LMSInitialize: () => 'true' } })).toBeUndefined();
    expect(findScormApi({ parent: null, API: 'API' })).toBeUndefined();
  });
});

describe('SCORM 1.2 session', () => {
  it('initialises, reports and finishes with valid cmi values', () => {
    const api = fakeApi();
    const s = new ScormSession(api, 1000);
    expect(s.start()).toBe(true);
    expect(api.data.get('cmi.core.lesson_status')).toBe('incomplete');
    expect(s.report(90, true)).toBe('sent');
    s.finish(1000 + 3_723_450);
    s.finish(99_999_999);
    expect(Object.fromEntries(api.data)).toEqual({
      'cmi.core.lesson_status': 'passed',
      'cmi.core.score.min': '0',
      'cmi.core.score.max': '100',
      'cmi.core.score.raw': '90',
      'cmi.core.session_time': '01:02:03.45',
      'cmi.core.exit': '',
    });
    expect(api.calls[0]).toBe('init');
    expect(api.calls.filter((c) => c === 'finish')).toHaveLength(1);
    expect(api.calls[api.calls.length - 1]).toBe('finish');
  });

  it('keeps an earlier pass when a later attempt fails', () => {
    const api = fakeApi('passed');
    const s = new ScormSession(api, 0);
    s.start();
    api.data.set('cmi.core.score.raw', '90');
    expect(s.report(40, false)).toBe('kept');
    expect(api.data.get('cmi.core.lesson_status')).toBe('passed');
    // The score stays too: an LMS that applies adlcp:masteryscore would otherwise turn the pass into a fail.
    expect(api.data.get('cmi.core.score.raw')).toBe('90');
    expect(s.report(100, true)).toBe('sent');
    expect(api.data.get('cmi.core.score.raw')).toBe('100');
  });

  it('records a fail and does nothing before start or after finish', () => {
    const api = fakeApi();
    const s = new ScormSession(api, 0);
    expect(s.report(50, false)).toBe('refused');
    s.start();
    expect(s.report(50, false)).toBe('sent');
    expect(api.data.get('cmi.core.lesson_status')).toBe('failed');
    s.finish(10);
    expect(s.report(100, true)).toBe('refused');
  });

  it('reports failure when the LMS refuses to initialise', () => {
    const api = { ...fakeApi(), LMSInitialize: () => 'false' };
    expect(new ScormSession(api, 0).start()).toBe(false);
  });

  it('reports a result the LMS refuses as refused', () => {
    const api = { ...fakeApi(), LMSSetValue: () => 'false' };
    const s = new ScormSession(api, 0);
    s.start();
    expect(s.report(90, true)).toBe('refused');
  });

  it('formats CMITimespan values', () => {
    expect(formatCmiTimespan(0)).toBe('00:00:00.00');
    expect(formatCmiTimespan(-5)).toBe('00:00:00.00');
    expect(formatCmiTimespan(59_990)).toBe('00:00:59.99');
    expect(formatCmiTimespan(100 * 3600 * 1000)).toBe('100:00:00.00');
    expect(formatCmiTimespan(1e15)).toBe('9999:59:59.99');
    for (const v of [0, 1234, 3_600_000, 1e12]) expect(formatCmiTimespan(v)).toMatch(/^[0-9]{2,4}:[0-9]{2}:[0-9]{2}\.[0-9]{2}$/);
  });
});

describe('generated client bundle', () => {
  it('is up to date with src/client', async () => {
    expect(readFileSync(join(ROOT, OUTPUT), 'utf8')).toBe(await bundleClient(ROOT));
  });

  it('is ASCII and uses no HTML sinks, eval or network APIs', () => {
    expect(/^[\x20-\x7e\n]*$/.test(CLIENT_SCRIPT)).toBe(true);
    for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /fetch\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /window\.open/, /\blocation\.(href|assign|replace)/]) {
      expect(re.test(CLIENT_SCRIPT), String(re)).toBe(false);
    }
    expect(CLIENT_SCRIPT).not.toContain('</script');
  });
});
