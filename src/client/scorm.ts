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

/** One SCO session: initialize once, report results, finish once. */
export class ScormSession {
  private started = false;
  private finished = false;
  private readonly startedAt: number;

  constructor(
    private readonly api: Scorm12Api,
    now: number,
  ) {
    this.startedAt = now;
  }

  /** LMSInitialize; marks a new attempt as incomplete. Returns false if the LMS refused. */
  start(): boolean {
    if (this.started) return true;
    if (this.api.LMSInitialize('') !== 'true') return false;
    this.started = true;
    const status = this.api.LMSGetValue('cmi.core.lesson_status');
    if (status === '' || status === 'not attempted') {
      this.api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
      this.api.LMSCommit('');
    }
    return true;
  }

  /**
   * Records a quiz result: score from 0 to 100 and passed or failed.
   * Returns "sent" when the LMS accepted it, "kept" when an earlier pass is
   * kept, and "refused" otherwise.
   *
   * A passed status already in the LMS is not replaced by a later fail, and
   * neither is its score: the manifest sets `adlcp:masteryscore`, and an LMS
   * may derive the status from `cmi.core.score.raw` and the mastery score
   * (SCORM 1.2 run-time environment), so a lower score alone could turn the
   * earlier pass into a fail.
   */
  report(percent: number, passed: boolean): 'sent' | 'kept' | 'refused' {
    if (!this.started || this.finished) return 'refused';
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

  /** Sets session time and exit, then LMSFinish. Safe to call more than once. */
  finish(now: number): void {
    if (!this.started || this.finished) return;
    this.finished = true;
    this.api.LMSSetValue('cmi.core.session_time', formatCmiTimespan(now - this.startedAt));
    this.api.LMSSetValue('cmi.core.exit', '');
    this.api.LMSCommit('');
    this.api.LMSFinish('');
  }
}
