import type {JoinInput, JoinOptions, Bag} from './join.js';

/**
 * Full outer join of sorted streams: every named input is optional, so a row emits for any key present on any side, null-filling the rest.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/fullJoin
 */
declare function fullJoin<I extends Record<string, JoinInput>, R = Bag<I>>(
  inputs: I,
  options?: JoinOptions<I, R>
): AsyncGenerator<R, void, void>;

export default fullJoin;
export {fullJoin};
