# Review record

Two self-review passes, as required by the project standards. Each lists what
was checked, what was found and what was fixed. An independent review by the
coordinator follows.

State reviewed: version 0.1.0, 8 November 2026.

## Pass 1: correctness, law, edge cases, API, tests, security checklist

### Checked

**Against the official text** (EUR-Lex; quotations in docs/legal-basis.md):

- Article 4 as replaced by Regulation (EU) 2026/1744, Article 1, point (5)
  (OJ L, 2026/1744, 24.7.2026), checked in the Official Journal text and in
  the consolidated text of 27 July 2026. Entry into force on the third day
  after publication (Article 4 of Regulation (EU) 2026/1744), so 27 July 2026.
  The Commission's questions and answers say "mid-July 2026"; the course and
  documentation follow the Official Journal and note the difference.
- The original Article 4 wording, Article 3(56), recital 20, Article 113
  (Chapters I and II from 2 February 2025; Annex III high-risk obligations
  from 2 December 2027 and Annex I from 2 August 2028 as amended; Article
  5(1)(ba), (bb), (1a), (1b) from 2 December 2026), Article 99(1), (3), (6),
  Article 111(4), Article 3 points (1), (3), (4), (60), Article 5, Article 14,
  Article 26(2) and (5), Article 50(1) to (6), Article 73(1), Annex III
  points 3, 4 and 5(b).
- GDPR Articles 4(1), 5(1), 9(1), 22(1), 28(1), 33(1), 35(1) and recital 26.
- The Commission's AI literacy questions and answers (quotes "There is no
  need for a certificate.", "can keep an internal record of trainings and/or
  other guiding initiatives", and that the living repository "does not
  automatically grant presumption of compliance with Article 4").
- Wording rules: the course and README say the law requires measures, not a
  certificate or a specific course; records are presented as good evidence
  practice, not a legal form; nothing claims that the course makes anyone
  compliant (a test scans the modules for such claims).
- Every link in the course resolves offline against a registry of EUR-Lex
  CELEX numbers and anchors taken from the EUR-Lex HTML, or is one of two
  exact Commission URLs.

**Edge cases:** Markdown parser (unmatched delimiters, escapes, nesting,
containers, limits, CRLF, BOM), quiz rules (one correct option, option
count, unique ids, role coverage), grading rounding (79.9 % never passes an
80 % mark), CMITimespan formatting and caps, SCORM status handling (an
earlier pass is not replaced by a later fail), ZIP round trips (stored and
deflated), canonical JSON, every record field boundary, calendar dates,
future dates with a one-day allowance for time zones, CSV quoting and
parsing, xAPI score scaling and timestamps with offsets.

**API:** public functions have TSDoc; README examples run as tests; CLI
help lists every command (tested).

**Real browser** (Chromium from Playwright, from file://, widths 1280 px,
390 px and 320 px, light and dark): every page renders without horizontal
scrolling; the quiz asks for missing answers, grades, shows explanations,
resets; zero network requests; a `fetch` probe is blocked by CSP and an
`innerHTML` probe by Trusted Types; no console errors. A SCORM module page
was run inside a frame next to a SCORM 1.2 API stub served over HTTP: the
calls were LMSInitialize, lesson_status incomplete, score min/max/raw,
lesson_status passed, LMSCommit, session_time, exit, LMSCommit, LMSFinish.

**Security checklist (GOAL.md), line by line:** threat model in SECURITY.md;
validation at every boundary with size, length, type and allow-list checks;
no eval, Function constructor, dynamic import of input, child processes or
HTML sinks in `src/` (tests and lint); web-component rules not applicable
(no components; the pages run under a stricter hash-based CSP than
`script-src 'self'`); server rules not applicable (no server); SSRF not
applicable (no network code); personal data only in records, processed
locally, minimal fields, no telemetry, data flows in docs/privacy.md; files
written with mode 0600 (records, exports) or 0644 (course pages and
packages), never overwritten without `--force`, never through symbolic
links; supply chain (zero runtime dependencies, exact development versions,
lockfile, `files` allow-list, no install scripts, `npm audit --omit=dev`
clean); Dependabot; CI and CodeQL on pull requests and on demand only, with
actions pinned by SHA.

