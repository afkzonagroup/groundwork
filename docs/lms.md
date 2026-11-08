# Using Groundwork with an LMS

## SCORM 1.2

`groundwork scorm --out course.zip --role staff` writes a SCORM 1.2 content
package:

- `imsmanifest.xml` at the root, in the IMS Content Packaging namespace
  `http://www.imsproject.org/xsd/imscp_rootv1p1p2` with the ADL extension
  namespace `http://www.adlnet.org/xsd/adlcp_rootv1p2`, metadata
  `<schema>ADL SCORM</schema>` and `<schemaversion>1.2</schemaversion>`;
- one organisation with one item per module, each with
  `<adlcp:masteryscore>` set to the course pass mark;
- one resource per module, `type="webcontent"`, `adlcp:scormtype="sco"`,
  whose launch file is the module page.

Each module page is a SCO. It finds the LMS API object (`API`) in its parent
windows or opener, then:

1. calls `LMSInitialize("")` and reads `cmi.core.lesson_mode` and
   `cmi.core.credit`. In normal mode with credit it sets
   `cmi.core.lesson_status` to `incomplete` if it was `not attempted`, and
   restores the learner's place if the module was left before it was passed
   (see "Leaving and resuming" below);
2. when the learner checks the quiz, sets `cmi.core.score.min` (0),
   `cmi.core.score.max` (100), `cmi.core.score.raw` and
   `cmi.core.lesson_status` (`passed` or `failed`), then `LMSCommit("")`.
   After an earlier `passed`, a later failed attempt changes nothing: neither
   the status nor the score, because an LMS that applies the mastery score
   could otherwise turn the pass into a fail;
3. when the page is closed, sets `cmi.core.session_time` (CMITimespan,
   `HHHH:MM:SS.SS`) and `cmi.core.exit`, then `LMSCommit("")` and
   `LMSFinish("")`. A passed module exits normally (`cmi.core.exit` empty,
   saved place cleared); a module not passed yet exits with `suspend`.

**Leaving and resuming.** When a learner leaves a module before passing it
(closes the window, or opens another module), the page saves the answers
chosen but not yet checked in `cmi.suspend_data` (compact JSON such as
`{"v":1,"a":[["ai-basics-1",2]]}`, at most 4096 characters) and the section
being read in `cmi.core.lesson_location`, and sets `cmi.core.exit` to
`suspend`. When the module opens again, it puts the answers back, scrolls to
that section and says so. The saved value is checked against the page's own
questions before use; anything else is ignored. The page uses saved data
when `cmi.core.entry` is `resume`, and also when suspend data is present
with another entry value, because Moodle sets `cmi.core.entry` once when its
player opens (see below).

**Preview, review and no credit.** In `browse` mode (Moodle's Preview), in
`review` mode, and when `cmi.core.credit` is `no-credit`, the page does not
report the quiz result and does not save a place, and it tells the learner
that the result is not recorded. In `browse` mode it sets the status of a
module not attempted before to `browsed`.

`groundwork check-scorm course.zip` checks the structure of any SCORM 1.2
package (manifest rules, references, files present, safe paths).

**Limitations.** The package does not include the IMS and ADL XML Schema
files (`imscp_rootv1p1p2.xsd`, `adlcp_rootv1p2.xsd`, `ims_xml.xsd`) and the
manifest does not reference them, because their licences are not ours to
grant. The ADL SCORM 1.2 conformance test suite and some LMS import
validators expect them; if yours does, add them from ADL to the root of the
package. Moodle 5.3 and ILIAS 11.5 import the package without them.

## Tested learning platforms

The package is tested end to end in real Moodle and ILIAS installations in
Docker: an administrator uploads it through the web interface and a learner
takes the course in Chromium. The checks read what the platform stored after
each step. Run them yourself with Docker:

```sh
npm ci && npm run build
npx playwright-core install chromium
node scripts/lms-moodle-check.mjs   # test/lms/moodle/compose.yml
node scripts/lms-ilias-check.mjs    # test/lms/ilias/compose.yml
```

Both bind to 127.0.0.1 only, use random throwaway passwords, and remove
their containers and volumes at the end (`--keep` leaves them running,
`--remove-images` also removes the images). The GitHub workflow
`.github/workflows/lms.yml` runs both on demand and on pull requests that
change the SCORM code.

| Platform | Version | Images | Result |
|---|---|---|---|
| Moodle | 5.3.0 (LTS, Build 20261005), PHP 8.3, PostgreSQL 17.11 | `moodlehq/moodle-php-apache:8.3-bookworm` (Moodle HQ), `postgres:17.11`, Moodle release archive checked by SHA-256 | All checks pass |
| ILIAS | 11.5.0, PHP 8.3, MariaDB 10.11.19 | `srsolutions/ilias:11.5-php8.3-apache` (sr solutions), `mariadb:10.11.19` | All checks pass |

What is checked, in both: the package imports as SCORM 1.2 with one SCO per
module in course order; a pass is stored as `passed` with score 100 (min 0,
max 100); a fail as `failed` with its score, and a retry replaces it; a
failed retry after a pass keeps the pass and its score; closing the window
halfway stores `incomplete`, `cmi.core.exit` `suspend`, the chosen answers
in `cmi.suspend_data`, the section in `cmi.core.lesson_location` and the
time, and reopening restores the answers; after all modules every SCO is
`passed` with exit normal, no saved place and a total time. In Moodle also:
the gradebook grade (100, average of module scores), activity completion,
returning to a module in the same player visit, and Preview recording
nothing. In ILIAS also: learning progress "completed" at 100 %, and a copy
with learning progress deactivated (no credit) recording no score.

### Settings that matter

**Moodle.** Under *Completion conditions*, choose *Add requirements*, *Require
status: Passed*, and *Require all scos to return completion status*.
*Require status* alone is met as soon as any one module is passed. A grading
method of *Average grade* (or *Learning objects*) reflects all modules;
the default *Highest grade* reports the best single module.

**ILIAS.** Turn on learning progress (*Administration > Statistics and
Learning Progress*) and set the module's *Learning Progress* to *Status is
determined by a collection of SCORM items*, with all items selected. With
learning progress deactivated, ILIAS runs the module with
`cmi.core.credit` `no-credit` and keeps no score or status from it; the page
then tells the learner the result is not recorded, and ILIAS itself marks
each opened module `completed`.

### Platform behaviour found in testing

- Moodle 5.3 adds each session's time to the total it loaded when its player
  opened. If a learner returns to a module in the same player visit, the
  module's `cmi.core.total_time` is replaced, not added to (seen: 0.76 s
  after the first visit, 0.30 s after the second). Separate visits add up
  correctly. ILIAS adds up correctly in both cases.
