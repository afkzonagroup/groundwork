// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Shared helpers for the live LMS checks (scripts/lms-*-check.mjs): build the
// package, run Docker Compose, answer the quiz in a module page, and report
// results. Test tooling only; not part of the published package.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildScormPackage, bundledContentDir, loadCourseDir, validateScormPackage } from '../dist/index.js';

export const ROOT = join(import.meta.dirname, '..');

/** @param {string} message */
export function log(message) {
  process.stdout.write(`${message}\n`);
}

/** Counts failed checks; every check is printed as "ok" or "FAIL". */
export class Checks {
  failures = 0;

  /** @param {boolean} ok @param {string} what */
  check(ok, what) {
    log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) this.failures++;
  }

  /** @param {string} what */
  info(what) {
    log(`  info ${what}`);
  }
}

/** A throwaway password for a test account: letters, digits, "-" and "_", with a fixed prefix that meets LMS password rules. */
export function throwawayPassword(prefix = 'Gw1-') {
  return `${prefix}${randomBytes(12).toString('base64url')}`;
}

/** SCORM 1.2 CMITimespan (HHHH:MM:SS.SS) to seconds; -1 if missing or malformed. @param {string | undefined} value */
export function seconds(value) {
  const m = /^([0-9]{2,4}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,2})?$/.exec(value ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) : -1;
}

/**
 * Builds and validates the SCORM 1.2 package for one role and writes it to `outDir`.
 * @param {string} outDir
 * @param {string} role
 */
export async function buildPackage(outDir, role) {
  mkdirSync(outDir, { recursive: true });
  const { course, issues } = await loadCourseDir(bundledContentDir());
  if (!course) throw new Error(issues.map((i) => i.message).join('\n'));
  const zip = buildScormPackage(course, { role, organisation: 'Example Ltd', aiContact: 'the AI desk (ai@example.com)' });
  const problems = validateScormPackage(zip);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const zipPath = join(outDir, `groundwork-${role}-scorm12.zip`);
  writeFileSync(zipPath, zip);
  const modules = course.moduleList.map((m) => ({ id: m.id, title: m.title }));
  log(`Built ${zipPath} (${String(modules.length)} SCOs, ${String(zip.length)} bytes).`);
  return { zipPath, modules };
}

/**
 * Runs `docker compose` for one compose file with the given environment.
 * @param {string} file
 * @param {Record<string, string>} env
 */
export function composer(file, env) {
  /** @param {string[]} command @param {{ quiet?: boolean }} [options] */
  const run = (command, options = {}) =>
    execFileSync('docker', ['compose', '--progress', 'quiet', '-f', file, ...command], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
    });
  /**
   * Runs a command in a service container; on failure the error carries the last lines of output.
   * @param {string[]} argv
   */
  const exec = (argv) => {
    try {
      return run(['exec', '-T', ...argv], { quiet: true });
    } catch (error) {
      const out = /** @type {{ stdout?: string, stderr?: string }} */ (error);
      const tail = `${out.stdout ?? ''}${out.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
      throw new Error(`Command in container failed:\n${tail}`, { cause: error });
    }
  };
  return { run, exec };
}

/**
 * Polls `read` until `predicate` holds or the time is up, and returns the last value.
 * Results reach the LMS asynchronously when a window closes (sendBeacon), so checks wait.
 * @template T
 * @param {() => T} read
 * @param {(value: T) => boolean} predicate
 */
export async function waitFor(read, predicate, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let last = read();
  while (!predicate(last) && Date.now() < end) {
    await sleep(500);
    last = read();
  }
  return last;
}

/**
 * Requests `url` until the server answers with a status below 500, so that the first page a
 * browser opens does not pay for the LMS building its caches.
 * @param {string} url
 */
export async function warmUp(url, timeoutMs = 300000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
      await response.arrayBuffer();
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`${url} did not answer in time.`);
    await sleep(1000);
  }
}

/** Opens a browser context with the window size and generous time limits used by the checks. @param {import('playwright-core').Browser} browser */
export async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  context.setDefaultTimeout(60000);
  context.setDefaultNavigationTimeout(120000);
  return context;
}

/**
 * Saves a screenshot as evidence. A page that is still navigating cannot be captured, so this
 * waits for the page to settle and tries again; a screenshot that still fails is reported, not fatal.
 * @param {import('playwright-core').Page} page
 * @param {string} path
 */
export async function screenshot(page, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.waitForLoadState('load');
      await page.screenshot({ path });
      return;
    } catch (error) {
      if (attempt === 3) {
        log(`  info screenshot ${path} not saved: ${error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)}`);
        return;
      }
      await sleep(1000);
    }
  }
}

/**
 * @typedef {import('playwright-core').Frame | import('playwright-core').FrameLocator} Scope
 * @typedef {{ passMark: number, answers: { id: string, correct: number }[] }} AnswerKey
 */

/** The answer key embedded in an open module page. @param {Scope} scope @returns {Promise<AnswerKey>} */
export async function answerKey(scope) {
  return JSON.parse((await scope.locator('#gw-key').textContent()) ?? '');
}

/**
 * Answers the quiz on an open module page, the first `wrong` questions wrongly, and checks it.
 * Returns the page's result and LMS status messages.
 * @param {Scope} scope
 */
export async function takeQuiz(scope, wrong = 0) {
  const key = await answerKey(scope);
  for (const [i, a] of key.answers.entries()) {
    const options = await scope.locator(`input[name="q-${a.id}"]`).count();
    const choice = i < wrong ? (a.correct + 1) % options : a.correct;
    await scope.locator(`#q-${a.id}-${String(choice)}`).check();
  }
  await scope.locator('#gw-check').click();
  await scope.locator('#gw-scorm-status').filter({ hasText: /\S/ }).waitFor();
  return { result: (await scope.locator('#gw-result').textContent()) ?? '', status: (await scope.locator('#gw-scorm-status').textContent()) ?? '' };
}

/** Chooses the first two answers correctly without checking, and scrolls to the third section: a learner halfway through. @param {Scope} scope */
export async function leaveHalfway(scope) {
  const key = await answerKey(scope);
  const chosen = key.answers.slice(0, 2).map((a) => ({ id: a.id, choice: a.correct }));
  for (const c of chosen) await scope.locator(`#q-${c.id}-${String(c.choice)}`).check();
  const sections = await scope.locator('main section').count();
  await scope
    .locator('main section')
    .nth(Math.min(2, sections - 1))
    .evaluate((el) => {
      el.scrollIntoView();
    });
  return { chosen, suspendData: JSON.stringify({ v: 1, a: chosen.map((c) => [c.id, c.choice]) }) };
}

/** True if every answer chosen by {@link leaveHalfway} is selected again. @param {Scope} scope @param {{ id: string, choice: number }[]} chosen */
export async function answersRestored(scope, chosen) {
  const states = await Promise.all(chosen.map((c) => scope.locator(`#q-${c.id}-${String(c.choice)}`).isChecked()));
  return states.every(Boolean);
}
