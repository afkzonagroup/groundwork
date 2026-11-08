// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Groundwork: an open AI literacy course for Article 4 of the EU AI Act,
 * with an offline course site, SCORM 1.2 and xAPI export, and
 * tamper-evident training records.
 *
 * @packageDocumentation
 */

export { ATTRIBUTION, PRODUCT, PROJECT_URL, VERSION } from './version.js';

// Content
export { type Course, type CourseMeta, type Role, assembleCourse, parseCourseJson, questionsForRole } from './content/course.js';
export { bundledContentDir, loadCourseDir } from './content/load.js';
export { LINT_RULES, lintCourse, loadAndLint } from './content/lint.js';
export { type Block, type Inline, PLACEHOLDERS, type PlaceholderName, parseBlocks, parseInline } from './content/markdown.js';
export { type ContentIssue, type CourseModule, type Question, type Section, type Source, parseModule } from './content/module.js';
export { type CitationCheck, type LegalAct, LEGAL_ACTS, OFFICIAL_PAGES, checkCitation, eurLexUrl } from './legal/sources.js';

// Site and LMS export
export { BuildError, type OutputFile, type PageMode, type SiteOptions, buildSite, renderModulePage, resolvePlaceholders } from './site/build.js';
export { contentSecurityPolicy, escapeHtml } from './site/html.js';
export { ADLCP_NS, IMSCP_NS, type ScormOptions, buildScormPackage, scormFiles, scormManifest } from './scorm/manifest.js';
export { validateScormManifest, validateScormPackage } from './scorm/validate.js';
export { type ZipEntry, ZipError, createZip, crc32, readZip } from './zip/zip.js';

// Records
export {
  type ChainProblem,
  type Entry,
  type HeaderEntry,
  type RecordEntry,
  RecordsError,
  type VerifyOptions,
  type VerifyResult,
  canonicalJson,
  createHeader,
  createRecord,
  rewriteChain,
  serializeEntry,
  verifyChain,
} from './records/chain.js';
export { RESULTS, type RecordInput, type Result, SOURCES, validateRecordInput } from './records/fields.js';
export { neutraliseFormula, parseCsv, writeCsv } from './records/csv.js';
export { CSV_COLUMNS, recordsToCsv, recordsToJson } from './records/export.js';
export { type CsvImportOptions, ImportError, importCsv } from './records/import-csv.js';
export { addRecords, initRecordsFile, readRecordsFile } from './records/store.js';
export { ACTIVITY_TYPES, DEFAULT_ACTIVITY_BASE, type Statement, VERBS, type XapiOptions, XapiError, fromStatements, toStatements } from './xapi/xapi.js';

// Command line
export { type CliIo, run } from './cli/run.js';