### Found and fixed

| # | Finding | Fix |
|---|---|---|
| 1 | `record erase` on a file that uses HMAC, run without the key, would have written the new chain without HMAC: a silent downgrade. | Erase refuses without the key for HMAC files and seals the new chain with it; test added. |
| 2 | `record export` of an HMAC file without the key verified only the hashes and did not say so. | A note on standard error says the HMAC was not checked; test added. |
| 3 | `record add` used the UTC date as the default, which is the wrong day near midnight in European time zones. | Default date is the local date. |
| 4 | The LMS documentation implied that LMS imports do not need the XML Schema files and that the package was used with Moodle. Neither was verified. | Wording now says what was tested (a SCORM 1.2 API stub in Chromium) and what was not (a live LMS). |
| 5 | The warning for correct answers always in the same position had no test. | Test added; the test fixture now varies the position. |
| 6 | (During the build) The editing tool wrote some `\u` escapes in regular expressions as raw characters (U+2028, U+2029, U+FEFF, U+FFFE, U+FFFF, U+00AD, full-width forms). | Replaced with escapes; a test now requires code files to be ASCII and rejects bidirectional, invisible and separator characters in every text file. |
| 7 | (During the build) The XML parser treated unprefixed elements without a default namespace as an undeclared prefix. | The empty prefix maps to no namespace; test added. |
| 8 | (During the build) An unused terminal-quoting helper in `src/util/text.ts`. | Removed; all output goes through one sanitiser in the CLI. |

## Pass 2: security, with fresh eyes, as an attacker or hostile contributor

### Checked

- **Injection into every output:** HTML (text, attributes, `lang`, titles,
  the answer-key JSON with `</script>`, `<!--`, U+2028/U+2029), links
  (`javascript:`, `data:`, protocol-relative, credentials, quotes in URLs),
  placeholders filled with HTML, CSV formulas (`=`, `+`, `-`, `@`, tab, CR,
  after whitespace, full-width forms, ideographic space), terminal escapes
  and bidirectional characters in everything the CLI prints.
- **Hostile content contributor:** raw HTML, links outside the allow-list,
  unknown containers and placeholders, invisible characters, oversized
  files, and denial of service through pathological Markdown.
- **Records attacker with write access:** edits with and without recomputed
  hashes, re-linking the rest of the chain, deleting, inserting, reordering,
  truncating, duplicate JSON keys, non-canonical numbers, a second header,
  `__proto__` keys, swapping MACs from another chain, downgrading to a chain
  without HMAC, wrong and short keys, lock files, symbolic links at the
  records path and at the lock path, FIFOs.
- **Hostile import files:** malformed CSV, wrong field counts, overlong
  fields, SCORM status values, xAPI statements with other verbs, other
  systems' accounts, foreign or traversal activity ids, scaled scores out of
  range, bad and future timestamps, control characters in names, email
  actors, and oversized inputs.
- **Hostile packages for `check-scorm`:** traversal names, CRC corruption,
  truncated archives, zip bombs (ratio and size limits), DOCTYPE and entity
  declarations (XXE and entity expansion), deep nesting, duplicate
  attributes.
- **Regular expressions:** reviewed for catastrophic backtracking; all are
  anchored or linear on bounded input.
- **Key handling:** the key is read only from the environment, never
  printed, logged or written (tested over every command's output and the
  file); comparisons in constant time.
- **Supply chain:** generated page script checked against its source by a
  test; CI with read-only permissions and `persist-credentials: false`.

### Found and fixed

