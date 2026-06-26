import type {FilterInput, FilterOptions} from './keyed-filter.js';

/**
 * Emit rows of `primary` whose key is present in `probe` (a sorted-stream semi-join filter — whole rows pass, no combine).
 *
 * @see https://github.com/uhop/stream-sorting/wiki/matching
 */
declare function matching<T>(
  primary: FilterInput<T>,
  probe: FilterInput,
  options?: FilterOptions
): AsyncGenerator<T, void, void>;

export default matching;
export {matching};
