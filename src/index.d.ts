/// <reference types="node" />

import {TypedReadable, TypedWritable} from 'stream-chain/typed-streams.js';

/**
 * Wrapper contract for ferrying objects to and from some backing storage. The
 * sort algorithms only see object streams; the wrapper hides the rest.
 *
 * Mode-exclusive: a wrapper is `idle`, `writing`, or `reading` at any moment.
 * - `openWrite()` while `writing` re-opens and discards previous content.
 * - `openWrite()` while `reading` is an error — call `close()` first.
 * - `openRead()` while `writing` is an error — call `close()` first.
 * - `openRead()` while `reading` re-opens at the beginning.
 *
 * Both built-in algorithms (`sort`, `polyphase-sort`) write-then-read; never
 * both at once. Custom wrappers MUST honor the mode-exclusion rules.
 */
export interface ObjectStreamWrapper<T = unknown> {
  /** Returns an object-mode Writable that consumes items of `T`. */
  openWrite(): TypedWritable<T>;
  /** Returns an object-mode Readable that produces items of `T` in write order. */
  openRead(): TypedReadable<T>;
  /** Releases handles for the current mode. Idempotent. */
  close(): Promise<void>;
  /** Removes the underlying storage (implicitly closes first). Idempotent. */
  delete(): Promise<void>;
}

export {default as MemoryWrapper} from './memory-wrapper.js';
export {default as LocalFileWrapper} from './local-file-wrapper.js';
