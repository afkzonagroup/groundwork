// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// End-to-end check of the SCORM 1.2 package in a real ILIAS, to show the
// package and its runtime are not Moodle-specific.
//
// Starts a throwaway ILIAS (test/lms/ilias/compose.yml) in Docker, bound to
// 127.0.0.1, with random throwaway passwords. The administrator turns on
// learning progress, uploads the package as a "Learning Module SCORM", puts it
// online, sets its learning progress to "collection of SCORM items" and adds a
// learner, all through the web interface. The learner then takes the course
// in Chromium in ILIAS's SCORM 1.2 player window: passes, fails and retries,
// fails after a pass, closes the player window halfway through a module and
// resumes it, and finishes the rest; finally it checks a quiz in a copy with
// learning progress deactivated, where ILIAS gives no credit and nothing may
// be recorded as a result. After each step the script reads what
// ILIAS stored (scorm_tracking and the learning progress status) from its
// database and checks it. The containers and their volumes are removed at
// the end.
//
// Usage:
//   npm run build
//   node scripts/lms-ilias-check.mjs [--port 8090] [--out DIR] [--keep] [--remove-images]
//
// Needs Docker with Compose v2 and Playwright's Chromium.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { Checks, ROOT, answersRestored, buildPackage, composer, leaveHalfway, log, newContext, screenshot, seconds, takeQuiz, throwawayPassword, waitFor, warmUp } from './lms-common.mjs';

const ROLE = 'staff';
const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '8090' },
    out: { type: 'string', default: join(ROOT, '.lms-out/ilias') },
    keep: { type: 'boolean', default: false },
    'remove-images': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
  },
});
if (!/^[0-9]{2,5}$/.test(args.port)) throw new Error('--port must be a number');

const checks = new Checks();
const check = checks.check.bind(checks);
const secrets = {
  dbRoot: throwawayPassword(''),
  db: throwawayPassword(''),
  admin: throwawayPassword(),
  // ILIAS makes an account created by an administrator choose a new password at first login.
  learnerFirst: throwawayPassword(),
  learner: throwawayPassword(),
};
const wwwroot = `http://127.0.0.1:${args.port}`;
const docker = composer(join(ROOT, 'test/lms/ilias/compose.yml'), {
  GW_LMS_DB_ROOT_PASSWORD: secrets.dbRoot,
  GW_LMS_DB_PASSWORD: secrets.db,
  GW_LMS_ADMIN_PASSWORD: secrets.admin,
  GW_LMS_PORT: args.port,
  GW_LMS_WWWROOT: wwwroot,
});

/** Runs SQL in the database container; returns rows of tab-separated columns. @param {string} sql */
function sql(sql) {
  const out = docker.exec(['-e', `MYSQL_PWD=${secrets.db}`, 'db', 'mariadb', '-uilias', 'ilias', '-N', '-B', '-e', sql]);
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t').map((v) => (v === 'NULL' ? '' : v.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'))));
}

/** @param {string} value */
const int = (value) => {
  if (!/^[0-9]+$/.test(value)) throw new Error(`Not an id: ${value}`);
  return value;
};

/**
 * What ILIAS stored for the learner: cmi elements per SCO (by item identifier) and the learning progress.
 * @typedef {{ tracks: Record<string, Record<string, string>>, lp: { status: string, percentage: string } }} Report
 * @param {string} objId @param {string} userId @returns {Report}
 */
function report(objId, userId) {
  /** @type {Record<string, Record<string, string>>} */
  const tracks = {};
  for (const [item, element, value] of sql(`SELECT si.import_id, t.lvalue, t.rvalue FROM scorm_tracking t JOIN sc_item si ON si.obj_id = t.sco_id WHERE t.obj_id = ${int(objId)} AND t.user_id = ${int(userId)}`)) {
    if (item === undefined || element === undefined) continue;
    (tracks[item] ??= {})[element] = value ?? '';
  }
  const [lp] = sql(`SELECT status, percentage FROM ut_lp_marks WHERE obj_id = ${int(objId)} AND usr_id = ${int(userId)}`);
  return { tracks, lp: { status: lp?.[0] ?? '', percentage: lp?.[1] ?? '' } };
}

/** @param {Report} r @param {string} moduleId */
const track = (r, moduleId) => r.tracks[`ITEM-${moduleId}`] ?? {};

