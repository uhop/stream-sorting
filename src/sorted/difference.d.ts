import type {SetOpOptions} from './set-ops.js';

/**
 * Values in the first stream not present in any of the remaining streams (deduplicated).
 *
 * @see https://github.com/uhop/stream-sorting/wiki/difference
 */
declare function difference<T>(
  streams: Array<AsyncIterable<T> | Iterable<T>>,
  options?: SetOpOptions
): AsyncGenerator<T, void, void>;

export default difference;
export {difference};
