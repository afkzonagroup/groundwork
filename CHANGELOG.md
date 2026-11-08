# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