| # | Finding | Fix |
|---|---|---|
| 1 | Inline Markdown parsing is quadratic in the worst case. A 256 KB module made of one paragraph of `**a ` would take more than a minute to lint or build (measured: 40,000 characters took about 2 seconds). | Paragraphs, list items and headings are limited to 4,000 characters and reported as errors beyond that; tests check that the worst patterns at the limit stay fast and that a maximum-size hostile module lints quickly. |
| 2 | xAPI result pages from an LRS (`more` links) would be imported only partly without any hint. | Documented in docs/lms.md: import every page. Groundwork never fetches. |

### Accepted, with reasons

- **Learners can read the answer key** in the page source. Quizzes are for
  learning; the AI Act requires no exam. Documented in SECURITY.md and the
  README.
- **Directory swaps during `build`:** an attacker who can write to the
  output directory's parent while `build` runs could replace a subdirectory
  with a symbolic link between the check and the write. Final path
  components are never followed (`O_NOFOLLOW`), the output is public course
  pages, and the attacker would already control the location.
- **Key check value:** the header stores 64 bits of an HMAC of a constant.
  It gives no more help to an offline key search than any line's MAC does;
  the README tells users to generate the key with `openssl rand -hex 32`.
- **SCORM API discovery** also searches the window opener, as SCORM 1.2
  runtimes do. A page that opens the course can therefore receive the quiz
  score; nothing else is sent.
- **A meta-tag CSP cannot set `frame-ancestors`.** Course pages are meant to
  be framed by an LMS.
- **`O_NOFOLLOW` does not exist on Windows;** there the symbolic-link check
  relies on `lstat` before opening.
- **`npm audit` including development dependencies** reports moderate
  advisories in `minimatch`, used by ESLint and typescript-eslint. It is
  lint tooling only and not shipped; `npm audit --omit=dev` is clean.

## Results after both passes

- `npm run check`: typecheck, lint and 225 tests pass; coverage 97.9 % of
  lines, 86.6 % of branches on the library and CLI.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm pack --dry-run`: 75 files, 116 kB, only `dist/`, `content/` and the
  licence and documentation files listed in `files`.

## Independent review

A separate reviewer checked the state above against the official texts, the
code and a real browser, without relying on the two passes. Date: 8 November
2026.

### Checked

**Law, against the official texts fetched from EUR-Lex and the Commission:**

- Regulation (EU) 2026/1744 (OJ L, 2026/1744, 24.7.2026): Article 1, point
  (5) replaces Article 4 with the wording quoted in the course; Article 4 of
  that Regulation sets entry into force on the third day after publication,
  so 27 July 2026. The consolidated text 02024R1689-20260727 carries the same
  wording. Points (7), (38), (39) and (40) of Article 1 (Article 5, 99, 111
  and 113 amendments) were read in full.
- AI Act Article 3, points (1), (3), (4), (56) and (60) (quotations
  verbatim); Article 4 (original and current); Article 5(1), points (a) to
  (h), (ba), (bb), and paragraphs (1a) and (1b); Article 14(4), point (b);
  Article 26(2) and (5); Article 50(1) to (7); Article 73(1) and its place in
  Chapter IX; Article 99(1), (3), (4), (6) and (6a); Article 111(4);
  Article 113 (all points as amended); Annex III, points 3, 4 and 5(b).
- GDPR Articles 4(1), 5(1), 9(1), 22(1), 28(1), 33(1), 35(1) and recital 26.
- The Commission's AI literacy questions and answers (last update 20 October
  2026): all three quotations exist word for word, and the page does say
  "mid-July 2026".
- Every EUR-Lex link in the course, the README and the documentation: the
  anchor exists in the live EUR-Lex HTML.
- All 48 quiz questions: exactly one defensible answer, explanation correct.

**Security:** renderer and site generator (text, attribute and link
escaping, CSP hashes, Trusted Types, regular expressions on maximum-size
hostile input, beyond the paragraph cap), SCORM package and manifest, the
SCORM API calls in a browser against a stub LMS, ZIP and XML readers, xAPI
and CSV imports (hostile and huge input, `__proto__` keys), records (chain,
HMAC, erase, key handling, CSV formulas, file modes, symbolic and hard links,
locks), CLI paths and output.

**Controls removed one at a time** (36 in total) to see whether a test
fails: escaping, link allow-list, answer-key escaping, CSP `connect-src` and
Trusted Types, placeholder validation, formula neutralising, hash, link,
sequence, canonical-form, MAC, require-HMAC, expected-head and MAC-presence
checks, erase key requirement, ZIP name and ratio checks, DOCTYPE refusal,
symbolic-link refusal, `O_EXCL`, lock, file mode, output-directory check,
terminal sanitiser, paragraph limit, xAPI email and account filters, and
every fix below. Three controls survived at first; tests were added and all
now fail when the control is removed.

**Engineering and accessibility:** the README quick start, SCORM and record
commands run in a clean copy (then deleted); all 25 pages of the built site
in Chromium from `file://` at 1280, 390 and 320 px in light and dark themes:
no horizontal scrolling, no console errors, no network requests, and no
axe-core violations for WCAG 2.0 and 2.1 A and AA plus best practices; the
quiz by keyboard only (skip link, focus on the first unanswered question, on
the result after checking, and on the first option after "Try again";
visible 3 px focus outline); `fetch` and `innerHTML` blocked.

