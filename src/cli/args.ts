// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Strict command-line option parsing: only declared options, each value
 * checked for length and NUL characters.
 *
 * @packageDocumentation
 */

/** Kind of an option. */
export type OptionKind = 'string' | 'boolean' | 'multi';

/** Declared options of a command. */
export type OptionSpec = Readonly<Record<string, OptionKind>>;

/** Parsed options. */
export interface ParsedArgs {
  readonly strings: ReadonlyMap<string, string>;
  readonly multi: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlySet<string>;
  readonly positional: readonly string[];
}

/** Error in the command line; the message is safe to show. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Maximum length of one argument. */
export const MAX_ARG_LENGTH = 4096;
/** Maximum number of values of a repeatable option. */
export const MAX_MULTI = 50;

/** Parses `args` against `spec`. Supports `--name value` and `--name=value`. */
export function parseArgs(args: readonly string[], spec: OptionSpec, maxPositional = 0): ParsedArgs {
  const strings = new Map<string, string>();
  const multi = new Map<string, string[]>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg.length > MAX_ARG_LENGTH || arg.includes('\0')) throw new UsageError('An argument is too long or contains a NUL character.');
    if (!arg.startsWith('--')) {
      if (positional.length >= maxPositional) throw new UsageError(`Unexpected argument ${JSON.stringify(arg.slice(0, 80))}.`);
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    const kind = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (kind === undefined) throw new UsageError(`Unknown option --${name.slice(0, 40)}.`);
    if (kind === 'boolean') {
      if (eq >= 0) throw new UsageError(`--${name} takes no value.`);
      flags.add(name);
      continue;
    }
    let value: string;
    if (eq >= 0) value = arg.slice(eq + 1);
    else {
      const next = args[i + 1];
      if (next === undefined || (next.startsWith('--') && next !== '-')) throw new UsageError(`--${name} needs a value.`);
      if (next.length > MAX_ARG_LENGTH || next.includes('\0')) throw new UsageError('An argument is too long or contains a NUL character.');
      value = next;
      i += 1;
    }
    if (kind === 'multi') {
      const list = multi.get(name) ?? [];
      if (list.length >= MAX_MULTI) throw new UsageError(`--${name} is given too often.`);
      list.push(value);
      multi.set(name, list);
    } else {
      if (strings.has(name)) throw new UsageError(`--${name} is given more than once.`);
      strings.set(name, value);
    }
  }
  return { strings, multi, flags, positional };
}

/** Returns a required string option or throws. */
export function required(args: ParsedArgs, name: string): string {
  const v = args.strings.get(name);
  if (v === undefined || v === '') throw new UsageError(`--${name} is required.`);
  return v;
}
