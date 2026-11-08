# Privacy, data minimisation and GDPR

Groundwork processes personal data in one place: training records. The
course pages process none. This page describes what is stored, where it
goes, and what an organisation should consider under the GDPR
([Regulation (EU) 2016/679](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679#art_5)).
It is general information, not legal advice.

## The course pages

- No personal data is asked for. Learners do not enter their name.
- Quiz answers stay in the page. Nothing is stored in the browser (no
  cookies, local storage or IndexedDB) and nothing is sent over the network;
  the Content Security Policy blocks network access (`connect-src 'none'`).
- In a SCORM package, the page reports only the quiz score (0 to 100),
  passed or failed, and the session time to the LMS through the SCORM 1.2
  API (`cmi.core.score.raw`, `cmi.core.lesson_status`,
  `cmi.core.session_time`). The LMS already knows who the learner is.

## Training records

A record holds only:

| Field | Why it is needed |
|---|---|
| `person` | To show who took part. Use an employee id where possible, so names stay in the HR system. |
| `role` | Which version of the course the person took. |
| `activity` | Which module or other measure (for example a tool briefing). |
| `date` | When. |
| `result` | passed, failed, completed or attended. |
| `score` | Optional, 0 to 100. Leave it out if you do not need it. |
| `source`, `ts`, `seq`, `prev`, `hash`, `mac` | Technical fields: where the record came from, when it was added, and the hash chain. |

There is no free-text field, so no one can add notes about a person.

The AI Act does not require training records or prescribe their form.
Records are a good way to show what measures an organisation took; keep only
what that purpose needs.

## Points for the organisation (the controller)

- **Purpose and legal basis.** Decide and document why you keep records
  (for example, to show the AI literacy measures you took) and on which legal
  basis under Article 6 GDPR. Tell staff, as Articles 13 and 14 require.
- **Data minimisation** (Article 5(1)(c)). Prefer employee ids. Leave out
  scores if pass or fail is enough.
- **Storage limitation** (Article 5(1)(e)). Decide how long to keep records.
  `groundwork record erase --before YYYY-MM-DD` writes a new file without
  older records.
- **Erasure and rectification** (Articles 16 and 17). Records are
  append-only, so a correction is a new record. To remove a person's
  records, `groundwork record erase --person ID` writes a new, verified chain
  without them. Its header names the old chain, its head hash and how many
  records were removed, so the gap is visible without keeping the removed
  data. Then replace the old file and delete it and its backups.
- **Security** (Article 32). Records files are created with mode 0600. Keep
  them on access-controlled storage. Use HMAC (`--hmac`) and keep the key in
  a secrets store, not next to the file. Store the head hash printed by
  `verify` somewhere separate (for example in a ticket or signed email) to
  detect removal of recent records.
- **Exports.** CSV, JSON and xAPI exports contain the same personal data.
  They are written with mode 0600. Treat them like the records file.
- **xAPI imports with email addresses.** By default only xAPI actors with an
  account id are imported. `--allow-email` stores the email address as the
  person; use it only if you have no account ids.

## Data flows

1. The administrator runs `groundwork record add` or `import`. The CLI reads
   only the file named with `--input`, and writes only the records file.
2. `groundwork record export` writes only to the file named with `--out`
   (or to standard output with `--out -`).
3. Nothing is sent over the network. There is no telemetry.
