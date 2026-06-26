import type {SetOpOptions} from './set-ops.js';

/**
 * Values present in every input stream (deduplicated). Takes two or more sorted streams.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/intersection
 */
declare function intersection<T>(
  streams: Array<AsyncIterable<T> | Iterable<T>>,
  options?: SetOpOptions
): AsyncGenerator<T, void, void>;

export default intersection;
export {intersection};
