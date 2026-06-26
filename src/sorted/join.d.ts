import type {KeyComparatorOptions} from '../ordering.js';

export interface JoinInput<T = unknown, K = unknown> {
  input: AsyncIterable<T> | Iterable<T>;
  key?: (item: T) => K;
  optional?: boolean;
}

export type ItemOf<D> = D extends JoinInput<infer T, any> ? T : never;
export type Bag<I> = {[K in keyof I]: ItemOf<I[K]> | null};

export interface JoinOptions<
  I = Record<string, JoinInput>,
  R = Bag<I>
> extends KeyComparatorOptions {
  combine?: (bag: Bag<I>) => R | undefined;
  maxGroupSize?: number;
}

/**
 * Inner join of sorted streams by key (Cartesian product on equal keys); a per-input `optional` flag null-fills that side, generalizing to any outer shape.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/join
 */
declare function join<I extends Record<string, JoinInput>, R = Bag<I>>(
  inputs: I,
  options?: JoinOptions<I, R>
): AsyncGenerator<R, void, void>;

export default join;
export {join};
