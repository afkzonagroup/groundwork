// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Quiz grading used by the course pages in the browser. Pure functions, no
 * DOM access, so they are tested directly.
 *
 * @packageDocumentation
 */

/** Answer key embedded in each module page. */
export interface AnswerKey {
  /** Pass mark in percent. */
  readonly passMark: number;
  /** Question ids in page order with the index of the correct option. */
  readonly answers: readonly { readonly id: string; readonly correct: number }[];
}

/** Result of grading one attempt. */
export interface GradeResult {
  readonly correct: number;
  readonly total: number;
  /** Whole percent, rounded down so that a pass is never rounded up. */
  readonly percent: number;
  readonly passed: boolean;
  readonly perQuestion: readonly { readonly id: string; readonly correct: boolean; readonly answered: boolean }[];
}

const MAX_QUESTIONS = 200;

/**
 * Parses and validates the answer key JSON. Returns undefined if it is not
 * well formed, so a damaged page fails closed (no grading) instead of
 * grading wrongly.
 */
export function parseAnswerKey(text: string): AnswerKey | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const passMark = record.passMark;
  const answers = record.answers;
  if (typeof passMark !== 'number' || !Number.isInteger(passMark) || passMark < 1 || passMark > 100) return undefined;
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > MAX_QUESTIONS) return undefined;
  const out: { id: string; correct: number }[] = [];
  const seen = new Set<string>();
  for (const a of answers as unknown[]) {
    if (typeof a !== 'object' || a === null) return undefined;
    const { id, correct } = a as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id) || seen.has(id)) return undefined;
    if (typeof correct !== 'number' || !Number.isInteger(correct) || correct < 0 || correct > 9) return undefined;
    seen.add(id);
    out.push({ id, correct });
  }
  return { passMark, answers: out };
}

/**
 * Grades responses (selected option index per question id; missing means
 * unanswered) against the key.
 */
export function grade(key: AnswerKey, responses: ReadonlyMap<string, number>): GradeResult {
  const perQuestion = key.answers.map((a) => {
    const chosen = responses.get(a.id);
    return { id: a.id, answered: chosen !== undefined, correct: chosen === a.correct };
  });
  const correct = perQuestion.filter((q) => q.correct).length;
  const total = key.answers.length;
  const percent = total === 0 ? 0 : Math.floor((correct * 100) / total);
  return { correct, total, percent, passed: percent >= key.passMark, perQuestion };
}
