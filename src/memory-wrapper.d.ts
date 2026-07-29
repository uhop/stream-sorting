import {ObjectStreamWrapper} from './wrapper.js';

/**
 * In-memory `ObjectStreamWrapper` for tests, small data, and benchmarks.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/MemoryWrapper
 */
declare class MemoryWrapper<T = unknown> extends ObjectStreamWrapper<T> {}

export default MemoryWrapper;
export {MemoryWrapper};
