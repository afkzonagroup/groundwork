// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The `groundwork` command. `run` takes the arguments and an I/O object, so
 * it is tested without a child process.
 *
 * @packageDocumentation
 */

import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Course } from '../content/course.js';
import { bundledContentDir, loadCourseDir } from '../content/load.js';
import { type ContentIssue, ID_PATTERN } from '../content/module.js';
import { RecordsError, rewriteChain } from '../records/chain.js';
import { CsvError } from '../records/csv.js';
import { recordsToCsv, recordsToJson } from '../records/export.js';
import { type RecordInput, RESULTS, type Result, parseScore, validateRecordInput } from '../records/fields.js';
import { ImportError, MAPPABLE_FIELDS, type MappableField, importCsv } from '../records/import-csv.js';
import { addRecords, initRecordsFile, readRecordsFile } from '../records/store.js';
import { buildScormPackage } from '../scorm/manifest.js';
import { validateScormPackage } from '../scorm/validate.js';
import { BuildError, buildSite } from '../site/build.js';
import { FileError, ensureDirectory, readFileLimited, writeFileSafe } from '../util/fs.js';
import { isIsoDate } from '../util/text.js';
import { ATTRIBUTION, PROJECT_URL, VERSION } from '../version.js';
import { XapiError, fromStatements, toStatements } from '../xapi/xapi.js';
import { type ParsedArgs, UsageError, parseArgs, required } from './args.js';

/** I/O used by the command. */
export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
}

/** Environment variable holding the HMAC key for records. */
export const KEY_ENV = 'GROUNDWORK_RECORD_KEY';

/** Maximum size of an import file. */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
/** Maximum size of a SCORM package to check. */
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;

const HELP = `groundwork ${VERSION} - open AI literacy course and training records

Usage:
  groundwork lint [--content DIR]
  groundwork build --out DIR [--content DIR] [--role ROLE]... [--organisation NAME]
                   [--ai-contact TEXT] [--force]
  groundwork scorm --out FILE.zip [--content DIR] [--role ROLE] [--organisation NAME]
                   [--ai-contact TEXT] [--force]
  groundwork check-scorm FILE.zip
  groundwork record init --file FILE [--hmac]
  groundwork record add --file FILE --person ID --role ROLE --activity ID
                        --result passed|failed|completed|attended [--date YYYY-MM-DD] [--score N]
  groundwork record verify --file FILE [--expect-head HASH] [--require-hmac]
  groundwork record export --file FILE --format csv|json|xapi --out FILE|- [--force]
                        [--account-home-page URL] [--activity-base IRI] [--content DIR]
  groundwork record import --file FILE --format csv|xapi --input FILE [--role ROLE]
                        [--column FIELD=HEADER]... [--delimiter comma|semicolon|tab]
                        [--account-home-page URL] [--activity-base IRI] [--allow-email]
                        [--content DIR]
  groundwork record erase --file FILE --out NEWFILE (--person ID | --before YYYY-MM-DD) [--force]
  groundwork --help | --version

Records use HMAC when created with --hmac; the key is read from the
environment variable ${KEY_ENV} (at least 32 characters) and never printed.

Exit codes: 0 success, 1 check failed, 2 usage or file error.

${ATTRIBUTION.text} <${ATTRIBUTION.url}>
Licence: AGPL-3.0-only (software), CC BY 4.0 (course content). Source: ${PROJECT_URL}
General information, not legal advice.
`;

const CONTENT_OPTIONS = { content: 'string' } as const;

/**
 * Escapes control, format and separator characters, except line feed, tab
 * and the carriage return of a CRLF line ending, so that nothing printed can
 * move the cursor, change colours or reorder text in a terminal.
 */
export function sanitizeOutput(text: string): string {
  return text.replace(/\r(?!\n)|[^\n\t\r\P{Cc}]|[\p{Cf}\p{Zl}\p{Zp}]/gu, (ch) => `\\u{${(ch.codePointAt(0) ?? 0).toString(16)}}`);
}

function keyFrom(io: CliIo): string | undefined {
  const key = io.env[KEY_ENV];
  return key === undefined || key === '' ? undefined : key;
}

