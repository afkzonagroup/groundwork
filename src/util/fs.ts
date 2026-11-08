// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * File access with limits. Reads check the size on the open descriptor and
 * refuse symbolic links, FIFOs and devices. Writes never follow a symbolic
 * link at the target and never overwrite unless asked.
 *
 * @packageDocumentation
 */

import { constants } from 'node:fs';
import { type FileHandle, lstat, mkdir, open, unlink } from 'node:fs/promises';

/** Error with a message that is safe to show to the user. */
export class FileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileError';
  }
}

const NONBLOCK = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0;
const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

/** Rejects empty, overlong or NUL-containing paths. */
export function assertPath(path: string): void {
  if (path.length === 0 || path.length > 4096 || path.includes('\0')) throw new FileError('Invalid file path.');
}

function show(path: string): string {
  return JSON.stringify(path.length > 200 ? `${path.slice(0, 200)}...` : path);
}

/**
 * Reads a regular file of at most `maxBytes` bytes. Symbolic links are
 * refused (O_NOFOLLOW where the platform has it, and an lstat check).
 */
export async function readFileLimited(path: string, maxBytes: number): Promise<Uint8Array> {
  assertPath(path);
  let handle: FileHandle;
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new FileError(`${show(path)} is a symbolic link; refusing to read it.`);
    // O_NONBLOCK: opening a FIFO must not hang; such files are rejected below.
    handle = await open(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FileError(`Cannot open ${show(path)} for reading.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FileError(`${show(path)} is not a regular file.`);
    if (info.size > maxBytes) throw new FileError(`${show(path)} is ${info.size} bytes; the limit is ${maxBytes} bytes.`);
    const buffer = new Uint8Array(Math.min(info.size, maxBytes) + 1);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
      if (offset > maxBytes) throw new FileError(`${show(path)} is larger than the limit of ${maxBytes} bytes.`);
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

/** Options for {@link writeFileSafe}. */
export interface WriteOptions {
  /** Overwrite an existing regular file. */
  readonly force: boolean;
  /** File mode for new files (default 0o600). */
  readonly mode?: number;
}

/**
 * Writes a file. Without `force`, fails if the file exists. Never writes
 * through a symbolic link at the target.
 */
export async function writeFileSafe(path: string, content: string | Uint8Array, options: WriteOptions): Promise<void> {
  assertPath(path);
  const mode = options.mode ?? 0o600;
  const flags = options.force
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW | NONBLOCK
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | NONBLOCK;
  let handle: FileHandle;
  try {
    if (options.force) {
      const existing = await lstat(path).catch(() => undefined);
      if (existing?.isSymbolicLink()) throw new FileError(`${show(path)} is a symbolic link; refusing to write through it.`);
    }
    handle = await open(path, flags, mode);
  } catch (error) {
    if (error instanceof FileError) throw error;
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'EEXIST') throw new FileError(`${show(path)} already exists. Use --force to overwrite it.`);
    if (code === 'ELOOP') throw new FileError(`${show(path)} is a symbolic link; refusing to write through it.`);
    throw new FileError(`Cannot write ${show(path)}.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FileError(`${show(path)} is not a regular file.`);
    if (options.force) await handle.chmod(mode);
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

/**
 * Appends one chunk to an existing regular file opened with O_APPEND,
 * refusing symbolic links.
 */
export async function appendFileSafe(path: string, content: string): Promise<void> {
  assertPath(path);
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_APPEND | NOFOLLOW | NONBLOCK);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ELOOP') throw new FileError(`${show(path)} is a symbolic link; refusing to write through it.`);
    throw new FileError(`Cannot open ${show(path)} for appending.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FileError(`${show(path)} is not a regular file.`);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Creates a directory (and parents) if needed. Refuses an existing path
 * that is a symbolic link or not a directory.
 */
export async function ensureDirectory(path: string): Promise<void> {
  assertPath(path);
  const info = await lstat(path).catch(() => undefined);
  if (info) {
    if (info.isSymbolicLink()) throw new FileError(`${show(path)} is a symbolic link; refusing to use it as an output directory.`);
    if (!info.isDirectory()) throw new FileError(`${show(path)} exists and is not a directory.`);
    return;
  }
  try {
    await mkdir(path, { recursive: true, mode: 0o755 });
  } catch {
    throw new FileError(`Cannot create directory ${show(path)}.`);
  }
}

/**
 * Takes an exclusive lock by creating `<path>.lock` with O_EXCL. Returns a
 * release function. Fails if the lock exists.
 */
export async function acquireLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  assertPath(lockPath);
  let handle: FileHandle;
  try {
    handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
  } catch {
    throw new FileError(`${show(path)} is locked by another process (${show(lockPath)} exists). If no other process is running, delete the lock file.`);
  }
  await handle.writeFile(`${process.pid}\n`, 'utf8');
  await handle.close();
  return async () => {
    await unlink(lockPath).catch(() => undefined);
  };
}
