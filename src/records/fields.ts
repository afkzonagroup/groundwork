// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The fields of a training record and their validation. A record holds only
 * what is needed to show that a person took part in an AI literacy measure:
 * who (name or employee id), in which role variant, which activity, when,
 * the result and, optionally, the score.
 *
 * @packageDocumentation
 */

import { ID_PATTERN } from '../content/module.js';
import { hasUnsafeCharacter, isIsoDate } from '../util/text.js';

/** Results a record can have. */
export const RESULTS = ['passed', 'failed', 'completed', 'attended'] as const;
export type Result = (typeof RESULTS)[number];

/** Where a record came from. */
export const SOURCES = ['manual', 'xapi', 'csv'] as const;
export type Source = (typeof SOURCES)[number];

/** The data of one record. */
export interface RecordInput {
  /** Name or employee id. Prefer an id to keep personal data in the HR system. */
  readonly person: string;
  /** Role variant of the course, e.g. "staff". */
  readonly role: string;
  /** Module id or another activity id, e.g. "ai-basics" or "tool-briefing". */
  readonly activity: string;
  /** Date of the activity, YYYY-MM-DD. */
  readonly date: string;
  readonly result: Result;
  /** Score in percent (0 to 100), or null. */
  readonly score: number | null;
  readonly source: Source;
}

/** Field length limits. */
export const FIELD_LIMITS = { person: 200, role: 32, activity: 64 } as const;

function isResult(value: unknown): value is Result {
  return typeof value === 'string' && (RESULTS as readonly string[]).includes(value);
}

function isSource(value: unknown): value is Source {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}

/**
 * Validates a record. Returns a list of problems (empty if valid). Dates
 * more than one day after `now` are rejected, which allows for time zones.
 */
export function validateRecordInput(input: RecordInput, now: Date = new Date()): string[] {
  const problems: string[] = [];
  const value = input as unknown as Record<string, unknown>;
  const person = value.person;
  if (typeof person !== 'string' || person.length === 0 || person.length > FIELD_LIMITS.person || person.trim() !== person || hasUnsafeCharacter(person)) {
    problems.push(`person must be 1 to ${String(FIELD_LIMITS.person)} characters, without leading or trailing spaces or control characters.`);
  }
  if (typeof value.role !== 'string' || !ID_PATTERN.test(value.role) || value.role.length > FIELD_LIMITS.role) problems.push('role must be a lower-case id such as "staff".');
  if (typeof value.activity !== 'string' || !ID_PATTERN.test(value.activity) || value.activity.length > FIELD_LIMITS.activity) {
    problems.push('activity must be a lower-case id such as "ai-basics".');
  }
  if (typeof value.date !== 'string' || !isIsoDate(value.date)) problems.push('date must be a valid date in the form YYYY-MM-DD.');
  else {
    const latest = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (value.date > latest) problems.push('date must not be in the future.');
  }
  if (!isResult(value.result)) problems.push(`result must be one of: ${RESULTS.join(', ')}.`);
  const score = value.score;
  if (score !== null && (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100)) problems.push('score must be a whole number from 0 to 100, or empty.');
  if (!isSource(value.source)) problems.push(`source must be one of: ${SOURCES.join(', ')}.`);
  return problems;
}

/** Identity of a record for duplicate detection. */
export function recordKey(r: RecordInput): string {
  return JSON.stringify([r.person, r.role, r.activity, r.date, r.result, r.score]);
}

/** Parses a score given as text: empty means null; decimals are rounded to whole percent. */
export function parseScore(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^[0-9]{1,3}([.,][0-9]{1,4})?$/.test(t)) return undefined;
  const n = Math.round(Number(t.replace(',', '.')));
  return n >= 0 && n <= 100 ? n : undefined;
}

export { isResult };