function formatIssues(issues: readonly ContentIssue[]): string {
  return issues.map((i) => `${i.severity} ${i.file}:${String(i.line)} ${i.message}\n`).join('');
}

async function loadCourse(args: ParsedArgs, io: CliIo): Promise<Course> {
  const dir = args.strings.get('content') ?? bundledContentDir();
  const { course, issues } = await loadCourseDir(dir);
  if (issues.length > 0) io.stderr(formatIssues(issues));
  if (!course) throw new CheckFailed('The course content has errors; nothing was built.');
  return course;
}

class CheckFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckFailed';
  }
}

/** Resolves `relative` under `base` and refuses any result outside it. */
export function insideDir(base: string, relative: string): string {
  const root = resolve(base);
  const target = resolve(root, relative);
  if (!target.startsWith(root + sep)) throw new UsageError('Refusing to write outside the output directory.');
  return target;
}

async function writeOutput(path: string, content: string | Uint8Array, force: boolean, mode: number, io: CliIo): Promise<void> {
  if (path === '-') {
    io.stdout(typeof content === 'string' ? content : new TextDecoder().decode(content));
    return;
  }
  await writeFileSafe(path, content, { force, mode });
}

async function cmdLint(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, CONTENT_OPTIONS);
  const { course, issues } = await loadCourseDir(args.strings.get('content') ?? bundledContentDir());
  io.stdout(formatIssues(issues));
  if (!course) {
    io.stderr('Content lint failed.\n');
    return 1;
  }
  const questions = course.moduleList.reduce((n, m) => n + m.questions.length, 0);
  io.stdout(`Content OK: ${String(course.moduleList.length)} modules, ${String(questions)} questions, ${String(course.roles.length)} roles.\n`);
  return 0;
}

async function cmdBuild(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { ...CONTENT_OPTIONS, out: 'string', role: 'multi', organisation: 'string', 'ai-contact': 'string', force: 'boolean' });
  const out = required(args, 'out');
  const course = await loadCourse(args, io);
  const files = buildSite(course, {
    ...(args.multi.has('role') ? { roles: args.multi.get('role') ?? [] } : {}),
    ...optionalPlaceholders(args),
  });
  await ensureDirectory(out);
  for (const f of files) {
    const target = insideDir(out, f.path);
    const slash = f.path.lastIndexOf('/');
    if (slash > 0) await ensureDirectory(insideDir(out, f.path.slice(0, slash)));
    await writeFileSafe(target, f.content, { force: args.flags.has('force'), mode: 0o644 });
  }
  io.stdout(`Wrote ${String(files.length)} pages to ${out}. Open ${join(out, 'index.html')} in a browser.\n`);
  return 0;
}

function optionalPlaceholders(args: ParsedArgs): { organisation?: string; aiContact?: string } {
  const organisation = args.strings.get('organisation');
  const aiContact = args.strings.get('ai-contact');
  return { ...(organisation !== undefined ? { organisation } : {}), ...(aiContact !== undefined ? { aiContact } : {}) };
}

async function cmdScorm(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { ...CONTENT_OPTIONS, out: 'string', role: 'string', organisation: 'string', 'ai-contact': 'string', force: 'boolean' });
  const out = required(args, 'out');
  if (out === '-') throw new UsageError('Give a file name for the package.');
  const course = await loadCourse(args, io);
  const role = args.strings.get('role');
  const zip = buildScormPackage(course, { ...(role !== undefined ? { role } : {}), ...optionalPlaceholders(args) });
  const problems = validateScormPackage(zip);
  if (problems.length > 0) throw new CheckFailed(`The generated package failed its own check: ${problems.join(' ')}`);
  await writeFileSafe(out, zip, { force: args.flags.has('force'), mode: 0o644 });
  io.stdout(`Wrote SCORM 1.2 package ${out} (${String(course.moduleList.length)} SCOs, ${String(zip.length)} bytes).\n`);
  return 0;
}

