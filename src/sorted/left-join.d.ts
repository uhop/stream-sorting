import type {JoinInput, JoinOptions, Bag} from './join.js';

/**
 * Left outer join of sorted streams: the first named input is required, the rest are null-filled when absent.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/leftJoin
 */
declare function leftJoin<I extends Record<string, JoinInput>, R = Bag<I>>(
  inputs: I,
  options?: JoinOptions<I, R>
): AsyncGenerator<R, void, void>;

export default leftJoin;
export {leftJoin};