// ---------------------------------------------------------------- browser helpers

/** @param {import('playwright-core').Page} page @param {string} user @param {string} password */
async function login(page, user, password) {
  await page.goto(`${wwwroot}/login.php`);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(password);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login.php')), page.getByRole('button', { name: 'Login' }).click()]);
}

/** Launches the learning module; ILIAS opens its SCORM 1.2 player in a new window. @param {import('playwright-core').Page} page @param {string} refId */
async function launch(page, refId) {
  await page.goto(`${wwwroot}/goto.php?target=sahs_${refId}`);
  const name = 'Launch Learning Module';
  const [player] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('button', { name }).or(page.getByRole('link', { name })).first().click()]);
  await player.waitForLoadState('load');
  return player;
}

/** Opens a module from the player's table of contents and returns the frame showing it. @param {import('playwright-core').Page} player @param {{ id: string, title: string }} module */
async function openModule(player, module) {
  const content = () => player.frame({ name: 'sahs_content' });
  const showing = () => (content()?.url().split(/[?#]/)[0] ?? '').endsWith(`/${module.id}.html`);
  if (!showing()) await player.frame({ name: 'tree' })?.getByRole('link', { name: module.title }).click();
  const end = Date.now() + 30000;
  while (!showing()) {
    if (Date.now() > end) throw new Error(`Module ${module.id} did not open.`);
    await sleep(200);
  }
  const frame = content();
  if (!frame) throw new Error('No content frame.');
  await frame.waitForLoadState('load');
  await frame.locator('#gw-quiz').waitFor();
  return frame;
}

/**
 * Uploads the package as a new "Learning Module SCORM" (SCORM 1.2) in the repository root and puts it online.
 * @param {import('playwright-core').Page} admin
 * @param {string} zipPath
 */
async function addModule(admin, zipPath) {
  await admin.goto(`${wwwroot}/ilias.php?baseClass=ilrepositorygui&cmd=create&ref_id=1&new_type=sahs`);
  await admin.check('#sub_type_scorm');
  await admin.setInputFiles('#scormfile', zipPath);
  await Promise.all([admin.waitForURL(/ilsahseditgui/i), admin.click('input[name="cmd[upload]"]')]);
  const refId = int(new URL(admin.url()).searchParams.get('ref_id') ?? '');
  const objId = int(sql(`SELECT obj_id FROM object_reference WHERE ref_id = ${refId}`)[0]?.[0] ?? '');
  await admin.check('#cobj_online');
  await Promise.all([admin.waitForLoadState('load'), admin.locator('input[name="cmd[saveProperties]"]').first().click()]);
  return { refId, objId };
}

// ---------------------------------------------------------------- run

async function run() {
  const { zipPath, modules } = await buildPackage(args.out, ROLE);
  const [m1, m2, m3, ...rest] = modules;
  if (!m1 || !m2 || !m3) throw new Error('The course needs at least three modules for this check.');

  log('Starting ILIAS and MariaDB (the first start installs ILIAS)...');
  docker.run(['down', '-v', '--remove-orphans'], { quiet: true });
  docker.run(['up', '-d', '--wait', '--quiet-pull']);
  try {
    await waitFor(
      () => {
        try {
          return docker.run(['logs', 'web'], { quiet: true });
        } catch {
          return '';
        }
      },
      (logs) => /resuming normal operations|In [A-Za-z]+\.php line/.test(logs),
      600000,
    );
    const version = sql("SELECT value FROM settings WHERE module = 'common' AND keyword = 'ilias_version'")[0]?.[0] ?? 'unknown';
    await warmUp(`${wwwroot}/login.php`);
    log(`ILIAS ${version} is up at ${wwwroot}.`);
    await browserRun(zipPath, modules, { m1, m2, m3, rest });
  } finally {
    if (args.keep) {
      log(`Kept running (--keep). root password: ${secrets.admin}; learner password: ${secrets.learner}`);
    } else {
      log('Removing containers and volumes...');
      docker.run(['down', '-v', '--remove-orphans', ...(args['remove-images'] ? ['--rmi', 'all'] : [])], { quiet: true });
    }
  }
}

/**
 * @param {string} zipPath
 * @param {{ id: string, title: string }[]} modules
 * @param {{ m1: { id: string, title: string }, m2: { id: string, title: string }, m3: { id: string, title: string }, rest: { id: string, title: string }[] }} named
 */
async function browserRun(zipPath, modules, { m1, m2, m3, rest }) {
  const browser = await chromium.launch({ headless: !args.headed });
  /** @type {string[]} */
  const problems = [];
  try {
    const shot = (/** @type {import('playwright-core').Page} */ page, /** @type {string} */ name) => screenshot(page, join(args.out, `${name}.png`));

    // 1. The administrator sets up ILIAS and uploads the package.
    log('\n1. Administrator turns on learning progress, uploads the package and adds a learner');
    const admin = await (await newContext(browser)).newPage();
    await login(admin, 'root', secrets.admin);
    await admin.goto(`${wwwroot}/ilias.php?baseClass=ilAdministrationGUI&ref_id=${int(sql("SELECT r.ref_id FROM object_reference r JOIN object_data o ON o.obj_id = r.obj_id WHERE o.type = 'trac'")[0]?.[0] ?? '')}&cmd=jump`);
    await admin.check('#learning_progress_tracking');
    await Promise.all([admin.waitForLoadState('load'), admin.locator('input[name="cmd[saveSettings]"]').first().click()]);

    const { refId, objId } = await addModule(admin, zipPath);
    const items = sql(`SELECT si.import_id, so.title FROM scorm_object so JOIN sc_item si ON si.obj_id = so.obj_id WHERE so.slm_id = ${objId} ORDER BY so.obj_id`);
    check(sql(`SELECT c_type FROM sahs_lm WHERE id = ${objId}`)[0]?.[0] === 'scorm', 'ILIAS imported the package as a SCORM 1.2 learning module');
    check(items.length === modules.length && items.every(([id, title], i) => id === `ITEM-${modules[i]?.id ?? ''}` && title === modules[i]?.title), `${String(items.length)} items with the module titles, in course order`);

    await admin.getByRole('link', { name: 'Learning Progress' }).last().click();
    await admin.getByLabel('Status is Determined by a Collection of SCORM Items').check();
    await Promise.all([admin.waitForLoadState('load'), admin.getByRole('button', { name: 'Save' }).click()]);
    await admin.locator('input[type=checkbox][name^="chb_select_all"]').first().check();
    await admin.locator('select[name="selected_cmd"]').selectOption('assign');
    await Promise.all([admin.waitForLoadState('load'), admin.locator('input[name="select_cmd"]').click()]);
    await shot(admin, '01-learning-progress-settings');
    // Without this, ILIAS runs the module with cmi.core.credit "no-credit" and keeps no score or status.
    check(sql(`SELECT u_mode FROM ut_lp_settings WHERE obj_id = ${objId}`)[0]?.[0] === '6' && sql(`SELECT COUNT(*) FROM ut_lp_collections WHERE obj_id = ${objId} AND active = 1`)[0]?.[0] === String(modules.length), 'learning progress: collection of all SCORM items');

    await admin.goto(`${wwwroot}/ilias.php?baseClass=iladministrationgui&cmdClass=ilObjUserFolderGUI&cmd=addUser&ref_id=7`);
    await admin.fill('#username', 'learner');
    await admin.fill('#passwd', secrets.learnerFirst);
    await admin.fill('#passwd_retype', secrets.learnerFirst);
    await admin.fill('#firstname', 'Test');
    await admin.fill('#lastname', 'Learner');
    await admin.fill('#email', 'learner@example.invalid');
    await admin.check('#roles_4');
    await Promise.all([admin.waitForLoadState('load'), admin.locator('input[name="cmd[save]"]').first().click()]);
    const userId = int(sql("SELECT usr_id FROM usr_data WHERE login = 'learner'")[0]?.[0] ?? '');
    // A second copy with learning progress deactivated, for step 7.
    const plain = await addModule(admin, zipPath);
    await admin.getByRole('link', { name: 'Learning Progress' }).last().click();
    await admin.getByLabel('Learning Progress is Deactivated').check();
    await Promise.all([admin.waitForLoadState('load'), admin.getByRole('button', { name: 'Save' }).click()]);
    check(sql(`SELECT u_mode FROM ut_lp_settings WHERE obj_id = ${plain.objId}`)[0]?.[0] === '0', 'second copy: learning progress deactivated');
    await admin.close();

    // 2. The learner signs in, launches the module and passes module 1.
    log('\n2. Learner launches the learning module and passes module 1');
    const context = await newContext(browser);
    context.on('page', (p) => {
      p.on('pageerror', (e) => problems.push(`script error: ${e.message}`));
      p.on('response', (res) => {
        if (res.status() >= 400 && /\/lm_data\//.test(res.url())) problems.push(`HTTP ${String(res.status())} ${res.url()}`);
      });
    });
    const page = await context.newPage();
    await login(page, 'learner', secrets.learnerFirst);
    const passwords = page.locator('form input[type=password]');
    await passwords.nth(0).fill(secrets.learnerFirst);
    await passwords.nth(1).fill(secrets.learner);
    await Promise.all([page.waitForLoadState('load'), page.getByRole('button', { name: 'Save' }).first().click()]);

    let player = await launch(page, refId);
    let frame = await openModule(player, m1);
    let messages = await takeQuiz(frame);
    check(/sent to your learning platform/.test(messages.status), `module 1 page says: "${messages.status}"`);
    await shot(player, '02-module-1-passed');
    const read = () => report(objId, userId);
    let r = await waitFor(read, (x) => track(x, m1.id)['cmi.core.score.raw'] === '100');
    let t = track(r, m1.id);
    check(t['cmi.core.lesson_status'] === 'passed', `module 1 lesson_status = ${String(t['cmi.core.lesson_status'])}`);
    check(t['cmi.core.score.raw'] === '100' && t['cmi.core.score.min'] === '0' && t['cmi.core.score.max'] === '100', `module 1 score raw/min/max = ${String(t['cmi.core.score.raw'])}/${String(t['cmi.core.score.min'])}/${String(t['cmi.core.score.max'])}`);

    // 3. Fails module 2, then retries and passes.
    log('\n3. Learner fails module 2, then retries and passes');
    frame = await openModule(player, m2);
    r = await waitFor(read, (x) => seconds(track(x, m1.id)['cmi.core.total_time']) > 0);
    t = track(r, m1.id);
    check(seconds(t['cmi.core.total_time']) > 0 && (t['cmi.core.exit'] ?? '') === '', `module 1 after leaving it: total_time ${String(t['cmi.core.total_time'])}, exit "${t['cmi.core.exit'] ?? ''}"`);
    messages = await takeQuiz(frame, 2);
    r = await waitFor(read, (x) => track(x, m2.id)['cmi.core.lesson_status'] === 'failed');
    t = track(r, m2.id);
    check(t['cmi.core.lesson_status'] === 'failed' && Number(t['cmi.core.score.raw']) < 80, `module 2 recorded ${String(t['cmi.core.lesson_status'])} with score ${String(t['cmi.core.score.raw'])}`);
    await frame.locator('#gw-retry').click();
    await takeQuiz(frame);
    r = await waitFor(read, (x) => track(x, m2.id)['cmi.core.lesson_status'] === 'passed');
    t = track(r, m2.id);
    check(t['cmi.core.lesson_status'] === 'passed' && t['cmi.core.score.raw'] === '100', `module 2 after retry: ${String(t['cmi.core.lesson_status'])}, ${String(t['cmi.core.score.raw'])}`);

    // 4. A failed attempt after a pass keeps the pass.
    log('\n4. Learner fails module 1 again after passing it');
    frame = await openModule(player, m1);
    messages = await takeQuiz(frame, 2);
    check(/keeps that result/.test(messages.status), `module 1 page says: "${messages.status}"`);
    frame = await openModule(player, m3);
    r = read();
    t = track(r, m1.id);
    check(t['cmi.core.lesson_status'] === 'passed' && t['cmi.core.score.raw'] === '100', `module 1 still ${String(t['cmi.core.lesson_status'])} with ${String(t['cmi.core.score.raw'])}`);

    // 5. Closes the player window halfway through module 3, then resumes.
    log('\n5. Learner closes the player window halfway through module 3, then comes back');
    const { chosen, suspendData } = await leaveHalfway(frame);
    await sleep(1500);
    await shot(player, '03-module-3-halfway');
    await player.close({ runBeforeUnload: true });
    r = await waitFor(read, (x) => track(x, m3.id)['cmi.core.exit'] === 'suspend');
    t = track(r, m3.id);
    check(t['cmi.core.lesson_status'] === 'incomplete', `module 3 lesson_status = ${String(t['cmi.core.lesson_status'])}`);
    check(t['cmi.core.exit'] === 'suspend', `module 3 exit = ${String(t['cmi.core.exit'])}`);
    check(t['cmi.suspend_data'] === suspendData, `module 3 suspend_data = ${String(t['cmi.suspend_data'])}`);
    check(/^[0-9]+$/.test(t['cmi.core.lesson_location'] ?? ''), `module 3 lesson_location = ${String(t['cmi.core.lesson_location'])}`);
    check(seconds(t['cmi.core.total_time']) > 0, `module 3 total_time after closing the window = ${String(t['cmi.core.total_time'])}`);

    player = await launch(page, refId);
    frame = await openModule(player, m3);
    check(await answersRestored(frame, chosen), `module 3: the ${String(chosen.length)} chosen answers are selected again after relaunching`);
    const welcome = (await frame.locator('#gw-scorm-status').textContent()) ?? '';
    check(/Welcome back/.test(welcome), `module 3 page says: "${welcome}"`);
    await shot(player, '04-module-3-resumed');
    await takeQuiz(frame);

    // 6. Completes the remaining modules and closes the player.
    log('\n6. Learner completes the remaining modules and closes the player');
    for (const m of rest) await takeQuiz(await openModule(player, m));
    await shot(player, '05-last-module-passed');
    await player.close({ runBeforeUnload: true });
    r = await waitFor(read, (x) => modules.every((m) => track(x, m.id)['cmi.core.lesson_status'] === 'passed' && (track(x, m.id)['cmi.core.exit'] ?? '') === '') && x.lp.status === '2');
    for (const m of modules) {
      t = track(r, m.id);
      check(t['cmi.core.lesson_status'] === 'passed' && seconds(t['cmi.core.total_time']) > 0 && (t['cmi.suspend_data'] ?? '') === '', `${m.id}: ${String(t['cmi.core.lesson_status'])}, score ${String(t['cmi.core.score.raw'])}, total_time ${String(t['cmi.core.total_time'])}, exit "${t['cmi.core.exit'] ?? ''}"`);
    }
    check(r.lp.status === '2' && r.lp.percentage === '100', `learning progress status ${r.lp.status} (2 = completed), ${r.lp.percentage} %`);
    await page.goto(`${wwwroot}/goto.php?target=sahs_${refId}`);
    await shot(page, '06-learning-module');

    // 7. With learning progress deactivated ILIAS runs the module with cmi.core.credit "no-credit".
    log('\n7. Learner checks a quiz in a copy with learning progress deactivated');
    player = await launch(page, plain.refId);
    frame = await openModule(player, m1);
    const note = (await frame.locator('#gw-scorm-status').textContent()) ?? '';
    check(/does not record results/.test(note), `module 1 page says: "${note}"`);
    messages = await takeQuiz(frame, 3);
    check(/does not record results/.test(messages.status), `after checking: "${messages.status}"`);
    await shot(player, '07-no-credit');
    await player.close({ runBeforeUnload: true });
    const plainReport = await waitFor(
      () => report(plain.objId, userId),
      (x) => seconds(track(x, m1.id)['cmi.core.total_time']) > 0,
    );
    t = track(plainReport, m1.id);
    check(t['cmi.core.credit'] === 'no-credit' && t['cmi.core.score.raw'] === undefined, `copy without learning progress: credit ${String(t['cmi.core.credit'])}, score ${t['cmi.core.score.raw'] ?? 'none'}, status ${String(t['cmi.core.lesson_status'])} (set by ILIAS)`);
    check(problems.length === 0, `no script errors and no missing package files (${problems.join('; ') || 'none'})`);
    writeFileSync(join(args.out, 'ilias-report.json'), `${JSON.stringify(r, null, 2)}\n`);
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
log(checks.failures === 0 ? '\nILIAS SCORM 1.2 check passed.' : `\nILIAS SCORM 1.2 check FAILED (${String(checks.failures)}).`);
process.exitCode = checks.failures === 0 ? 0 : 1;