async function cmdCheckScorm(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, {}, 1);
  const file = args.positional[0];
  if (file === undefined) throw new UsageError('Give the package file to check.');
  const problems = validateScormPackage(await readFileLimited(file, MAX_PACKAGE_BYTES));
  if (problems.length > 0) {
    io.stdout(problems.map((p) => `problem: ${p}\n`).join(''));
    return 1;
  }
  io.stdout('The package passed the SCORM 1.2 structure checks.\n');
  return 0;
}

async function recordInit(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { file: 'string', hmac: 'boolean' });
  const file = required(args, 'file');
  const key = keyFrom(io);
  if (args.flags.has('hmac') && key === undefined) throw new UsageError(`--hmac needs the key in ${KEY_ENV}.`);
  if (!args.flags.has('hmac') && key !== undefined) throw new UsageError(`${KEY_ENV} is set; add --hmac to use it, or unset it.`);
  const head = await initRecordsFile(file, args.flags.has('hmac') ? key : undefined, io.now());
  io.stdout(`Created ${file}${args.flags.has('hmac') ? ' with HMAC' : ''}. Head: ${head}\n`);
  return 0;
}

/** Today's date in the local time zone, YYYY-MM-DD. */
function today(io: CliIo): string {
  const d = io.now();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function recordAdd(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { file: 'string', person: 'string', role: 'string', activity: 'string', date: 'string', result: 'string', score: 'string' });
  const file = required(args, 'file');
  const result = required(args, 'result');
  if (!(RESULTS as readonly string[]).includes(result)) throw new UsageError(`--result must be one of: ${RESULTS.join(', ')}.`);
  const score = parseScore(args.strings.get('score') ?? '');
  if (score === undefined) throw new UsageError('--score must be a number from 0 to 100.');
  const input: RecordInput = {
    person: required(args, 'person'),
    role: required(args, 'role'),
    activity: required(args, 'activity'),
    date: args.strings.get('date') ?? today(io),
    result: result as Result,
    score,
    source: 'manual',
  };
  const problems = validateRecordInput(input, io.now());
  if (problems.length > 0) throw new UsageError(problems.join(' '));
  const added = await addRecords(file, [input], keyFrom(io), io.now());
  io.stdout(added.added === 1 ? `Added 1 record. Head: ${added.head}\n` : `An identical record already exists; nothing was added. Head: ${added.head}\n`);
  return 0;
}

async function recordVerify(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { file: 'string', 'expect-head': 'string', 'require-hmac': 'boolean' });
  const file = required(args, 'file');
  const expectHead = args.strings.get('expect-head');
  if (expectHead !== undefined && !/^[0-9a-f]{64}$/.test(expectHead)) throw new UsageError('--expect-head must be a 64-character hex hash.');
  const result = await readRecordsFile(file, {
    key: keyFrom(io),
    requireHmac: args.flags.has('require-hmac'),
    now: io.now(),
    ...(expectHead !== undefined ? { expectHead } : {}),
  });
  if (!result.ok) {
    io.stdout(result.problems.map((p) => `problem: line ${String(p.line)}: ${p.message}\n`).join(''));
    io.stdout('Verification FAILED.\n');
    return 1;
  }
  const mode = result.header?.hmac ? (keyFrom(io) !== undefined ? 'hashes and HMAC verified' : 'hashes verified; HMAC not checked (no key given)') : 'hashes verified (no HMAC)';
  io.stdout(`OK: ${String(result.records.length)} records, ${mode}.\nChain: ${result.header?.chain ?? ''}\nHead: ${result.head ?? ''}\n`);
  if (result.header?.previous) {
    const p = result.header.previous;
    io.stdout(`Rewritten from chain ${p.chain} (head ${p.head}) for ${p.reason}; ${String(p.removed)} records removed.\n`);
  }
  return 0;
}

async function verifiedOrFail(file: string, io: CliIo) {
  const result = await readRecordsFile(file, { key: keyFrom(io), now: io.now() });
  if (!result.ok) {
    const first = result.problems[0];
    throw new CheckFailed(`The records file does not verify${first ? ` (line ${String(first.line)}: ${first.message})` : ''}. Run "groundwork record verify".`);
  }
  return result;
}

