import type {SortOptions} from '../sort.js';

export interface SortJsonlOptions {
  /** Parse one JSONL line into an item. Default: `JSON.parse`. */
  parse?: (line: string) => unknown;
  /** Serialize one item into a JSONL line (no trailing newline). Default: `JSON.stringify`. */
  stringify?: (item: unknown) => string;
}

/**
 * Sort a text JSONL stream: parse lines to objects (via `stream-chain`), sort with `sort`, re-emit JSONL text (one newline-terminated line per item). Accepts all `sort` options plus `parse` / `stringify`.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/sortJsonl
 */
declare function sortJsonl<T = unknown>(
  input: AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>,
  options: SortOptions<T> & SortJsonlOptions
): AsyncGenerator<string, void, void>;

export default sortJsonl;
export {sortJsonl};
