import type {ObjectStreamWrapper} from './wrapper.js';

export interface SortProgressStats {
  phase: 'pre-sort' | 'final-merge';
  itemsRead: number;
  itemsWritten: number;
  runsCreated: number;
}

interface SortOptionsBase {
  batchSize?: number;
  stable?: boolean;
  onProgress?: (stats: SortProgressStats) => void;
  keepTempFiles?: boolean;
}

type SortComparator<T> =
  | {compare: (a: T, b: T) => number; lessFn?: undefined}
  | {compare?: undefined; lessFn: (a: T, b: T) => boolean};

type SortStorage =
  | {tmpDir: string; createWrapper?: undefined}
  | {tmpDir?: undefined; createWrapper: (runIndex: number) => ObjectStreamWrapper<unknown>};

export type SortOptions<T = unknown> = SortOptionsBase & SortComparator<T> & SortStorage;

/**
 * Sorts an object stream that does not fit in memory.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/sort
 */
declare function sort<T>(
  input: AsyncIterable<T> | Iterable<T>,
  options: SortOptions<T>
): AsyncGenerator<T, void, void>;

export default sort;
export {sort};
