import type {SetOpOptions} from './set-ops.js';

/**
 * K-way merge of sorted streams into one sorted stream; duplicates across streams are preserved (use `union` to dedup).
 *
 * @see https://github.com/uhop/stream-sorting/wiki/merge
 */
declare function merge<T>(
  streams: Array<AsyncIterable<T> | Iterable<T>>,
  options?: SetOpOptions
): AsyncGenerator<T, void, void>;

export default merge;
export {merge};
