// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SCORM 1.2 runtime: finds the LMS API object and reports status and score
 * through the cmi data model (cmi.core.*).
 *
 * @packageDocumentation
 */

/** The SCORM 1.2 API object an LMS exposes as `API` on a parent window. */
export interface Scorm12Api {
  LMSInitialize(parameter: ''): string;
  LMSFinish(parameter: ''): string;
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): string;
  LMSCommit(parameter: ''): string;
  LMSGetLastError(): string;
}

/** The part of `Window` the API search needs. */
export interface WindowLike {
  readonly parent: WindowLike | null;
  readonly opener?: WindowLike | null;
  readonly API?: unknown;
}

const API_FUNCTIONS = ['LMSInitialize', 'LMSFinish', 'LMSGetValue', 'LMSSetValue', 'LMSCommit', 'LMSGetLastError'] as const;

/** Maximum number of parent windows searched (common practice in SCORM 1.2 runtimes). */
export const MAX_API_SEARCH_DEPTH = 10;

function asApi(candidate: unknown): Scorm12Api | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const record = candidate as Record<string, unknown>;
  for (const name of API_FUNCTIONS) if (typeof record[name] !== 'function') return undefined;
  return candidate as Scorm12Api;
}

function apiOf(win: WindowLike): Scorm12Api | undefined {
  try {
    return asApi(win.API);
  } catch {
    // A cross-origin parent throws on property access.
    return undefined;
  }
}

function searchParents(start: WindowLike): Scorm12Api | undefined {
  let win: WindowLike = start;
  for (let depth = 0; depth <= MAX_API_SEARCH_DEPTH; depth++) {
    const api = apiOf(win);
    if (api) return api;
    let parent: WindowLike | null;
    try {
      parent = win.parent;
    } catch {
      return undefined;
    }
    if (parent === null || parent === win) return undefined;
    win = parent;
  }
  return undefined;
}

/**
 * Finds the SCORM 1.2 API: this window and its parents first, then the
 * opener and its parents (SCORM 1.2 run-time environment, API discovery).
 */
export function findScormApi(win: WindowLike): Scorm12Api | undefined {
  const found = searchParents(win);
  if (found) return found;
  let opener: WindowLike | null | undefined;
  try {
    opener = win.opener;
  } catch {
    return undefined;
  }
  return opener ? searchParents(opener) : undefined;
}

/**
 * Formats a duration as a SCORM 1.2 CMITimespan, `HHHH:MM:SS.SS` (hours
 * with 2 to 4 digits). Capped at 9999:59:59.99.
 */
