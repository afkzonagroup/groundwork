# Groundwork

An open AI literacy course for staff, with quizzes, an offline course site,
SCORM 1.2 and xAPI export for learning platforms, and tamper-evident
training records.

Groundwork gives organisations a ready course for Article 4 of the EU AI
Act. The course is plain Markdown that anyone can read, change and
translate. Groundwork turns it into an accessible website that works from a
folder on your disk, or into a SCORM package for Moodle and other learning
platforms. It also keeps simple, verifiable records of who took part.

## Why

Article 4 of the [AI Act (Regulation (EU) 2024/1689)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_4)
asks providers and deployers of AI systems to support the AI literacy of
their staff and of others who operate or use AI systems on their behalf.
It has applied since 2 February 2025 (Article 113, point (a)).
[Regulation (EU) 2026/1744](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32026R1744#art_1)
replaced its wording with effect from 27 July 2026. It now reads:

> "Providers and deployers of AI systems shall take measures to support the
> development of AI literacy of their staff and other persons dealing with
> the operation and use of AI systems on their behalf, taking into account
> their technical knowledge, experience, education and training and the
> context the AI systems are to be used in, and considering the persons or
> groups of persons on whom the AI systems are to be used. This obligation
> does not require providers or deployers to guarantee any specific level of
> AI literacy of any individual."

What this means in practice:

- The law requires **measures**. It does not require a certificate, an exam
  or a specific course. The European Commission's
  [questions and answers](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers)
  say: "There is no need for a certificate."
- Training records are **good evidence practice**, not a legal form. The
  Commission says organisations "can keep an internal record of trainings
  and/or other guiding initiatives".

Until now the options were paid per-seat courses and Word templates.
Groundwork is open: the course content is CC BY 4.0 and the software is
AGPL-3.0.

Details and quotations: [docs/legal-basis.md](docs/legal-basis.md).

## What the course covers

Seven modules, about 80 minutes in total, in English. Each module has
learning objectives, content, a short quiz with explanations, and its
official sources.

| Module | Main points | Sources |
|---|---|---|
| Why this course: AI literacy at work | What Article 4 requires and does not require; providers and deployers | AI Act Art. 3, 4, 99, 113; recital 20; Commission Q&A |
| What AI systems are and how they fail | Definition of an AI system; made-up facts, bias, data leaks, hidden instructions, automation bias | AI Act Art. 3(1), 14 |
| Using AI tools with company and personal data | Personal data, purpose limitation, minimisation, special categories, breaches | GDPR Art. 4, 5, 9, 22, 28, 33, 35; recital 26 |
| Checking what AI produces | How to check facts, sources and numbers; human oversight | AI Act Art. 14, 26, Annex III |
| Telling people when AI is involved | The four situations in Article 50 and who must act | AI Act Art. 3(60), 50, 111, 113 |
| What the AI Act forbids | Article 5 in plain words, including the 2026 additions | AI Act Art. 5, 99, 113 |
| When and how to raise a concern | Warning signs, first steps, who to tell, why speed matters | GDPR Art. 33; AI Act Art. 26, 50, 73 |

Three versions: **all staff**, **people building or buying AI**, and
**managers**. The extra sections and questions for the second and third
group appear only in their version.

The course is in English. **Translations are welcome.** Quotations of the
law must come from the official language version on EUR-Lex, and every
translation must be reviewed by a native speaker who knows the subject
before it is merged.

## Quick start

Requires Node.js 22 or later (Node.js 20 reached end of life in April 2026).

```sh
git clone https://github.com/afkzonagroup/groundwork.git
cd groundwork
npm ci
npm run build
node dist/cli/main.js build --out site --organisation "Example Ltd" \
  --ai-contact "the AI desk (ai@example.com)"
```

Open `site/index.html` in a browser. Once released on npm,
`npx @afkzona/groundwork build --out site` does the same.

## Course site

```sh
groundwork build --out site [--role staff] [--organisation NAME] [--ai-contact TEXT]
```

- One folder per version and a start page to choose, or with `--role` a
  single version at the top level.
- Every page is one self-contained HTML file: no external fonts, scripts or
  images. It works from `file://`, a web server or a USB stick.
- Strict Content Security Policy in every page: `default-src 'none'`, the
  inline style and script allowed only by hash, no network access, Trusted
  Types required.
- Built for WCAG 2.1 AA: semantic headings and landmarks, skip link, every
  answer option labelled, questions grouped in fieldsets with legends, quiz
  results announced to screen readers, visible focus, colour contrast of at
  least 4.5:1 (tested), light and dark themes, works at 320 px width.
- Quizzes are graded in the browser. Nothing is stored or sent.

## SCORM 1.2 package

```sh
groundwork scorm --out groundwork-staff.zip --role staff
groundwork check-scorm groundwork-staff.zip
```

One SCO per module. Each reports the score, passed or failed and the session
time to the LMS through the SCORM 1.2 API. A learner who leaves a module
before passing it comes back to the same place, with the answers chosen so
far. In a preview, or when the LMS gives no credit, nothing is recorded and
the page says so. Upload the ZIP to a SCORM 1.2 platform such as Moodle or
ILIAS. Details and recommended settings: [docs/lms.md](docs/lms.md).

## Tested LMS

The package is tested end to end in real installations in Docker: an
administrator uploads it through the web interface, a learner takes the
course in Chromium, and the check reads what the platform stored.

| LMS | Version | Result |
|---|---|---|
| Moodle | 5.3.0 LTS (PHP 8.3, PostgreSQL 17) | Pass: status, score, retries, kept pass, suspend and resume, time, gradebook, activity completion, Preview |
| ILIAS | 11.5.0 (PHP 8.3, MariaDB 10.11) | Pass: status, score, retries, kept pass, suspend and resume, time, learning progress, no-credit mode |

Run the checks with `node scripts/lms-moodle-check.mjs` and
`node scripts/lms-ilias-check.mjs` (Docker needed). In Moodle, set the
completion to *Require status: Passed* and *Require all scos to return
completion status*; in ILIAS, turn on learning progress for the module.
Results, settings and platform quirks: [docs/lms.md](docs/lms.md#tested-learning-platforms).

## Training records

```sh
export GROUNDWORK_RECORD_KEY="$(openssl rand -hex 32)"   # optional, keep it in a secrets store
groundwork record init --file records.jsonl --hmac
groundwork record add --file records.jsonl --person E1001 --role staff \
  --activity ai-basics --result passed --score 90 --date 2026-11-02
groundwork record verify --file records.jsonl
groundwork record export --file records.jsonl --format csv --out records.csv
```

- JSON Lines, one record per line, each line linked to the one before it by
  a SHA-256 hash; optionally an HMAC on every line with a key from the
  environment. `verify` shows any changed, inserted, deleted or reordered
  line. Store the printed head hash elsewhere and use `--expect-head` to
  detect lines removed at the end. Format: [docs/records-format.md](docs/records-format.md).
- Records hold only person (name or, better, employee id), role, activity,
  date, result and an optional score. See [docs/privacy.md](docs/privacy.md)
  for data minimisation and GDPR.
- CSV export is protected against formula injection. JSON and xAPI exports
  are also available.
- `record import` reads xAPI statements (a standard format) and CSV reports
  from an LMS with an explicit column mapping.
- `record erase --person ID` or `--before DATE` writes a new verified file
  without those records, for erasure requests and retention limits.

## Library

<!-- example:course -->
```ts
import { buildScormPackage, buildSite, bundledContentDir, loadCourseDir, validateScormPackage } from '@afkzona/groundwork';

const { course, issues } = await loadCourseDir(bundledContentDir());
if (!course) throw new Error(issues.map((i) => i.message).join('\n'));

const pages = buildSite(course, { roles: ['staff'], organisation: 'Example Ltd', aiContact: 'the AI desk' });
if (pages[0]?.path !== 'index.html') throw new Error('unexpected');

const zip = buildScormPackage(course, { role: 'managers' });
if (validateScormPackage(zip).length > 0) throw new Error('invalid package');
```

<!-- example:records -->
```ts
import { createHeader, createRecord, serializeEntry, verifyChain } from '@afkzona/groundwork';

const key = undefined; // or a secret of at least 32 characters for HMAC
const header = createHeader({ key });
const record = createRecord(header, header, {
  person: 'E1001',
  role: 'staff',
  activity: 'ai-basics',
  date: '2026-11-02',
  result: 'passed',
  score: 90,
  source: 'manual',
}, { key });
const text = `${serializeEntry(header)}\n${serializeEntry(record)}\n`;

const result = verifyChain(text, { key });
if (!result.ok || result.records.length !== 1) throw new Error('verification failed');
```

The full API is exported from `src/index.ts` and documented with TSDoc.

## Configuration reference

| Option | Commands | Meaning |
|---|---|---|
| `--content DIR` | lint, build, scorm, record export/import | Course directory (default: the bundled course) |
| `--out PATH` | build, scorm, record export/erase | Output directory or file; `-` for standard output (export only) |
| `--role ROLE` | build (repeatable), scorm, record import | Course version: `staff`, `builders`, `managers` |
| `--organisation NAME` | build, scorm | Replaces `{organisation}` in the course |
| `--ai-contact TEXT` | build, scorm | Replaces `{ai-contact}`: who to tell about AI concerns |
| `--force` | build, scorm, record export/erase | Overwrite existing files |
| `--file FILE` | record | The records file |
| `--hmac` | record init | Use HMAC; needs `GROUNDWORK_RECORD_KEY` |
| `--expect-head HASH` | record verify | Hash of the last line noted earlier |
| `--require-hmac` | record verify | Fail unless the file uses HMAC and the key verifies it |
| `--format` | record export/import | `csv`, `json`, `xapi` / `csv`, `xapi` |
| `--account-home-page URL` | record export/import | xAPI `account.homePage` (https) |
| `--activity-base IRI` | record export/import | xAPI activity id prefix (default `urn:groundwork:`) |
| `--column FIELD=HEADER` | record import | CSV column mapping |
| `--delimiter` | record import | `comma`, `semicolon` or `tab` |
| `--allow-email` | record import | Accept xAPI actors identified only by email |
| `GROUNDWORK_RECORD_KEY` | record | HMAC key, at least 32 characters; never printed |

Course settings (title, versions, pass mark, module order) are in
`content/course.json`. To write your own module, copy one from
`content/modules/` and run `groundwork lint`.

## How it maps to the law

| Provision | Groundwork |
|---|---|
| [AI Act Art. 4](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_4): measures to support AI literacy | A course an organisation can use as one measure, in three versions |
| Art. 4: "taking into account their technical knowledge, experience, education and training and the context" | Role versions; organisation name and contact; editable content |
| Art. 4: no specific level of AI literacy guaranteed | Quizzes for learning, not an exam; no certificate |
| [Art. 3(56)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_3): definition of AI literacy | Modules on use, risks and possible harm |
| Evidence (good practice, not required) | Tamper-evident records; CSV, JSON, xAPI; SCORM 1.2 |

## Limitations

- Groundwork is one possible measure. It does not decide what measures are
  enough for your organisation, and it does not cover your own AI tools and
  rules; add briefings on those.
- It does not make anyone compliant, and completing the course is not a
  certificate.
- Quizzes are graded in the browser; learners can see the answers in the
  page source. They are for learning.
- The course reflects the law as published up to 8 November 2026, including
  Regulation (EU) 2026/1744. Laws, guidance and dates change.
- English only for now.
- SCORM 1.2 only (not SCORM 2004 or cmi5). The XML Schema files are not
  bundled in the package; see [docs/lms.md](docs/lms.md).
- Records detect removal of recent lines only with a head hash stored
  elsewhere, and cannot detect a rewrite by someone who holds the HMAC key.

## Security

See [SECURITY.md](SECURITY.md) for the threat model and how to report a
vulnerability. In short: no runtime dependencies, no network code, strict
Content Security Policy in generated pages, every input validated with
limits, files created without following symbolic links, records verified
before every change.

## Dependencies

None at run time. The generated pages contain only Groundwork's own
stylesheet and script. ZIP files are written with `node:zlib` (raw DEFLATE)
and a small ZIP writer in `src/zip/`: the needed subset of the format is
small, and this avoids a dependency in the package that handles personal
data.

Development only (exact versions in `package.json`): TypeScript, ESLint with
typescript-eslint, Vitest with V8 coverage, esbuild (bundles the page
script into `src/site/client-script.generated.ts`, which is committed and
checked by a test), and playwright-core (drives Chromium in the live LMS
checks under `scripts/`; it has no dependencies of its own and downloads no
browser at install).

## Licence and Enterprise

- Software: [AGPL-3.0-only](LICENSE), with an attribution term under section
  7(b): course pages and interfaces keep "Groundwork by AFKzona Group" with
  its link ([LICENSE-ADDITIONAL-TERMS.md](LICENSE-ADDITIONAL-TERMS.md)).
- Course content (`content/`): [CC BY 4.0](LICENSE-CONTENT).
- A commercial licence without AGPL obligations, with white-label courses,
  is available ([COMMERCIAL.md](COMMERCIAL.md)).
- "Groundwork" is a trademark of MB AFKzona Group ([TRADEMARKS.md](TRADEMARKS.md)).

**Enterprise.** AFKzona Group offers a hosted dashboard, continuous
monitoring of training coverage across sites and entities, SSO/SAML, roles
and permissions, audit evidence packs, a legal-update feed, and SLA support.
These are not part of this repository. Contact info@afkzonagroup.lt.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests require the
[Contributor Licence Agreement](CLA.md). Content changes must cite the
official text on EUR-Lex.

## Disclaimer

Groundwork gives general information about the law. It is not legal advice.
Check your obligations with a qualified adviser.

Copyright 2026 MB AFKzona Group. Maintained by AFKzona Group.
