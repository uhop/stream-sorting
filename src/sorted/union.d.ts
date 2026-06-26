import type {SetOpOptions} from './set-ops.js';

/**
 * Sorted merge of streams with cross-stream deduplication — each distinct value (by the comparator) is emitted once.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/union
 */
declare function union<T>(
  streams: Array<AsyncIterable<T> | Iterable<T>>,
  options?: SetOpOptions
): AsyncGenerator<T, void, void>;

export default union;
export {union};
