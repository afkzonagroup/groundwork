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

1. calls `LMSInitialize("")`, and sets `cmi.core.lesson_status` to
   `incomplete` if it was `not attempted`;
2. when the learner checks the quiz, sets `cmi.core.score.min` (0),
   `cmi.core.score.max` (100), `cmi.core.score.raw` and
   `cmi.core.lesson_status` (`passed` or `failed`), then `LMSCommit("")`.
   After an earlier `passed`, a later failed attempt changes nothing: neither
   the status nor the score, because an LMS that applies the mastery score
   could otherwise turn the pass into a fail;
3. when the page is closed, sets `cmi.core.session_time` (CMITimespan,
   `HHHH:MM:SS.SS`) and `cmi.core.exit` (empty), then `LMSCommit("")` and
   `LMSFinish("")`.

`groundwork check-scorm course.zip` checks the structure of any SCORM 1.2
package (manifest rules, references, files present, safe paths).

**Limitations.** The package does not include the IMS and ADL XML Schema
files (`imscp_rootv1p1p2.xsd`, `adlcp_rootv1p2.xsd`, `ims_xml.xsd`) and the
manifest does not reference them, because their licences are not ours to
grant. The ADL SCORM 1.2 conformance test suite and some LMS import
validators expect them; if yours does, add them from ADL to the root of the
package. The runtime was tested in Chromium against a SCORM 1.2 API stub that
records every call; it has not yet been tested in a live LMS.

## xAPI

`groundwork record export --format xapi --account-home-page https://... --out
statements.json` writes one xAPI 1.0.3 statement per record:

| Record result | Verb | Defined in |
|---|---|---|
| passed | `http://adlnet.gov/expapi/verbs/passed` | ADL SCORM profile (`https://w3id.org/xapi/scorm`) |
| failed | `http://adlnet.gov/expapi/verbs/failed` | ADL SCORM profile |
| completed | `http://adlnet.gov/expapi/verbs/completed` | ADL SCORM profile |
| attended | `http://adlnet.gov/expapi/verbs/attended` | ADL vocabulary (`https://w3id.org/xapi/adl`) |

- Actor: an Agent with `account.homePage` (your HR or LMS system, given with
  `--account-home-page`) and `account.name` (the record's person).
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
  four verbs above about this course's activities are imported. Export from
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
