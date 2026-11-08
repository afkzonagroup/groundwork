// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A small ZIP writer and reader on top of node:zlib (raw DEFLATE), enough
 * for SCORM content packages. Written here instead of adding a dependency:
 * the format subset is small (no ZIP64, no encryption, no data
 * descriptors), and node:zlib does the compression.
 *
 * The writer is deterministic: fixed timestamps (1980-01-01 00:00) and the
 * entry order given. The reader is for checking packages: it enforces entry
 * count, size and compression-ratio limits and rejects unsafe names.
 *
 * Format: PKWARE APPNOTE.TXT, sections 4.3.7 (local file header), 4.3.12
 * (central directory header) and 4.3.16 (end of central directory record).
 *
 * @packageDocumentation
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** One file in an archive. */
export interface ZipEntry {
  /** Path inside the archive with `/` separators. */
  readonly name: string;
  readonly data: Uint8Array;
}

/** Error for malformed or unsafe archives; the message is safe to show. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as used by ZIP. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * True if `name` is a safe relative archive path: segments of letters,
 * digits, `.`, `_` and `-`, no empty, `.` or `..` segments, no leading `/`.
 */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  const segments = name.split('/');
  return segments.every((s) => /^[A-Za-z0-9._-]{1,100}$/.test(s) && s !== '.' && s !== '..');
}

const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;
const MAX_ENTRIES = 0xfffe;
const MAX_ARCHIVE_BYTES = 0xfffffffe;

/** Creates a ZIP archive. Entries are deflated when that makes them smaller. */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new ZipError('Too many entries for a ZIP archive without ZIP64.');
  const names = new Set<string>();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) throw new ZipError(`Unsafe entry name ${JSON.stringify(entry.name)}.`);
    if (names.has(entry.name)) throw new ZipError(`Duplicate entry name ${JSON.stringify(entry.name)}.`);
    names.add(entry.name);
    const name = new TextEncoder().encode(entry.name);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? new Uint8Array(deflated) : entry.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); // time 00:00:00
    lv.setUint16(12, DOS_DATE_1980_01_01, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by: MS-DOS, 2.0
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, DOS_DATE_1980_01_01, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
    if (offset > MAX_ARCHIVE_BYTES) throw new ZipError('Archive too large for ZIP without ZIP64.');
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let pos = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** Limits for {@link readZip}. */
export interface ZipReadLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  /** Maximum ratio of uncompressed to compressed size for one entry. */
  readonly maxRatio: number;
}

/** Default reading limits. */
export const DEFAULT_ZIP_LIMITS: ZipReadLimits = { maxEntries: 1000, maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024, maxRatio: 200 };

/**
 * Reads an archive written without ZIP64 and without encryption. Uses the
 * central directory, checks each local header against it, and verifies
 * CRC-32 and sizes.
 */
export function readZip(bytes: Uint8Array, limits: ZipReadLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEnd = Math.max(0, bytes.length - 22 - 0xffff);
  let endPos = -1;
  for (let i = bytes.length - 22; i >= minEnd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      endPos = i;
      break;
    }
  }
  if (endPos < 0) throw new ZipError('Not a ZIP archive (no end of central directory record).');
  const count = view.getUint16(endPos + 10, true);
  const cdSize = view.getUint32(endPos + 12, true);
  const cdOffset = view.getUint32(endPos + 16, true);
  if (view.getUint16(endPos + 4, true) !== 0 || view.getUint16(endPos + 8, true) !== count) throw new ZipError('Multi-disk archives are not supported.');
  if (count > limits.maxEntries) throw new ZipError(`The archive has more than ${limits.maxEntries} entries.`);
  if (cdOffset + cdSize > endPos) throw new ZipError('Central directory is outside the archive.');
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let total = 0;
  let p = cdOffset;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let n = 0; n < count; n++) {
    if (p + 46 > endPos || view.getUint32(p, true) !== 0x02014b50) throw new ZipError('Malformed central directory.');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLen > endPos) throw new ZipError('Malformed central directory.');
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    } catch {
      throw new ZipError('Entry name is not valid UTF-8.');
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') && size === 0) continue; // directory entry
    if (!isSafeEntryName(name)) throw new ZipError(`Unsafe entry name ${JSON.stringify(name.slice(0, 100))}.`);
    if (names.has(name)) throw new ZipError(`Duplicate entry ${JSON.stringify(name)}.`);
    names.add(name);
    if (flags & 0x1) throw new ZipError('Encrypted entries are not supported.');
    if (method !== 0 && method !== 8) throw new ZipError(`Unsupported compression method ${method}.`);
    if (size > limits.maxEntryBytes) throw new ZipError(`Entry ${name} is larger than ${limits.maxEntryBytes} bytes.`);
    if (compressed > 0 && size / compressed > limits.maxRatio) throw new ZipError(`Entry ${name} has a suspicious compression ratio.`);
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError(`The archive expands to more than ${limits.maxTotalBytes} bytes.`);
    if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw new ZipError(`Malformed local header for ${name}.`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressed > cdOffset) throw new ZipError(`Entry ${name} extends beyond its data.`);
    const raw = bytes.subarray(dataStart, dataStart + compressed);
    let data: Uint8Array;
    if (method === 0) {
      if (compressed !== size) throw new ZipError(`Size mismatch in stored entry ${name}.`);
      data = raw;
    } else {
      try {
        data = new Uint8Array(inflateRawSync(raw, { maxOutputLength: limits.maxEntryBytes }));
      } catch {
        throw new ZipError(`Cannot decompress ${name}.`);
      }
    }
    if (data.length !== size) throw new ZipError(`Size mismatch in ${name}.`);
    if (crc32(data) !== crc) throw new ZipError(`CRC mismatch in ${name}.`);
    entries.push({ name, data });
  }
  return entries;
}
