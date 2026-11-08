// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// End-to-end check of the SCORM 1.2 package in a real Moodle.
//
// Starts a throwaway Moodle (test/lms/moodle/compose.yml) in Docker, bound to
// 127.0.0.1, with random throwaway passwords. An administrator uploads the
// package Groundwork builds through Moodle's web interface; a learner then
// takes the course in Chromium: passes, fails and retries, fails after a pass,
// leaves a module halfway by closing the window and resumes it, leaves another
// halfway inside the player and returns, finishes the rest, and finally checks
// a quiz in Preview mode, which must record nothing. After each step the script reads what Moodle recorded (lesson
// status, score, suspend data, location, exit, total time, grade, activity
// completion) through Moodle's own PHP API and checks it. The containers and
// their volumes are removed at the end.
//
// Usage:
//   npm run build
//   node scripts/lms-moodle-check.mjs [--port 8089] [--out DIR] [--keep] [--remove-images]
//
// Needs Docker with Compose v2 and Playwright's Chromium
// (`npx playwright-core install chromium`). The Moodle release archive is
// downloaded once into .lms-cache/ and checked against its SHA-256.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { Checks, ROOT, answerKey, answersRestored, buildPackage, composer, leaveHalfway, log, newContext, screenshot, seconds, takeQuiz, throwawayPassword, waitFor, warmUp } from './lms-common.mjs';

// Moodle 5.3, the long-term support release (5 October 2026), official release archive.
const MOODLE = {
  version: '5.3.0',
  url: 'https://packaging.moodle.org/stable503/moodle_MOODLE_503_STABLE_v5.3.0.tgz',
  sha256: '7e5edf110555956571f40e42acffde0eb23681ebebd212a2fec0fe7d795dd511',
};

const COMPOSE_DIR = join(ROOT, 'test/lms/moodle');
const COURSE_SHORTNAME = 'GW-AI';
const ROLE = 'staff';

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '8089' },
    out: { type: 'string', default: join(ROOT, '.lms-out/moodle') },
    cache: { type: 'string', default: join(ROOT, '.lms-cache') },
    keep: { type: 'boolean', default: false },
    'remove-images': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
  },
});
if (!/^[0-9]{2,5}$/.test(args.port)) throw new Error('--port must be a number');

const checks = new Checks();
const check = checks.check.bind(checks);

// ---------------------------------------------------------------- Moodle code

