# Records file format (groundwork-records, version 1)

A records file is UTF-8 JSON Lines: one JSON object per line, each line
ending with a line feed. The first line is a header; every other line is a
record. Lines are never changed; new records are appended.

## Canonical form

Every line must be in canonical form: object keys sorted by UTF-16 code
units, no whitespace, strings as `JSON.stringify` writes them, numbers only
as whole numbers. A line that is valid JSON but not canonical fails
verification (it was edited by hand or by another tool).

## Header

```json
{"chain":"<uuid>","created":"2026-11-08T12:00:00.000Z","format":"groundwork-records","hash":"<hex>","hmac":false,"keyCheck":null,"mac":null,"prev":"0000...0000","previous":null,"seq":0,"type":"header","v":1}
```

- `chain`: random UUID of this chain.
- `hmac`: whether every line carries an HMAC; `keyCheck`: the first 16 hex
  digits of HMAC-SHA256(key, "groundwork key check v1"), to tell a wrong key
  from tampering.
- `previous`: `null`, or `{"chain", "head", "removed", "reason"}` when the
  file was rewritten by `record erase` ("erasure" or "retention").
- `prev`: 64 zeros.

## Record

```json
{"activity":"ai-basics","date":"2026-11-01","hash":"<hex>","mac":null,"person":"E1001","prev":"<hash of previous line>","result":"passed","role":"staff","score":90,"seq":1,"source":"manual","ts":"2026-11-08T12:00:00.000Z","type":"record","v":1}
```

Field rules: see [privacy.md](privacy.md) and `validateRecordInput` in
`src/records/fields.ts`. `seq` counts up from 1 without gaps.

## Hashes and MACs

For each line, take the object without `hash` and `mac`, serialise it in
canonical form, and compute:

- `hash` = SHA-256 of those bytes, lower-case hex;
- `mac` = HMAC-SHA256 of the same bytes with the key, lower-case hex, or
  `null` when the file does not use HMAC.

`prev` of each line is the `hash` of the line before it. The `hash` of the
last line is the **head**. Store it somewhere else (for example in a ticket,
an email or a second system) and pass it to `groundwork record verify
--expect-head` to detect lines removed at the end.

## What verification detects

| Change | Without key | With HMAC key |
|---|---|---|
| A field changed, hash not updated | yes | yes |
| A field changed and its hash recomputed | yes (the next line no longer links) unless it is the last line | yes |
| All later lines recomputed too | no | yes |
| Lines deleted, inserted or reordered in the middle | yes | yes |
| Lines removed at the end | only with `--expect-head` | only with `--expect-head` |
| A completely new chain written by someone without the key | no | yes (a given key also rejects a chain without HMAC) |
| A new chain written by someone with the key | no | no |