**Publish gate:** every commit has antonmacius-droid as author and committer;
no co-author or generator lines; no tool names in any tracked file or in any
diff in the history.

### Found and fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Heading recognition used `/^(#{1,6})\s+(.+?)\s*#*\s*$/`, which backtracks cubically. One 10,000-character line such as `## a`, spaces, `b` took about 170 seconds; a module of the maximum size could stop `lint`, `build` or CI for hours. The pass 2 paragraph limit did not cover it, and overlong lines were reported but still parsed. | Linear heading matcher (a closing `#` run is removed only after whitespace, so "C#" keeps its text); overlong lines are reported and parsed only up to 2,000 characters; timing tests on maximum-size hostile lines. |
| 2 | Medium | Trailing spaces were removed with `/\s+$/`, which is quadratic on long runs of spaces (tens of seconds for one large line). | `trimEnd()`; timing test. |
| 3 | Medium | The lint check for HTML tags, `/<\/?[a-zA-Z][^>]*>/`, is quadratic on text like `<a<a<a...`: about 11 seconds for one 240 KB paragraph. | `[^<>]*`, which finds the same tags in linear time; the link-in-link check changed the same way; timing test. |
| 4 | Medium | SCORM: after an earlier pass, a failed retry still overwrote `cmi.core.score.raw` with the lower score (a test required this). The manifest sets `adlcp:masteryscore`, and an LMS may derive the status from the raw score, so the learner's pass could turn into a fail. | A failed attempt after a pass changes nothing; the learner is told the earlier pass is kept; tests and docs/lms.md updated; browser run against the stub LMS. |
| 5 | Medium | Quiz question prohibited-practices-2 asked when "Article 5(1), points (a) to (h)" apply, with 2 February 2025 as the answer. In the current text points (ba) and (bb) sit between (b) and (c) and apply from 2 December 2026, so the marked answer was not defensible for the whole range. | Question and module text now name the original prohibitions; the explanation states the later date for (ba) and (bb); same fix in docs/legal-basis.md. |
| 6 | Low | Escalation module: Article 26(5) was given as "inform the provider first" only. | Now: inform first the provider, then the importer or distributor and the market surveillance authorities. |
| 7 | Low | Question data-protection-1: "a customer number linked to one customer" is not personal data when the customer is a company. | "one individual customer". |
| 8 | Low | Question data-protection-3: the explanation did not say for whom the coded data stays personal. | Explanation names the organisation holding the list and recital 26. |
| 9 | Low | docs/legal-basis.md said Article 73 applies "with the high-risk obligations"; Article 113 says otherwise (Chapter IX applies from 2 August 2026). | Row states what the text says and when the high-risk classification applies. |
| 10 | Low | xAPI import converted time stamps to UTC dates, unlike CSV import and `record add`, which keep the local date; a completion at 00:30 in Vilnius was recorded on the day before. | The calendar date written in the time stamp is used; documented; test. |
| 11 | Low | xAPI statement ids came from the chain hash, so after `record erase` rewrote the chain a new export gave new ids and an LRS would store duplicates. | Ids derive from the record content and its time stamp; test across an erasure. |
| 12 | Low | `record erase --force` with `--out` naming the records file by another path (hard link, or other letter case on macOS) passed the path comparison and truncated the records file in place. | Same-file check by device and inode; test with a hard link. |
| 13 | Low | `record import` with an invalid `--role` skipped every row silently and reported "Imported 0 records". | Usage error; test. |
| 14 | Low | Three security controls had no failing test when removed: escaping of text nodes in the renderer, the output-directory check, and the check for a MAC in a chain without HMAC. | Tests added; each now fails without its control. |
| 15 | Info | README did not say why Node.js 22 is required; SECURITY.md had no row for denial of service through content. | Both added. |