/** Downloads (once) and unpacks the Moodle release; returns the code directory. */
async function moodleCode() {
  const dir = join(args.cache, `moodle-${MOODLE.version}`);
  const code = join(dir, 'moodle');
  if (existsSync(join(code, 'public/version.php'))) return code;
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, 'moodle.tgz');
  if (!existsSync(archive)) {
    log(`Downloading Moodle ${MOODLE.version}...`);
    const response = await fetch(MOODLE.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Download failed: HTTP ${String(response.status)}`);
    writeFileSync(`${archive}.part`, Buffer.from(await response.arrayBuffer()));
    renameSync(`${archive}.part`, archive);
  }
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (digest !== MOODLE.sha256) {
    rmSync(archive);
    throw new Error(`Moodle archive SHA-256 mismatch: ${digest}`);
  }
  execFileSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
  return code;
}

// ---------------------------------------------------------------- Docker

const secrets = { db: throwawayPassword(''), admin: throwawayPassword(), learner: throwawayPassword() };
const wwwroot = `http://127.0.0.1:${args.port}`;

/** @type {ReturnType<typeof composer>} */
let docker;

/** Runs a PHP CLI script in the web container as the web server user. @param {string[]} argv */
const php = (argv) => docker.exec(['-u', 'www-data', 'web', 'php', ...argv]);

/**
 * @typedef {Record<string, string>} Track
 * @typedef {{ identifier: string, title: string, scormtype: string, launch: string }} Sco
 * @typedef {{ name: string, version: string, scoes: Sco[], attempts: { attempt: number, tracks: Record<string, Track | []> }[], grade: { grade: string | null } | null, completionstate: number }} Activity
 * @typedef {{ moodle: { release: string }, activities: Activity[] }} Report
 */

/** What Moodle recorded, read through its PHP API. @returns {Report} */
const report = () => JSON.parse(php(['/opt/groundwork/report.php', COURSE_SHORTNAME, 'learner']));

/** @param {(r: Report) => boolean} predicate */
const waitForReport = (predicate) => waitFor(report, predicate);

/** @param {Report} r @param {string} moduleId @returns {Track} */
function track(r, moduleId, activity = 0) {
  const attempts = r.activities[activity]?.attempts ?? [];
  const t = attempts[attempts.length - 1]?.tracks[`ITEM-${moduleId}`];
  return t && !Array.isArray(t) ? t : {};
}

// ---------------------------------------------------------------- browser helpers

/** @param {import('playwright-core').Page} page @param {string} user @param {string} password */
async function login(page, user, password) {
  await page.goto(`${wwwroot}/login/index.php`);
  await page.fill('#username', user);
  await page.fill('#password', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login/')), page.click('#loginbtn')]);
}

/** @param {import('playwright-core').Page} page */
const sco = (page) => page.frameLocator('#scorm_object');

/** Opens a module from the player's table of contents and waits for its quiz. */
async function openModule(/** @type {import('playwright-core').Page} */ page, /** @type {{ id: string, title: string }} */ module) {
  const isModule = (/** @type {import('playwright-core').Frame} */ f) => f !== page.mainFrame() && (f.url().split(/[?#]/)[0] ?? '').endsWith(`/${module.id}.html`);
  if (!page.frames().some(isModule)) await page.locator('#scorm_toc a', { hasText: module.title }).first().click();
  const end = Date.now() + 30000;
  let frame = page.frames().find(isModule);
  while (!frame) {
    if (Date.now() > end) throw new Error(`Module ${module.id} did not open.`);
    await sleep(200);
    frame = page.frames().find(isModule);
  }
  await frame.waitForLoadState('load');
  await sco(page).locator('#gw-quiz').waitFor();
}

/**
 * Adds a SCORM activity through Moodle's form, uploading the package with the file picker,
 * as an administrator does. Returns the course module id.
 */
async function addScorm(/** @type {import('playwright-core').Page} */ admin, /** @type {number} */ courseId, /** @type {string} */ name, /** @type {string} */ zipPath, completion = false) {
  await admin.goto(`${wwwroot}/course/modedit.php?add=scorm&course=${String(courseId)}&section=0&return=0`);
  await admin.fill('#id_name', name);
  await admin.locator('#fitem_id_packagefile .fp-btn-add').click();
  const picker = admin.locator('.moodle-dialogue-base:not([aria-hidden="true"]) .file-picker');
  await picker.locator('.fp-repo-area .fp-repo a', { hasText: 'Upload a file' }).click();
  await picker.locator('input[type="file"][name="repo_upload_file"]').setInputFiles(zipPath);
  await picker.locator('.fp-upload-btn').click();
  await admin.locator('#fitem_id_packagefile .fp-filename', { hasText: 'scorm12.zip' }).first().waitFor({ state: 'attached' });
  if (completion) {
    await admin.locator('a.collapseexpand').first().click();
    // Average of the module scores; complete when every module reports "passed".
    await admin.selectOption('#id_grademethod', '2');
    await admin.check('#id_completion_2');
    await admin.check('#id_completionstatusrequired_2');
    await admin.uncheck('#id_completionstatusrequired_4');
    await admin.check('#id_completionstatusallscos');
  }
  await Promise.all([admin.waitForURL(/\/mod\/scorm\/view\.php/), admin.click('#id_submitbutton')]);
  return Number(new URL(admin.url()).searchParams.get('id'));
}

/** Enters the activity as the learner in normal mode. */
async function enterActivity(/** @type {import('playwright-core').Page} */ page, /** @type {number} */ cmid, preview = false) {
  await page.goto(`${wwwroot}/mod/scorm/view.php?id=${String(cmid)}`);
  await Promise.all([page.waitForURL(/\/mod\/scorm\/player\.php/), page.click(preview ? '#b' : '#n')]);
  await page.locator('#scorm_object').waitFor();
}

// ---------------------------------------------------------------- run

async function run() {
  const { zipPath, modules } = await buildPackage(args.out, ROLE);
  const code = await moodleCode();
  copyFileSync(join(COMPOSE_DIR, 'config.php'), join(code, 'config.php'));
  docker = composer(join(COMPOSE_DIR, 'compose.yml'), {
    GW_LMS_DB_PASSWORD: secrets.db,
    GW_LMS_PORT: args.port,
    GW_LMS_WWWROOT: wwwroot,
    GW_LMS_MOODLE_DIR: code,
  });

  log('Starting Moodle and PostgreSQL...');
  // Start from nothing: remove what an interrupted earlier run may have left.
  docker.run(['down', '-v', '--remove-orphans'], { quiet: true });
  docker.run(['up', '-d', '--wait', '--quiet-pull']);
  try {
    log('Installing Moodle...');
    php(['/var/www/html/admin/cli/install_database.php', '--agree-license', '--adminuser=admin', `--adminpass=${secrets.admin}`, '--adminemail=admin@example.invalid', '--fullname=Groundwork LMS check', '--shortname=gwcheck']);
    const courseId = JSON.parse(php(['/opt/groundwork/setup.php', secrets.learner])).courseid;
    await warmUp(`${wwwroot}/login/index.php`);
    log(`Moodle ${report().moodle.release} is up at ${wwwroot}.`);
    await browserRun(courseId, zipPath, modules);
  } finally {
    if (args.keep) {
      log(`Kept running (--keep). Admin password: ${secrets.admin}; learner password: ${secrets.learner}`);
    } else {
      log('Removing containers and volumes...');
      docker.run(['down', '-v', '--remove-orphans', ...(args['remove-images'] ? ['--rmi', 'all'] : [])], { quiet: true });
    }
  }
}

/**
 * @param {number} courseId
 * @param {string} zipPath
 * @param {{ id: string, title: string }[]} modules
 */
async function browserRun(courseId, zipPath, modules) {
  const [m1, m2, m3, m4, m5, ...rest] = modules;
  if (!m1 || !m2 || !m3 || !m4 || !m5) throw new Error('The course needs at least five modules for this check.');
  const browser = await chromium.launch({ headless: !args.headed });
  /** @type {string[]} */
  const pageErrors = [];
  try {
    const shot = (/** @type {import('playwright-core').Page} */ page, /** @type {string} */ name) => screenshot(page, join(args.out, `${name}.png`));

    // 1. The administrator uploads the package through the web interface.
    log('\n1. Administrator uploads the SCORM package');
    const admin = await (await newContext(browser)).newPage();
    await login(admin, 'admin', secrets.admin);
    const cmid = await addScorm(admin, courseId, 'Groundwork AI literacy (all staff)', zipPath, true);
    await shot(admin, '01-activity-added');
    const parsed = report().activities[0];
    check(parsed?.version === 'SCORM_1.2', `Moodle accepted the package as ${parsed?.version ?? 'nothing'}`);
    const scos = parsed?.scoes.filter((s) => s.scormtype === 'sco') ?? [];
    check(scos.length === modules.length && scos.every((s, i) => s.launch === `${modules[i]?.id ?? ''}.html` && s.title === modules[i]?.title), `${String(scos.length)} SCOs with the module titles and launch pages, in course order`);

    // 2. The learner passes the first module.
    log('\n2. Learner passes module 1');
    // The learner's own browser profile; closing a window keeps the Moodle session, as in a real browser.
    const context = await newContext(browser);
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await login(page, 'learner', secrets.learner);
    await enterActivity(page, cmid);
    await openModule(page, m1);
    let messages = await takeQuiz(sco(page));
    check(/sent to your learning platform/.test(messages.status), `module 1 page says: "${messages.status}"`);
    await shot(page, '02-module-1-passed');
    let r = await waitForReport((x) => track(x, m1.id)['cmi.core.lesson_status'] === 'passed');
    let t = track(r, m1.id);
    check(t['cmi.core.lesson_status'] === 'passed', `module 1 lesson_status = ${String(t['cmi.core.lesson_status'])}`);
    check(t['cmi.core.score.raw'] === '100' && t['cmi.core.score.min'] === '0' && t['cmi.core.score.max'] === '100', `module 1 score raw/min/max = ${String(t['cmi.core.score.raw'])}/${String(t['cmi.core.score.min'])}/${String(t['cmi.core.score.max'])}`);

    // 3. Fails module 2, then retries and passes.
    log('\n3. Learner fails module 2, then retries and passes');
    await openModule(page, m2);
    r = await waitForReport((x) => seconds(track(x, m1.id)['cmi.core.total_time']) > 0);
    t = track(r, m1.id);
    check(seconds(t['cmi.core.total_time']) > 0, `module 1 total_time after leaving it = ${String(t['cmi.core.total_time'])} (session_time added by Moodle)`);
    check(t['cmi.core.exit'] === undefined || t['cmi.core.exit'] === '', `module 1 exit is normal ("${t['cmi.core.exit'] ?? ''}")`);
    messages = await takeQuiz(sco(page), 2);
    check(/not passed yet/.test(messages.result) && /sent/.test(messages.status), `module 2 failed attempt: "${messages.result}"`);
    r = await waitForReport((x) => track(x, m2.id)['cmi.core.lesson_status'] === 'failed');
    t = track(r, m2.id);
    const failedScore = Number(t['cmi.core.score.raw']);
    check(t['cmi.core.lesson_status'] === 'failed' && failedScore < 80, `module 2 recorded failed with score ${String(t['cmi.core.score.raw'])}`);
    await sco(page).locator('#gw-retry').click();
    await takeQuiz(sco(page));
    r = await waitForReport((x) => track(x, m2.id)['cmi.core.lesson_status'] === 'passed');
    t = track(r, m2.id);
    check(t['cmi.core.lesson_status'] === 'passed' && t['cmi.core.score.raw'] === '100', `module 2 after retry: ${String(t['cmi.core.lesson_status'])}, ${String(t['cmi.core.score.raw'])}`);

    // 4. A failed attempt after a pass keeps the pass.
    log('\n4. Learner fails module 1 again after passing it');
    const m1Time = seconds(track(report(), m1.id)['cmi.core.total_time']);
    await openModule(page, m1);
    messages = await takeQuiz(sco(page), 2);
    check(/keeps that result/.test(messages.status), `module 1 page says: "${messages.status}"`);
    await openModule(page, m3);
    r = await waitForReport((x) => seconds(track(x, m1.id)['cmi.core.total_time']) !== m1Time);
    t = track(r, m1.id);
    // Moodle adds each session to the total time its player loaded when it opened, so a second visit to a
    // module in the same player visit replaces the total instead of adding to it (Moodle behaviour, noted in docs/lms.md).
    checks.info(`module 1 total_time after a second session in the same player visit: ${String(t['cmi.core.total_time'])} (was ${String(m1Time)} s)`);
    check(t['cmi.core.lesson_status'] === 'passed' && t['cmi.core.score.raw'] === '100', `module 1 still ${String(t['cmi.core.lesson_status'])} with ${String(t['cmi.core.score.raw'])} (mastery score override did not turn it into a fail)`);

    // 5. Leaves module 3 halfway by closing the window, then resumes.
    log('\n5. Learner closes the window halfway through module 3, then comes back');
    const { chosen, suspendData: expectedSuspend } = await leaveHalfway(sco(page));
    await sleep(1500);
    await shot(page, '03-module-3-halfway');
    const t3Before = seconds(track(report(), m3.id)['cmi.core.total_time']);
    await page.close({ runBeforeUnload: true });
    r = await waitForReport((x) => track(x, m3.id)['cmi.core.exit'] === 'suspend');
    t = track(r, m3.id);
    check(t['cmi.core.lesson_status'] === 'incomplete', `module 3 lesson_status = ${String(t['cmi.core.lesson_status'])}`);
    check(t['cmi.core.exit'] === 'suspend', `module 3 exit = ${String(t['cmi.core.exit'])}`);
    check(t['cmi.suspend_data'] === expectedSuspend, `module 3 suspend_data = ${String(t['cmi.suspend_data'])}`);
    const location = t['cmi.core.lesson_location'] ?? '';
    check(/^[0-9]+$/.test(location), `module 3 lesson_location = ${location}`);
    check(seconds(t['cmi.core.total_time']) > Math.max(0, t3Before), `module 3 total_time after closing the window = ${String(t['cmi.core.total_time'])}`);

    const back = await context.newPage();
    back.on('pageerror', (e) => pageErrors.push(e.message));
    await enterActivity(back, cmid);
    await openModule(back, m3);
    check(await answersRestored(sco(back), chosen), `module 3: the ${String(chosen.length)} chosen answers are selected again after reopening`);
    const welcome = (await sco(back).locator('#gw-scorm-status').textContent()) ?? '';
    check(/Welcome back/.test(welcome), `module 3 page says: "${welcome}"`);
    const scrolled = await sco(back).locator('main').evaluate((main) => main.ownerDocument.defaultView?.scrollY ?? 0);
    checks.info(`reading position restored to section ${location} (frame scrolled ${String(Math.round(scrolled))} px)`);
    await shot(back, '04-module-3-resumed');
    await takeQuiz(sco(back));
    r = await waitForReport((x) => track(x, m3.id)['cmi.core.lesson_status'] === 'passed');
    t = track(r, m3.id);
    check(t['cmi.core.lesson_status'] === 'passed', `module 3 after resuming: ${String(t['cmi.core.lesson_status'])}`);

    // 6. Leaves module 4 halfway for module 5 and returns to it in the same player visit.
    log('\n6. Learner leaves module 4 halfway for module 5 and returns in the same player visit');
    await openModule(back, m4);
    const first = (await answerKey(sco(back))).answers[0];
    if (!first) throw new Error('Module 4 has no questions.');
    await sco(back).locator(`#q-${first.id}-${String(first.correct)}`).check();
    await openModule(back, m5);
    r = await waitForReport((x) => track(x, m4.id)['cmi.core.exit'] === 'suspend');
    t = track(r, m4.id);
    check(t['cmi.core.exit'] === 'suspend' && t['cmi.suspend_data'] === JSON.stringify({ v: 1, a: [[first.id, first.correct]] }), `module 4 suspended with ${String(t['cmi.suspend_data'])}`);
    await openModule(back, m4);
    check(await sco(back).locator(`#q-${first.id}-${String(first.correct)}`).isChecked(), 'module 4 answer restored on return within the same player visit');
    await takeQuiz(sco(back));
    await openModule(back, m5);
    await takeQuiz(sco(back));

    // 7. Completes the remaining modules and exits the activity.
    log('\n7. Learner completes the remaining modules and exits the activity');
    for (const m of rest) {
      await openModule(back, m);
      await takeQuiz(sco(back));
    }
    await shot(back, '05-last-module-passed');
    await Promise.all([back.waitForURL(/\/course\/view\.php|\/mod\/scorm\/view\.php/), back.locator('a, button', { hasText: 'Exit activity' }).first().click()]);
    r = await waitForReport((x) => modules.every((m) => track(x, m.id)['cmi.core.lesson_status'] === 'passed' && track(x, m.id)['cmi.core.exit'] === '') && (x.activities[0]?.completionstate ?? 0) > 0);
    for (const m of modules) {
      t = track(r, m.id);
      check(t['cmi.core.lesson_status'] === 'passed' && seconds(t['cmi.core.total_time']) > 0 && (t['cmi.suspend_data'] ?? '') === '', `${m.id}: ${String(t['cmi.core.lesson_status'])}, score ${String(t['cmi.core.score.raw'])}, total_time ${String(t['cmi.core.total_time'])}, exit "${t['cmi.core.exit'] ?? ''}"`);
    }
    const activity = r.activities[0];
    check(activity?.attempts.length === 1, `one attempt (${String(activity?.attempts.length)})`);
    check(Number(activity?.grade?.grade) === 100, `gradebook grade = ${String(activity?.grade?.grade)} (average of module scores)`);
    check(activity?.completionstate === 1, `activity completion state = ${String(activity?.completionstate)} (1 = complete)`);
    await back.goto(`${wwwroot}/mod/scorm/view.php?id=${String(cmid)}`);
    await shot(back, '06-activity-complete');

    // 8. Preview mode records nothing.
    log('\n8. Learner checks a quiz in Preview mode of a second copy of the activity');
    const previewCmid = await addScorm(admin, courseId, 'Groundwork preview check', zipPath);
    await enterActivity(back, previewCmid, true);
    await openModule(back, m1);
    const previewNote = (await sco(back).locator('#gw-scorm-status').textContent()) ?? '';
    check(/preview/i.test(previewNote), `module 1 page in Preview says: "${previewNote}"`);
    messages = await takeQuiz(sco(back), 3);
    check(/will not be recorded/.test(messages.status), `after checking in Preview: "${messages.status}"`);
    await shot(back, '07-preview-not-recorded');
    await Promise.all([back.waitForURL(/\/course\/view\.php|\/mod\/scorm\/view\.php/), back.locator('a, button', { hasText: 'Exit activity' }).first().click()]);
    const previewIndex = 1;
    r = await waitForReport((x) => seconds(track(x, m1.id, previewIndex)['cmi.core.total_time']) > 0);
    t = track(r, m1.id, previewIndex);
    const previewActivity = r.activities[previewIndex];
    check(previewActivity?.name === 'Groundwork preview check', `report for ${String(previewActivity?.name)}`);
    check(t['cmi.core.score.raw'] === undefined && t['cmi.core.lesson_status'] === 'browsed', `Preview recorded lesson_status ${String(t['cmi.core.lesson_status'])}, score ${t['cmi.core.score.raw'] ?? 'none'}`);
    check((previewActivity?.grade?.grade ?? null) === null, `Preview left no grade (${String(previewActivity?.grade?.grade)})`);
    check(pageErrors.length === 0, `no script errors in the pages (${pageErrors.join('; ') || 'none'})`);
    writeFileSync(join(args.out, 'moodle-report.json'), `${JSON.stringify(r, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

try {
  await run();
} catch (error) {
  checks.failures++;
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
}
log(checks.failures === 0 ? '\nMoodle SCORM 1.2 check passed.' : `\nMoodle SCORM 1.2 check FAILED (${String(checks.failures)}).`);
process.exitCode = checks.failures === 0 ? 0 : 1;
