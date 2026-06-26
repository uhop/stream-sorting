export interface AggregateChild<T = unknown, K = unknown, A = unknown, R = unknown> {
  input: AsyncIterable<T> | Iterable<T>;
  key?: (item: T) => K;
  init?: () => A;
  fold?: (acc: A, item: T) => A;
  finalize?: (acc: A) => R;
  required?: boolean;
}

export interface AggregateMaster<T = unknown, K = unknown, A = unknown, R = unknown> {
  input: AsyncIterable<T> | Iterable<T>;
  key?: (item: T) => K;
  // Master rows sharing a key are folded into one base (default: the first row wins).
  init?: () => A;
  fold?: (acc: A, item: T) => A;
  finalize?: (acc: A) => R;
}

export interface AggregateOptions {
  compareKey?: (a: any, b: any) => number;
  lessKey?: (a: any, b: any) => boolean;
  combine?: (master: any, parts: Record<string, any>) => any;
  maxGroupSize?: number;
}

/**
 * Group sorted child streams under a master by key, folding each child's per-key group; the master is either a `{input, key}` stream (external spine) or a `key => object` function (group-by, spine = the children's own keys).
 *
 * @see https://github.com/uhop/stream-sorting/wiki/aggregate
 */
declare function aggregate<R = any>(
  master: AggregateMaster | ((key: any) => any),
  children: Record<string, AggregateChild>,
  options?: AggregateOptions
): AsyncGenerator<R, void, void>;

export default aggregate;
export {aggregate};