### Open decisions for the owner

1. xAPI imports accept actors from any system unless `--account-home-page`
   is given. Make it required?
2. The Commission's questions and answers say national market surveillance
   authorities supervise and enforce Article 4 from 2 August 2026. Add that
   to the managers' section of module 1 (guidance, not the text of the Act)?
3. `record verify` exits 0 for a file that uses HMAC when no key is set (it
   prints "HMAC not checked"). Keep, or fail unless the key is given?
4. Content version stays 1.0.0 because nothing is released yet. Bump it if
   any copy of the course has already been given out.
5. The SCORM runtime is still tested only against a stub. Test in a live
   Moodle before release, in particular how it applies the mastery score.
6. `--force` overwrites a file that is a hard link to another file (as most
   tools do). Accept, or refuse files with more than one link?

### Results after the independent review

- `npm run check`: typecheck, lint and 234 tests pass; coverage 97.9 % of
  lines, 86.8 % of branches.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Live LMS testing (issue #9)

The SCORM package was taken through Moodle 5.3.0 LTS and ILIAS 11.5.0 in
Docker, uploaded by an administrator through the web interface and completed
by a learner in Chromium, with the stored data read back after every step
(`scripts/lms-moodle-check.mjs`, `scripts/lms-ilias-check.mjs`). This closes
open decision 5 above: Moodle applies the mastery score as expected and an
earlier pass is kept.

| # | Found | Fixed |
|---|---|---|
| 1 | Moodle Preview recorded a checked quiz as a real attempt (`failed`, score, grade 0); a preview without a quiz became `completed`. | Browse, review and no-credit sessions report nothing and say so; an unattempted module is set to `browsed` in a preview. |
| 2 | A module closed halfway exited normally with nothing saved, so the learner started over. | Suspend with chosen answers and section; restore on return. |
| 3 | Moodle gives a stale `cmi.core.entry` when a learner returns to a module in the same player visit, so a resume keyed on `entry` alone did not restore. | Resume also when suspend data is present (only ever written on suspend; cleared on a normal exit). |
| 4 | ILIAS without learning progress runs modules with `no-credit`, silently drops scores and statuses, and the page still said "sent". | No-credit is detected and the page says results are not recorded; ILIAS setting documented. |
| 5 | xAPI import treated a Group actor, or an actor with two identifiers, as a person. | Skipped and counted. |

Records integrity was checked end to end through the CLI: edits, re-hashed
lines, swapped lines, truncation (with `--expect-head`), wrong keys,
re-hashed HMAC chains and downgrades to a plain chain are all detected as
documented. Two behaviours stay open for the owner (issue #10): `record
verify` without a key exits 0 on an HMAC file even when the chain was
re-hashed by someone without the key (it says "HMAC not checked"), and xAPI
imports without `--account-home-page` accept accounts from any system.

