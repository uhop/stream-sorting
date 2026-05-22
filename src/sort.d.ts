import type {ObjectStreamWrapper} from './wrapper.js';

export interface SortProgressStats {
  phase: 'pre-sort' | 'final-merge';
  itemsRead: number;
  itemsWritten: number;
  runsCreated: number;
}

interface SortOptionsBase {
  /** Soft cap on in-memory items per run. Default: 10000. */
  batchSize?: number;
  /**
   * Default `true`. When `true`, items with equal comparator output are emitted
   * in input order; an internal monotonic sequence tag is added to each item
   * for the tiebreaker (and stripped before emission). Set `false` if your
   * comparator already encodes a tiebreaker — saves ~8 bytes per item on disk
   * plus one extra comparison per merge step.
   */
  stable?: boolean;
  /** Called on natural event boundaries (run-complete during pre-sort, merge-start). */
  onProgress?: (stats: SortProgressStats) => void;
  /** When `true`, skips wrapper deletion at the end. Default: `false`. */
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
 * External merge sort over an object stream of any cardinality.
 *
 * Pulls items from `input` into in-memory buffers of `batchSize`, sorts each
 * buffer with `Array.prototype.sort(compare)`, and flushes it to a fresh
 * `ObjectStreamWrapper` as a sorted run. Once `input` is exhausted, k-way-merges
 * the runs via `stream-join`'s `mergeSorted` and yields the result in sorted order.
 *
 * When `input` fits in a single batch, takes an in-memory fast path — no
 * wrapper involved.
 *
 * Returns an `AsyncIterable<T>`. Convert at the boundary:
 *
 * ```js
 * for await (const item of sort(input, opts)) ...                      // direct
 * readableFrom(sort(input, opts)).pipe(downstream)                     // Node Readable
 * ReadableStream.from(sort(input, opts)).pipeTo(webDst)                // Web ReadableStream
 * ```
 */
declare function sort<T>(
  input: AsyncIterable<T> | Iterable<T>,
  options: SortOptions<T>
): AsyncGenerator<T, void, void>;

export default sort;
export {sort};
