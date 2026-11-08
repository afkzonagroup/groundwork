# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Resume in SCORM: a module left before it is passed is suspended
  (`cmi.core.exit` "suspend") with the chosen answers in `cmi.suspend_data`
  and the section in `cmi.core.lesson_location`; reopening it restores both.
- Live LMS checks: `scripts/lms-moodle-check.mjs` and
  `scripts/lms-ilias-check.mjs` take the SCORM package through Moodle 5.3 LTS
  and ILIAS 11.5 in Docker (compose files in `test/lms/`) and check what the
  LMS stored. The `LMS` workflow runs them on demand and on pull requests
  that change the SCORM code. Results in the README and `docs/lms.md`.

### Fixed

- SCORM: a quiz checked in Moodle's Preview was recorded as a real attempt
  (status "failed", score and a grade of 0), and a preview without a quiz
  was stored as "completed". In "browse" and "review" mode, and when the LMS
  gives no credit (`cmi.core.credit` "no-credit", as ILIAS does without
  learning progress), the page now reports nothing, tells the learner, and
  marks an unattempted module "browsed" in a preview.
- SCORM: a module closed halfway always exited normally, so the LMS had no
  reason to resume it and nothing to resume with.
- xAPI import: statements by a Group, or by an actor with more than one
  identifier, were imported as a person's records. They are now skipped and
  counted.

## [0.1.0] - 2026-11-08

### Added

- AI literacy course (CC BY 4.0) in Markdown: seven modules with learning
  objectives, quizzes with explanations, official sources, and versions for
  all staff, people building or buying AI, and managers. Reflects Article 4
  of the AI Act as replaced by Regulation (EU) 2026/1744.
- Content lint: structure, quiz rules, roles, placeholders, and citations
  checked against a registry of EUR-Lex documents and anchors.
- Offline course site generator: self-contained pages with a hash-based
  Content Security Policy, Trusted Types, accessible quizzes graded in the
  browser, light and dark themes.
- SCORM 1.2 package export with run-time reporting of score, status and
  session time, and a package and manifest checker.
- Tamper-evident training records: hash-chained JSON Lines with optional
  HMAC, verification with an optional expected head, erasure and retention
  rewrites.
- Exports: CSV protected against formula injection, JSON, and xAPI 1.0.3
  statements with ADL verbs. Imports: xAPI statements and mapped CSV reports.
- `groundwork` command line tool.

[Unreleased]: https://github.com/afkzonagroup/groundwork/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/afkzonagroup/groundwork/releases/tag/v0.1.0
