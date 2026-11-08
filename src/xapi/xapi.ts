// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * xAPI (Experience API 1.0.3) statements for training records, and import
 * of completion statements from a Learning Record Store export.
 *
 * Verbs: `passed`, `failed` and `completed` as defined in the ADL SCORM
 * profile (https://w3id.org/xapi/scorm), and `attended` from the ADL
 * vocabulary (https://w3id.org/xapi/adl). Activity types `course` and
 * `module` from the ADL SCORM profile.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';
import type { Course } from '../content/course.js';
import { ID_PATTERN } from '../content/module.js';
import type { RecordEntry } from '../records/chain.js';
import { type RecordInput, type Result, validateRecordInput } from '../records/fields.js';
import { hasUnsafeCharacter } from '../util/text.js';

/** ADL verb IRIs by record result. */
export const VERBS: Readonly<Record<Result, string>> = {
  passed: 'http://adlnet.gov/expapi/verbs/passed',
  failed: 'http://adlnet.gov/expapi/verbs/failed',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  attended: 'http://adlnet.gov/expapi/verbs/attended',
};

/** ADL activity type IRIs. */
export const ACTIVITY_TYPES = {
  course: 'http://adlnet.gov/expapi/activities/course',
  module: 'http://adlnet.gov/expapi/activities/module',
} as const;

/** Default activity IRI base: a URN, so no web domain is claimed. */
export const DEFAULT_ACTIVITY_BASE = 'urn:groundwork:';

/** Options for statements. */
export interface XapiOptions {
  /** IRI prefix for activity ids; course id and activity id are appended. */
  readonly activityBase?: string;
  /** Home page of the system where person ids come from (account.homePage), an https URL. */
  readonly accountHomePage: string;
}

/** Error with a message that is safe to show. */
export class XapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XapiError';
  }
}

