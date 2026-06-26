import type {FilterInput, FilterOptions} from './keyed-filter.js';

/**
 * Emit rows of `primary` whose key is absent from `probe` (a sorted-stream anti-join filter — whole rows pass, no combine).
 *
 * @see https://github.com/uhop/stream-sorting/wiki/unmatched
 */
declare function unmatched<T>(
  primary: FilterInput<T>,
  probe: FilterInput,
  options?: FilterOptions
): AsyncGenerator<T, void, void>;

export default unmatched;
export {unmatched};