export function formatCmiTimespan(milliseconds: number): string {
  const centis = Math.max(0, Math.min(Math.floor(milliseconds / 10), 9999 * 360000 + 359999));
  const hours = Math.floor(centis / 360000);
  const minutes = Math.floor((centis % 360000) / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  const fraction = centis % 100;
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(fraction, 2)}`;
}

/** Lesson status values of the SCORM 1.2 cmi.core.lesson_status vocabulary. */
export const LESSON_STATUSES = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'] as const;

/** Longest `cmi.suspend_data` an LMS must keep (SCORM 1.2 type CMIString4096). */
export const MAX_SUSPEND_DATA = 4096;
/** Longest `cmi.core.lesson_location` an LMS must keep (SCORM 1.2 type CMIString255). */
export const MAX_LESSON_LOCATION = 255;

/** Format version written into suspend data, so a later format can be told apart. */
const SUSPEND_FORMAT = 1;
const MAX_SECTION = 999;

/**
 * Where the learner was when they left a module before passing it: the
 * answers they had chosen but not yet checked, and the section they were
 * reading. Saved in `cmi.suspend_data` and `cmi.core.lesson_location`.
 */
export interface ResumeState {
  /** Chosen option index per question id. */
  readonly answers: ReadonlyMap<string, number>;
  /** Index of the page section in view, counted from 0. */
  readonly section: number;
}

/** The part of the answer key the resume data is checked against. */
export interface ResumeKey {
  readonly answers: readonly { readonly id: string }[];
}

const ANSWER_ID = /^[a-z0-9-]{1,64}$/;

/**
 * Encodes chosen answers as compact JSON for `cmi.suspend_data`, for
 * example `{"v":1,"a":[["q1",2]]}`. Returns "" when nothing is chosen or
 * the result would not fit in CMIString4096.
 */
export function encodeSuspendData(answers: ReadonlyMap<string, number>): string {
  const pairs = [...answers].filter(([id, n]) => ANSWER_ID.test(id) && Number.isInteger(n) && n >= 0 && n <= 9);
  if (pairs.length === 0) return '';
  const text = JSON.stringify({ v: SUSPEND_FORMAT, a: pairs });
  return text.length <= MAX_SUSPEND_DATA ? text : '';
}

/**
 * Decodes `cmi.suspend_data` written by {@link encodeSuspendData}. The LMS
 * stores whatever the page sent, so the value is treated as untrusted:
 * only questions in this page's key and option indexes 0 to 9 are kept,
 * and anything malformed yields an empty map.
 */
export function decodeSuspendData(text: string, key: ResumeKey): Map<string, number> {
  const out = new Map<string, number>();
  if (text === '' || text.length > MAX_SUSPEND_DATA) return out;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return out;
  const { v, a } = data as Record<string, unknown>;
  if (v !== SUSPEND_FORMAT || !Array.isArray(a)) return out;
  const known = new Set(key.answers.map((x) => x.id));
  for (const pair of a as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2) return new Map();
    const [id, n] = pair as unknown[];
    if (typeof id !== 'string' || !known.has(id) || typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 9) return new Map();
    out.set(id, n);
  }
  return out;
}

/** Encodes a section index for `cmi.core.lesson_location`. */
export function encodeLessonLocation(section: number): string {
  return Number.isInteger(section) && section >= 0 && section <= MAX_SECTION ? String(section) : '';
}

/** Decodes `cmi.core.lesson_location`; undefined unless it is a section index we wrote. */
export function decodeLessonLocation(text: string): number | undefined {
  return /^(0|[1-9][0-9]{0,2})$/.test(text) ? Number(text) : undefined;
}

/** What {@link ScormSession.start} found when the LMS resumes a suspended session. */
export interface ResumedData {
  readonly suspendData: string;
  readonly lessonLocation: string;
}

/**
 * Whether the LMS records results in this session: "normal", or why not.
 * "browse" and "review" come from `cmi.core.lesson_mode` (Moodle's Preview is
 * "browse"); "no-credit" from `cmi.core.credit` in normal mode (ILIAS runs a
 * module without learning progress this way and discards scores).
 */
export type RecordingMode = 'normal' | 'browse' | 'review' | 'no-credit';

/** One SCO session: initialize once, report results, finish once. */
export class ScormSession {
  private started = false;
  private finished = false;
  private mode: RecordingMode = 'normal';
  private resumed: ResumedData | undefined;
  private readonly startedAt: number;

  constructor(
    private readonly api: Scorm12Api,
    now: number,
  ) {
    this.startedAt = now;
  }

  /**
   * LMSInitialize; marks a new attempt as incomplete and keeps the saved
   * suspend data and location for {@link resumedData} when the learner
   * returns to a module they left before passing it. Returns false if the
   * LMS refused.
   *
   * In "browse" and "review" mode (`cmi.core.lesson_mode`, for example
   * Moodle's Preview) and without credit (`cmi.core.credit` "no-credit"),
   * quiz results are not reported and nothing is saved for resuming; see
   * {@link recordingMode}. A module not attempted before is marked
   * "browsed" in browse mode: Moodle 5.3 would otherwise turn "not
   * attempted" into "completed" when the preview ends.
   *
   * The saved state is used when `cmi.core.entry` is "resume" or when
   * suspend data is present, whatever `cmi.core.entry` says: Moodle computes
   * `cmi.core.entry` once when its player opens, so a learner who leaves a
   * module and returns to it in the same player visit gets "ab-initio" or ""
   * although the module was suspended. This runtime clears the suspend data
   * whenever a module exits normally, so it is only present after a
   * suspend, and it holds only answers not yet checked, never a result.
   */
  start(): boolean {
    if (this.started) return true;
    if (this.api.LMSInitialize('') !== 'true') return false;
    this.started = true;
    const lessonMode = this.api.LMSGetValue('cmi.core.lesson_mode');
    const status = this.api.LMSGetValue('cmi.core.lesson_status');
    this.mode = lessonMode === 'browse' || lessonMode === 'review' ? lessonMode : this.api.LMSGetValue('cmi.core.credit') === 'no-credit' ? 'no-credit' : 'normal';
    if (this.mode !== 'normal') {
      if (this.mode === 'browse' && (status === '' || status === 'not attempted')) {
        this.api.LMSSetValue('cmi.core.lesson_status', 'browsed');
        this.api.LMSCommit('');
      }
      return true;
    }
    if (status === '' || status === 'not attempted') {
      this.api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
      this.api.LMSCommit('');
    }
    const suspendData = this.api.LMSGetValue('cmi.suspend_data');
    if (suspendData !== '' || this.api.LMSGetValue('cmi.core.entry') === 'resume') {
      this.resumed = { suspendData, lessonLocation: this.api.LMSGetValue('cmi.core.lesson_location') };
    }
    return true;
  }

  /** "normal" when the LMS records results; otherwise the reason it does not. */
  recordingMode(): RecordingMode {
    return this.mode;
  }

  /** True when the LMS records results (see {@link recordingMode}). */
  isRecording(): boolean {
    return this.mode === 'normal';
  }

  /** The saved state when this session resumes a suspended one, else undefined. */
  resumedData(): ResumedData | undefined {
    return this.resumed;
  }

  /**
   * Records a quiz result: score from 0 to 100 and passed or failed.
   * Returns "sent" when the LMS accepted it, "kept" when an earlier pass is
   * kept, "not-recorded" when the LMS does not record results in this
   * session (browse, review or no-credit), and "refused" otherwise.
   *
   * A passed status already in the LMS is not replaced by a later fail, and
   * neither is its score: the manifest sets `adlcp:masteryscore`, and an LMS
   * may derive the status from `cmi.core.score.raw` and the mastery score
   * (SCORM 1.2 run-time environment), so a lower score alone could turn the
   * earlier pass into a fail.
   */
  report(percent: number, passed: boolean): 'sent' | 'kept' | 'not-recorded' | 'refused' {
    if (!this.started || this.finished) return 'refused';
    if (this.mode !== 'normal') return 'not-recorded';
    const previous = this.api.LMSGetValue('cmi.core.lesson_status');
    if (!passed && previous === 'passed') return 'kept';
    const raw = String(Math.max(0, Math.min(100, Math.floor(percent))));
    const ok = [
      this.api.LMSSetValue('cmi.core.score.min', '0'),
      this.api.LMSSetValue('cmi.core.score.max', '100'),
      this.api.LMSSetValue('cmi.core.score.raw', raw),
      this.api.LMSSetValue('cmi.core.lesson_status', passed ? 'passed' : 'failed'),
      this.api.LMSCommit(''),
    ];
    return ok.every((r) => r === 'true') ? 'sent' : 'refused';
  }

  /**
   * Sets session time and exit, then LMSFinish. Safe to call more than once.
   *
   * A module that is not yet passed (or completed) is left with
   * `cmi.core.exit` "suspend", so the LMS resumes the same attempt next time
   * and hands back `state` (answers in `cmi.suspend_data`, section in
   * `cmi.core.lesson_location`). A passed module exits normally ("") and
   * its saved state is cleared. When results are not recorded, the session
   * ends normally and saved state is left as it was.
   */
  finish(now: number, state?: ResumeState): void {
    if (!this.started || this.finished) return;
    this.finished = true;
    const status = this.api.LMSGetValue('cmi.core.lesson_status');
    const done = status === 'passed' || status === 'completed';
    this.api.LMSSetValue('cmi.core.session_time', formatCmiTimespan(now - this.startedAt));
    if (this.mode !== 'normal') {
      this.api.LMSSetValue('cmi.core.exit', '');
    } else if (done) {
      this.api.LMSSetValue('cmi.core.exit', '');
      this.api.LMSSetValue('cmi.suspend_data', '');
      this.api.LMSSetValue('cmi.core.lesson_location', '');
    } else {
      this.api.LMSSetValue('cmi.core.exit', 'suspend');
      this.api.LMSSetValue('cmi.suspend_data', state ? encodeSuspendData(state.answers) : '');
      this.api.LMSSetValue('cmi.core.lesson_location', state ? encodeLessonLocation(state.section) : '');
    }
    this.api.LMSCommit('');
    this.api.LMSFinish('');
  }
}