async function recordExport(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { ...CONTENT_OPTIONS, file: 'string', format: 'string', out: 'string', force: 'boolean', 'account-home-page': 'string', 'activity-base': 'string' });
  const file = required(args, 'file');
  const format = required(args, 'format');
  const out = required(args, 'out');
  if (format !== 'csv' && format !== 'json' && format !== 'xapi') throw new UsageError('--format must be csv, json or xapi.');
  const verified = await verifiedOrFail(file, io);
  if (verified.header?.hmac && keyFrom(io) === undefined) io.stderr(`Note: HMAC not checked because ${KEY_ENV} is not set; only the hashes were verified.\n`);
  let content: string;
  if (format === 'csv') content = recordsToCsv(verified.records);
  else if (format === 'json') content = recordsToJson(verified);
  else {
    const course = await loadCourse(args, io);
    const base = args.strings.get('activity-base');
    const statements = toStatements(verified.records, course, { accountHomePage: required(args, 'account-home-page'), ...(base !== undefined ? { activityBase: base } : {}) });
    content = `${JSON.stringify(statements, null, 2)}\n`;
  }
  await writeOutput(out, content, args.flags.has('force'), 0o600, io);
  if (out !== '-') io.stdout(`Exported ${String(verified.records.length)} records to ${out}.\n`);
  return 0;
}

const DELIMITERS: Readonly<Record<string, ',' | ';' | '\t'>> = { comma: ',', semicolon: ';', tab: '\t' };

async function recordImport(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, {
    ...CONTENT_OPTIONS,
    file: 'string',
    format: 'string',
    input: 'string',
    role: 'string',
    column: 'multi',
    delimiter: 'string',
    'account-home-page': 'string',
    'activity-base': 'string',
    'allow-email': 'boolean',
  });
  const file = required(args, 'file');
  const format = required(args, 'format');
  const inputPath = required(args, 'input');
  const role = args.strings.get('role');
  if (role !== undefined && (!ID_PATTERN.test(role) || role.length > 32)) throw new UsageError('--role must be a lower-case id such as "staff".');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await readFileLimited(inputPath, MAX_IMPORT_BYTES));
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new UsageError('The input file is not valid UTF-8.');
  }
  let inputs: RecordInput[];
  let skippedText: string;
  if (format === 'csv') {
    const columns: Partial<Record<MappableField, string>> = {};
    for (const spec of args.multi.get('column') ?? []) {
      const eq = spec.indexOf('=');
      const field = spec.slice(0, eq);
      if (eq <= 0 || !(MAPPABLE_FIELDS as readonly string[]).includes(field)) throw new UsageError(`--column must look like FIELD=HEADER with FIELD one of ${MAPPABLE_FIELDS.join(', ')}.`);
      if (columns[field as MappableField] !== undefined) throw new UsageError(`Column for ${field} given twice.`);
      columns[field as MappableField] = spec.slice(eq + 1);
    }
    const delimiterName = args.strings.get('delimiter') ?? 'comma';
    const delimiter = Object.hasOwn(DELIMITERS, delimiterName) ? DELIMITERS[delimiterName] : undefined;
    if (delimiter === undefined) throw new UsageError('--delimiter must be comma, semicolon or tab.');
    const imported = importCsv(text, { columns, delimiter, now: io.now(), ...(role !== undefined ? { role } : {}) });
    inputs = imported.inputs;
    skippedText = imported.skipped > 0 ? ` Skipped ${String(imported.skipped)} rows that were not finished (incomplete, browsed or not attempted).` : '';
  } else if (format === 'xapi') {
    if (role === undefined) throw new UsageError('--role is required for xAPI imports.');
    if (args.multi.has('column') || args.strings.has('delimiter')) throw new UsageError('--column and --delimiter are for CSV imports.');
    const course = await loadCourse(args, io);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UsageError('The input file is not valid JSON.');
    }
    const base = args.strings.get('activity-base');
    const home = args.strings.get('account-home-page');
    const imported = fromStatements(
      data,
      {
        courseId: course.id,
        role,
        allowEmail: args.flags.has('allow-email'),
        ...(base !== undefined ? { activityBase: base } : {}),
        ...(home !== undefined ? { accountHomePage: home } : {}),
      },
      io.now(),
    );
    inputs = imported.inputs;
    skippedText = [...imported.skipped].map(([reason, n]) => ` Skipped ${String(n)}: ${reason}.`).join('');
  } else throw new UsageError('--format must be csv or xapi.');
  const added = await addRecords(file, inputs, keyFrom(io), io.now());
  io.stdout(`Imported ${String(added.added)} records (${String(added.duplicates)} duplicates skipped).${skippedText} Head: ${added.head}\n`);
  return 0;
}

