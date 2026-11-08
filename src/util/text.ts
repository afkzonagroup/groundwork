// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Small text helpers shared by the content parser, records and CLI.
 *
 * @packageDocumentation
 */

/**
 * Control, format (including bidirectional and zero-width), line separator
 * and paragraph separator characters: Unicode categories Cc, Cf, Zl, Zp.
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Same as {@link UNSAFE} but allows tab, line feed and carriage return. */
const UNSAFE_IN_TEXT = /[^\t\n\r\P{Cc}]|[\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * True if `value` contains a control, format, line-separator or
 * paragraph-separator character. Used for single-line values such as names
 * and identifiers.
 */
export function hasUnsafeCharacter(value: string): boolean {
  return UNSAFE.test(value);
}

/**
 * True if multi-line `text` contains such a character other than tab, line
 * feed or carriage return. Used for whole files.
 */
export function hasUnsafeTextCharacter(text: string): boolean {
  return UNSAFE_IN_TEXT.test(text);
}

/** True if `value` is a valid calendar date in the form YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= days;
}
