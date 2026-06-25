import type {ObjectStreamWrapper} from './wrapper.js';

export interface PolyphaseSortProgressStats {
  phase: 'pre-sort' | 'merge' | 'final-merge';
  itemsRead: number;
  itemsWritten: number;
  /** Number of completed merge passes so far. */
  passesComplete: number;
  /** Count of imaginary (empty) runs padded in to reach a perfect Fibonacci distribution. */
  virtualSeries: number;
  /** Per-file roles for the current pass; reflects merge-phase state. */
  files: Array<{role: 'input' | 'output' | 'idle'; runsRemaining: number}>;
}

interface PolyphaseSortOptionsBase {
  /** Soft cap on in-memory items per initial run. Default: 10000. */
  batchSize?: number;
  /**
   * Default `true`. When `true`, items with equal comparator output keep their
   * input order via an internal monotonic sequence tag (stripped before
   * emission). Polyphase needs the tag because items are reshuffled across
   * passes; set `false` only if your comparator already encodes a tiebreaker.
   */
  stable?: boolean;
  /** Called on natural event boundaries (run-complete during pre-sort, pass-complete during merge). */
  onProgress?: (stats: PolyphaseSortProgressStats) => void;
  /** When `true`, skips wrapper deletion at the end. Default: `false`. */
  keepTempFiles?: boolean;
}

type PolyphaseSortComparator<T> =
  | {compare: (a: T, b: T) => number; lessFn?: undefined}
  | {compare?: undefined; lessFn: (a: T, b: T) => boolean};

type PolyphaseSortStorage =
  | {
      /** Explicit wrappers, one per file. `K = files.length` (minimum 3). User-owned: closed, not deleted. */
      files: ObjectStreamWrapper<unknown>[];
      k?: undefined;
      tmpDir?: undefined;
      createWrapper?: undefined;
    }
  | {
      files?: undefined;
      /** Number of files. Default 4 (3 inputs + 1 output). Minimum 3. */
      k?: number;
      /** Directory for the built-in `LocalFileWrapper` files. No default (Linux tmpfs footgun). */
      tmpDir: string;
      createWrapper?: undefined;
    }
  | {
      files?: undefined;
      /** Number of files. Default 4 (3 inputs + 1 output). Minimum 3. */
      k?: number;
      tmpDir?: undefined;
      /** Factory invoked `k` times to build the file wrappers. Algorithm-owned: deleted at the end. */
      createWrapper: (fileIndex: number) => ObjectStreamWrapper<unknown>;
    };

export type PolyphaseSortOptions<T = unknown> = PolyphaseSortOptionsBase &
  PolyphaseSortComparator<T> &
  PolyphaseSortStorage;

/**
 * Polyphase merge sort over an object stream of any cardinality — the
 * fixed-file-budget companion to {@link sort}.
 *
 * Pre-sorts `input` into `batchSize`-bounded sorted runs and distributes them
 * across `K - 1` input files following a generalized Fibonacci distribution
 * (padding with imaginary empty runs where the count is not perfect). It then
 * repeatedly merges the `K - 1` inputs into the single output file; whenever an
 * input drains, it becomes the next output and the old output rejoins the
 * inputs. The last merge is streamed straight to the caller. Uses exactly `K`
 * files regardless of input size — suited to bounded file budgets and storage
 * spread across drives / buckets / machines (one wrapper each).
 *
 * Returns an `AsyncIterable<T>`. Convert at the boundary:
 *
 * ```js
 * for await (const item of polyphaseSort(input, opts)) ...               // direct
 * readableFrom(polyphaseSort(input, opts)).pipe(downstream)              // Node Readable
 * ReadableStream.from(polyphaseSort(input, opts)).pipeTo(webDst)         // Web ReadableStream
 * ```
 *
 * When `input` fits in a single batch, takes an in-memory fast path — no
 * wrapper involved.
 */
declare function polyphaseSort<T>(
  input: AsyncIterable<T> | Iterable<T>,
  options: PolyphaseSortOptions<T>
): AsyncGenerator<T, void, void>;

export default polyphaseSort;
export {polyphaseSort};
