import {ObjectStreamWrapper} from './wrapper.js';

/**
 * In-memory `ObjectStreamWrapper`. Backing store is a plain array; items are
 * pushed on write and replayed on read. Useful for tests, small data, and
 * benchmarking the sort algorithms independently of disk.
 */
declare class MemoryWrapper<T = unknown> extends ObjectStreamWrapper<T> {}

export default MemoryWrapper;