/** Checks an activity IRI base: `urn:` followed by safe characters, or an https URL ending in `/` or `:`. */
export function checkActivityBase(base: string): void {
  if (base.length > 200 || hasUnsafeCharacter(base) || /[\s<>"{}|\\^`]/.test(base)) throw new XapiError('Invalid activity base.');
  if (/^urn:[a-z0-9][a-z0-9-]{0,31}:([A-Za-z0-9()+,\-.:=@;$_!*'%/?#]*[:/])?$/.test(base)) return;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new XapiError('The activity base must be a URN such as "urn:groundwork:" or an https URL ending in "/".');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !base.endsWith('/')) {
    throw new XapiError('The activity base must be a URN such as "urn:groundwork:" or an https URL ending in "/".');
  }
}

/** Checks the account home page: an https URL without credentials. */
export function checkAccountHomePage(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new XapiError('The account home page must be an https URL, e.g. https://hr.example.com.');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || value.length > 200 || /[\s<>"]/.test(value)) {
    throw new XapiError('The account home page must be an https URL, e.g. https://hr.example.com.');
  }
}

/** Namespace for name-based statement ids (a fixed random UUID). */
const STATEMENT_NAMESPACE = '9b0f6c1e-4d2a-4c6b-8f3e-5a7d2b1c0e94';

/**
 * Name-based UUID version 5 (RFC 4122 section 4.3, SHA-1). Statement ids
 * derived from the record hash stay the same when records are exported
 * again, so an LRS recognises repeats.
 */
export function uuidV5(name: string, namespace: string = STATEMENT_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = Uint8Array.from(hash.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(b).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** An xAPI statement as produced here (a subset of the full model). */
export interface Statement {
  readonly id: string;
  readonly actor: { readonly objectType: 'Agent'; readonly account: { readonly homePage: string; readonly name: string } };
  readonly verb: { readonly id: string; readonly display: { readonly 'en-US': string } };
  readonly object: {
    readonly objectType: 'Activity';
    readonly id: string;
    readonly definition?: { readonly type: string; readonly name: { readonly [lang: string]: string } };
  };
  readonly result?: {
    readonly score?: { readonly scaled: number; readonly raw: number; readonly min: 0; readonly max: 100 };
    readonly success?: boolean;
    readonly completion?: boolean;
  };
  readonly context: {
    readonly platform: string;
    readonly language: string;
    readonly contextActivities: { readonly parent: readonly { readonly objectType: 'Activity'; readonly id: string; readonly definition: { readonly type: string; readonly name: { readonly [lang: string]: string } } }[] };
  };
  readonly timestamp: string;
}

/**
 * Statement id of a record: a UUID version 5 of the record's content and
 * time stamp. It does not depend on the chain (sequence number, links,
 * hashes), so it stays the same when the records are exported again, also
 * after `record erase` rewrote the chain.
 */
export function statementId(r: RecordEntry): string {
  return uuidV5(JSON.stringify(['groundwork-record-v1', r.person, r.role, r.activity, r.date, r.result, r.score, r.source, r.ts]));
}

/** Activity IRI of a course. */
export function courseActivityId(base: string, courseId: string): string {
  return `${base}${courseId}`;
}

/** Activity IRI of a module or other activity within a course. */
export function activityId(base: string, courseId: string, activity: string): string {
  return `${base}${courseId}/${activity}`;
}

/** Converts records to xAPI statements. */
export function toStatements(records: readonly RecordEntry[], course: Course, options: XapiOptions): Statement[] {
  const base = options.activityBase ?? DEFAULT_ACTIVITY_BASE;
  checkActivityBase(base);
  checkAccountHomePage(options.accountHomePage);
  const lang = course.language === 'en' ? 'en-US' : course.language;
  return records.map((r) => {
    const module = course.moduleList.find((m) => m.id === r.activity);
    const result: { score?: { scaled: number; raw: number; min: 0; max: 100 }; success?: boolean; completion?: boolean } = {};
    if (r.score !== null) result.score = { scaled: r.score / 100, raw: r.score, min: 0, max: 100 };
    if (r.result === 'passed') result.success = true;
    if (r.result === 'failed') result.success = false;
    if (r.result !== 'failed') result.completion = true;
    return {
      id: statementId(r),
      actor: { objectType: 'Agent', account: { homePage: options.accountHomePage, name: r.person } },
      verb: { id: VERBS[r.result], display: { 'en-US': r.result } },
      object: {
        objectType: 'Activity',
        id: activityId(base, course.id, r.activity),
        ...(module ? { definition: { type: ACTIVITY_TYPES.module, name: { [lang]: module.title } } } : {}),
      },
      ...(Object.keys(result).length > 0 ? { result } : {}),
      context: {
        platform: 'Groundwork',
        language: course.language,
        contextActivities: { parent: [{ objectType: 'Activity', id: courseActivityId(base, course.id), definition: { type: ACTIVITY_TYPES.course, name: { [lang]: course.title } } }] },
      },
      timestamp: `${r.date}T00:00:00.000Z`,
    };
  });
}

/** Options for importing statements. */
export interface ImportOptions {
  readonly courseId: string;
  readonly role: string;
  readonly activityBase?: string;
  /** Only accept actors whose account.homePage equals this. */
  readonly accountHomePage?: string;
  /** Accept actors identified only by an email address (mbox), storing the address. */
  readonly allowEmail?: boolean;
}

/** Result of an import: valid record inputs and counts of skipped statements by reason. */
export interface ImportResult {
  readonly inputs: RecordInput[];
  readonly skipped: ReadonlyMap<string, number>;
}

/** Maximum number of statements in one import. */
export const MAX_STATEMENTS = 100_000;

/** The inverse functional identifiers of an xAPI Agent (xAPI 1.0.3, Data 2.4.2.3). */
const IFI_KEYS = ['mbox', 'mbox_sha1sum', 'openid', 'account'] as const;

const RESULT_BY_VERB = new Map<string, Result>(Object.entries(VERBS).map(([k, v]) => [v, k as Result]));

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scoreOf(result: unknown): number | null | undefined {
  if (!isObj(result) || !isObj(result.score)) return null;
  const { scaled, raw, min, max } = result.score;
  if (typeof scaled === 'number' && Number.isFinite(scaled)) return scaled >= 0 && scaled <= 1 ? Math.round(scaled * 100) : undefined;
  if (typeof raw === 'number' && typeof min === 'number' && typeof max === 'number' && Number.isFinite(raw) && max > min && raw >= min && raw <= max) {
    return Math.round(((raw - min) / (max - min)) * 100);
  }
  return null;
}

/**
 * Maps xAPI statements (an array, or an LRS StatementResult object with a
 * `statements` array) to record inputs. Only `passed`, `failed`,
 * `completed` and `attended` statements about activities of this course are
 * used; everything else is counted as skipped. Voiding statements are
 * skipped; statements voided elsewhere cannot be detected from the
 * statements alone, so export from the LRS without voided statements.
 */
export function fromStatements(data: unknown, options: ImportOptions, now: Date = new Date()): ImportResult {
  const base = options.activityBase ?? DEFAULT_ACTIVITY_BASE;
  checkActivityBase(base);
  if (options.accountHomePage !== undefined) checkAccountHomePage(options.accountHomePage);
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.statements) ? data.statements : undefined;
  if (!list) throw new XapiError('Expected a JSON array of statements or an object with a "statements" array.');
  if (list.length > MAX_STATEMENTS) throw new XapiError(`More than ${String(MAX_STATEMENTS)} statements.`);
  const prefix = `${base}${options.courseId}/`;
  const inputs: RecordInput[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };
  for (const s of list as unknown[]) {
    if (!isObj(s) || !isObj(s.verb) || !isObj(s.actor) || !isObj(s.object)) {
      skip('not a statement');
      continue;
    }
    const verbId = s.verb.id;
    const result = typeof verbId === 'string' ? RESULT_BY_VERB.get(verbId) : undefined;
    if (!result) {
      skip('other verb');
      continue;
    }
    // xAPI 1.0.3, Data 2.4.2.1 and 2.4.2.2: an Agent (a person) has objectType "Agent" or none, and
    // exactly one inverse functional identifier. A Group's result is not a person's, and an actor
    // with two identifiers is invalid and could name two people.
    if (s.actor.objectType !== undefined && s.actor.objectType !== 'Agent') {
      skip('actor is not a person (group)');
      continue;
    }
    if (IFI_KEYS.filter((k) => Object.hasOwn(s.actor as object, k)).length > 1) {
      skip('actor with more than one identifier');
      continue;
    }
    let person: string | undefined;
    const account = s.actor.account;
    if (isObj(account) && typeof account.name === 'string' && typeof account.homePage === 'string') {
      if (options.accountHomePage !== undefined && account.homePage !== options.accountHomePage) {
        skip('account from another system');
        continue;
      }
      person = account.name;
    } else if (options.allowEmail && typeof s.actor.mbox === 'string' && /^mailto:[^\s@]{1,64}@[^\s@]{1,190}$/.test(s.actor.mbox)) {
      person = s.actor.mbox.slice('mailto:'.length);
    }
    if (person === undefined) {
      skip('actor without account');
      continue;
    }
    const objectId = s.object.id;
    const activity = typeof objectId === 'string' && objectId.startsWith(prefix) ? objectId.slice(prefix.length) : undefined;
    if (activity === undefined || !ID_PATTERN.test(activity) || activity.length > 64) {
      skip('activity not in this course');
      continue;
    }
    const score = scoreOf(s.result);
    if (score === undefined) {
      skip('invalid score');
      continue;
    }
    const ts = s.timestamp;
    const m = typeof ts === 'string' ? /^([0-9]{4}-[0-9]{2}-[0-9]{2})T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})$/.exec(ts) : null;
    if (!m || typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) {
      skip('invalid timestamp');
      continue;
    }
    // The calendar date as written in the time stamp, that is in the learner's
    // or the LRS's time zone, as for CSV imports and `record add`; converting
    // to UTC would move late-evening and early-morning completions to another day.
    const date = m[1] ?? '';
    const input: RecordInput = { person: person.trim(), role: options.role, activity, date, result, score, source: 'xapi' };
    if (validateRecordInput(input, now).length > 0) {
      skip('invalid record');
      continue;
    }
    inputs.push(input);
  }
  return { inputs, skipped };
}