- Moodle 5.3 also computes `cmi.core.entry` once per player visit, which is
  why the page resumes from suspend data when the entry value is stale.
- Moodle 5.3 changes `not attempted` to `completed` when a Preview session
  ends, unless the SCO sets a status; the page sets `browsed`.
- When a window closes, both platforms send the last data with
  `navigator.sendBeacon`; the checks wait for it to arrive.

## xAPI

`groundwork record export --format xapi --account-home-page https://... --out
statements.json` writes one xAPI 1.0.3 statement per record:

| Record result | Verb | Defined in |
|---|---|---|
| passed | `http://adlnet.gov/expapi/verbs/passed` | ADL SCORM profile (`https://w3id.org/xapi/scorm`) |
| failed | `http://adlnet.gov/expapi/verbs/failed` | ADL SCORM profile |
| completed | `http://adlnet.gov/expapi/verbs/completed` | ADL SCORM profile |
| attended | `http://adlnet.gov/expapi/verbs/attended` | ADL vocabulary (`https://w3id.org/xapi/adl`) |

- Actor: an Agent (`objectType` `Agent`) with `account.homePage` (your HR or
  LMS system, given with `--account-home-page`) and `account.name` (the
  record's person).
- Object: activity `<base><course id>/<activity id>`, type
  `http://adlnet.gov/expapi/activities/module` for course modules. The
  default base is `urn:groundwork:`; use `--activity-base
  https://your.domain/activities/` if your LRS needs URLs.
- Context: parent activity `<base><course id>`, type
  `http://adlnet.gov/expapi/activities/course`; platform `Groundwork`.
- Result: score (scaled, raw, min 0, max 100) when the record has one;
  `success` for passed or failed; `completion` except for failed.
- Timestamp: the record date at 00:00 UTC.
- Statement id: a UUID version 5 derived from the record's content and the
  time it was recorded, so exporting again produces the same ids, also after
  `record erase` rewrote the chain.

The statements are written to a file. Groundwork does not send them to an
LRS; use your LRS's import or API.

## Importing completions

- **xAPI** (`record import --format xapi`): a JSON array of statements, or an
  LRS `StatementResult` object (`{"statements": [...]}`). Statements with the
  four verbs above about this course's activities are imported. The actor
  must be a single person: statements by a Group, or by an actor with more
  than one identifier (xAPI 1.0.3, Data 2.4.2), are skipped. Export from
  your LRS without voided statements: statements voided elsewhere cannot be
  recognised from the statements alone. The record date is the calendar date written in each
statement's `timestamp` (its own time zone), not converted to UTC. If the LRS
returns a `more` link,
  the result is paged; fetch every page and import each one (Groundwork does
  not fetch anything itself).
- **CSV** (`record import --format csv`): SCORM 1.2 defines the run-time data
  model but no export file format, and LMS reports differ. Map your report's
  columns with `--column person=...`, `activity=...`, `date=...`,
  `result=...` and optionally `score=...` and `role=...`. Result values may
  be `passed`, `failed`, `completed`, `attended`, or the SCORM 1.2
  `cmi.core.lesson_status` values `incomplete`, `browsed` and `not attempted`
  (these rows are skipped). Activity values must be module ids (for example
  `ai-basics`).
