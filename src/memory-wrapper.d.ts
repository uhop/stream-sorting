/// <reference types="node" />

import {TypedReadable, TypedWritable} from 'stream-chain/typed-streams.js';

/**
 * In-memory `ObjectStreamWrapper`. Backing store is a plain array; items are
 * pushed on write and replayed on read. Useful for tests, small data, and
 * benchmarking the sort algorithms independently of disk.
 */
declare class MemoryWrapper<T = unknown> {
  openWrite(): TypedWritable<T>;
  openRead(): TypedReadable<T>;
  close(): Promise<void>;
  delete(): Promise<void>;
}

export default MemoryWrapper;
