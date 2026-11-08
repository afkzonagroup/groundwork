# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:
<https://github.com/afkzonagroup/groundwork/security/advisories/new>. Do not
open a public issue. If you cannot use GitHub, email info@afkzonagroup.lt.

Include the version, what you did, what happened, and a minimal example
**without real personal data**. We aim to acknowledge reports within five
working days and to agree a disclosure date with you.

Supported versions: the latest release.

## Threat model

### Assets

- **Training records**: name or employee id, role, activity, date, result,
  score. Personal data about employees and contractors.
- **The integrity of the records**: an organisation may use them as evidence
  of its AI literacy measures.
- **The HMAC key** (`GROUNDWORK_RECORD_KEY`), if used.
- **Learners' browsers**: the generated course pages run in them, from a
  file, a web server or inside an LMS.
- **The user's machine**: files the CLI reads or writes; the terminal.

### Actors

- The **training administrator** who runs the CLI (trusted, may make
  mistakes).
- **Learners**, who open the course pages and answer the quizzes (may try to
  see the answers; this is not a threat to protect against, see below).
- **Someone with write access to the records file** who wants to change a
  result, add a completion or hide one (for example an employee, or anyone
  with access to a shared drive).
- A **hostile data source**: LMS reports, xAPI exports and course content
  from third parties can contain crafted values.
- A **hostile contributor** proposing code or content changes.
- A **network attacker** (relevant only if code tried to use the network).

### Trust boundaries

1. Course content (Markdown, course.json) → parser, lint and page generator.
2. Generated pages ↔ the learner's browser, the LMS frame and the network.
3. Import files (CSV, xAPI JSON) → validators → records file.
4. Records file on disk ↔ anyone who can write it.
5. Records → exports opened in spreadsheet programs, LRSs and terminals.
6. Command line arguments and environment → file system.
7. Contributions → the released package.

### Mitigations

| Threat | Mitigation | Test |
|---|---|---|
| Script injection through course content or organisation name | No raw HTML in the Markdown dialect; every text node and attribute escaped; links only to allow-listed EUR-Lex anchors and Commission pages (lint) and only `https:` or relative page links (renderer); answer key JSON escapes `<`, `>`, `&`, U+2028, U+2029 | `site.test.ts`, `markdown.test.ts`, `content.test.ts` |
| Script execution or data leaving the course page | Content Security Policy in every page: `default-src 'none'`, inline style and script allowed only by SHA-256 hash, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, Trusted Types required; no external assets; the page script uses only `textContent`, `classList` and `hidden`; no storage, cookies or network APIs | `site.test.ts`, `client.test.ts`, browser check in REVIEW.md |
| Changed, inserted, deleted or reordered records | Hash chain: every line carries the SHA-256 of the previous line and of itself; sequence numbers; canonical JSON required; full verification before every append and export | `records.test.ts`, `cli.test.ts` |
| Records rewritten by someone who can recompute hashes | Optional HMAC-SHA256 with a key from the environment; key check value in the header; a given key also rejects a chain without HMAC (downgrade); `--require-hmac` | `records.test.ts`, `cli.test.ts` |
| Records removed at the end of the file | `verify --expect-head` with a head hash stored elsewhere (documented as the only way to detect truncation) | `records.test.ts` |
| Key disclosure | Key only from the environment, never printed, logged or written; only a 64-bit HMAC-derived check value is stored | `cli.test.ts`, `records.test.ts` |
| Timing attacks on hash or MAC comparison | `crypto.timingSafeEqual` for every comparison | code review |
| Concurrent appends forking the chain | Exclusive lock file created with `O_EXCL`; appends with `O_APPEND` and `fsync` | `cli.test.ts` |
| Formula (CSV) injection in exports | Cells starting with `=`, `+`, `-`, `@`, tab or CR, also after whitespace and in full-width forms, get a leading `'`; plain numbers untouched; RFC 4180 quoting | `exchange.test.ts` |
| Denial of service through crafted course content | File, line, paragraph and nesting limits; overlong lines are reported and parsed only up to the limit; block and inline parsing and lint checks use no regular expressions that backtrack on long input (tested on maximum-size hostile modules) | `markdown.test.ts`, `content.test.ts` |
| Hostile import files | Size limits before reading; strict UTF-8; strict RFC 4180 parser with row, field and length limits; every row validated; any invalid CSV row fails the whole import; xAPI statements mapped only from known verbs, this course's activity ids and well-formed timestamps | `exchange.test.ts`, `cli.test.ts` |
| Hostile SCORM packages and manifests (when checking) | ZIP reader with entry-count, size and compression-ratio limits, CRC check and safe-name rule; XML parser refuses DOCTYPE and processing instructions (no entity expansion, no XXE), with depth and size limits | `scorm.test.ts` |
| Path traversal and file overwrite | Output paths built from validated ids and checked to stay inside the output directory; ZIP entry names validated; files created with `O_EXCL` unless `--force`; symbolic links refused (`O_NOFOLLOW` and `lstat`); FIFOs and devices refused | `cli.test.ts`, `scorm.test.ts` |
| Terminal escape injection | Everything printed is passed through a filter that escapes control, format (including bidirectional) and separator characters | `cli.test.ts` |
| Prototype pollution | Option and key lookups use `Object.hasOwn` and `Map`; unknown keys in course.json and records are rejected | `cli.test.ts`, `content.test.ts`, `records.test.ts` |
| Information leakage in errors | No stack traces; fixed messages for unexpected errors | `cli.test.ts` |
| Code execution | No `eval`, `new Function`, dynamic `import()`, child processes or HTML sinks in `src/` (tests and lint) | `hygiene.test.ts` |
| Trojan Source (hidden Unicode) | Tests reject bidirectional controls, zero-width characters, separators and stray control characters in every text file; code files must be ASCII | `hygiene.test.ts` |
| Supply chain | Zero runtime dependencies; exact development versions; committed lockfile; install scripts off (`.npmrc`, `npm ci --ignore-scripts`); `files` allow-list; CI actions pinned by SHA with read-only permissions; generated client bundle checked against its source | `hygiene.test.ts`, `client.test.ts` |

### Not protected against (by design)

- **Learners seeing the answers.** Quizzes are graded in the browser, so the
  answer key is in the page. The quizzes help people learn; they are not an
  exam. The AI Act does not require an exam.
- **Results reported by an LMS.** A SCORM or xAPI completion is as reliable
  as the LMS and the browser that produced it.
- **Someone who holds the HMAC key**, or who can replace both the records
  file and the head hash you stored elsewhere.
- **A compromised machine or browser.**

### Data flows

See [docs/privacy.md](docs/privacy.md). In short: the course pages send
nothing anywhere; the CLI reads only files you name and writes only files
you name; nothing leaves the machine unless you copy it.