/** True if both paths exist and name the same file (also through case-insensitive names or hard links). */
async function sameFile(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([stat(a).catch(() => undefined), stat(b).catch(() => undefined)]);
  return x !== undefined && y !== undefined && x.dev === y.dev && x.ino === y.ino;
}

async function recordErase(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { file: 'string', out: 'string', person: 'string', before: 'string', force: 'boolean' });
  const file = required(args, 'file');
  const out = required(args, 'out');
  const person = args.strings.get('person');
  const before = args.strings.get('before');
  if ((person === undefined) === (before === undefined)) throw new UsageError('Give exactly one of --person or --before.');
  if (before !== undefined && !isIsoDate(before)) throw new UsageError('--before must be a date YYYY-MM-DD.');
  if (resolve(out) === resolve(file) || (await sameFile(out, file))) throw new UsageError('--out must be a new file, not the records file itself.');
  const verified = await verifiedOrFail(file, io);
  const key = keyFrom(io);
  if (verified.header?.hmac && key === undefined) throw new UsageError(`This records file uses HMAC; set ${KEY_ENV} so the new file is verified and sealed with it.`);
  const { text, removed } = rewriteChain(verified, person !== undefined ? (r) => r.person !== person : (r) => r.date >= (before ?? ''), person !== undefined ? 'erasure' : 'retention', {
    key: verified.header?.hmac ? key : undefined,
    now: io.now(),
  });
  await writeFileSafe(out, text, { force: args.flags.has('force'), mode: 0o600 });
  io.stdout(`Wrote ${out} without ${String(removed)} records. Check it with "groundwork record verify --file ${out}", then replace the old file and delete the old file and its backups.\n`);
  return 0;
}

async function cmdRecord(argv: readonly string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'init':
      return recordInit(rest, io);
    case 'add':
      return recordAdd(rest, io);
    case 'verify':
      return recordVerify(rest, io);
    case 'export':
      return recordExport(rest, io);
    case 'import':
      return recordImport(rest, io);
    case 'erase':
      return recordErase(rest, io);
    default:
      throw new UsageError('Use: groundwork record init|add|verify|export|import|erase. See groundwork --help.');
  }
}

/**
 * Runs the command line. Returns the exit code: 0 success, 1 check failed,
 * 2 usage or file error. Never throws for expected errors and never prints
 * stack traces or the record key.
 */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const safe: CliIo = { ...io, stdout: (t) => { io.stdout(sanitizeOutput(t)); }, stderr: (t) => { io.stderr(sanitizeOutput(t)); } };
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
      case '--help':
      case 'help':
        safe.stdout(HELP);
        return command === undefined ? 2 : 0;
      case '--version':
        safe.stdout(`${VERSION}\n`);
        return 0;
      case 'lint':
        return await cmdLint(rest, safe);
      case 'build':
        return await cmdBuild(rest, safe);
      case 'scorm':
        return await cmdScorm(rest, safe);
      case 'check-scorm':
        return await cmdCheckScorm(rest, safe);
      case 'record':
        return await cmdRecord(rest, safe);
      default:
        throw new UsageError(`Unknown command ${JSON.stringify(command.slice(0, 40))}. See groundwork --help.`);
    }
  } catch (error) {
    if (error instanceof CheckFailed || error instanceof ImportError) {
      safe.stderr(`${error.message}\n`);
      return 1;
    }
    if (error instanceof UsageError || error instanceof FileError || error instanceof BuildError || error instanceof RecordsError || error instanceof XapiError || error instanceof CsvError) {
      safe.stderr(`groundwork: ${error.message}\n`);
      return 2;
    }
    safe.stderr('groundwork: unexpected error. Please report it without personal data.\n');
    return 2;
  }
}

