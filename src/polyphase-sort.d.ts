import type {ObjectStreamWrapper} from './wrapper.js';

export interface PolyphaseSortProgressStats {
  phase: 'pre-sort' | 'merge' | 'final-merge';
  itemsRead: number;
  itemsWritten: number;
  passesComplete: number;
  virtualSeries: number;
  files: Array<{role: 'input' | 'output' | 'idle'; runsRemaining: number}>;
}

interface PolyphaseSortOptionsBase {
  batchSize?: number;
  stable?: boolean;
  onProgress?: (stats: PolyphaseSortProgressStats) => void;
  keepTempFiles?: boolean;
}

type PolyphaseSortComparator<T> =
  | {compare: (a: T, b: T) => number; lessFn?: undefined}
  | {compare?: undefined; lessFn: (a: T, b: T) => boolean};

type PolyphaseSortStorage =
  | {
      files: ObjectStreamWrapper<unknown>[];
      k?: undefined;
      tmpDir?: undefined;
      createWrapper?: undefined;
    }
  | {
      files?: undefined;
      k?: number;
      tmpDir: string;
      createWrapper?: undefined;
    }
  | {
      files?: undefined;
      k?: number;
      tmpDir?: undefined;
      createWrapper: (fileIndex: number) => ObjectStreamWrapper<unknown>;
    };

export type PolyphaseSortOptions<T = unknown> = PolyphaseSortOptionsBase &
  PolyphaseSortComparator<T> &
  PolyphaseSortStorage;

/**
 * Sorts an object stream that does not fit in memory, using a fixed number of files.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/polyphaseSort
 */
declare function polyphaseSort<T>(
  input: AsyncIterable<T> | Iterable<T>,
  options: PolyphaseSortOptions<T>
): AsyncGenerator<T, void, void>;

export default polyphaseSort;
export {polyphaseSort};
