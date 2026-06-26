export declare const identity: <T>(x: T) => T;

export declare function defaultCompare<T>(a: T, b: T): number;

export type ComparatorOption<T> =
  | {compare: (a: T, b: T) => number; lessFn?: undefined}
  | {compare?: undefined; lessFn: (a: T, b: T) => boolean};

export interface KeyComparatorOptions {
  compareKey?: (a: any, b: any) => number;
  lessKey?: (a: any, b: any) => boolean;
}

export interface NormalizedComparator<T> {
  compare: (a: T, b: T) => number;
  lessFn: (a: T, b: T) => boolean;
}

export declare function normalizeComparator<T>(
  opts: {compare?: (a: T, b: T) => number; lessFn?: (a: T, b: T) => boolean},
  label: string
): NormalizedComparator<T>;

export declare function resolveComparator<T>(
  compare: ((a: T, b: T) => number) | undefined,
  lessFn: ((a: T, b: T) => boolean) | undefined,
  label: string
): NormalizedComparator<T>;

export declare function validateInput(input: unknown, label: string): void;

export interface Stability {
  wrap: (item: unknown) => unknown;
  unwrap: (envelope: unknown) => unknown;
  runCompare: (a: unknown, b: unknown) => number;
  mergeLess: (a: unknown, b: unknown) => boolean;
}

export declare function makeStability(
  stable: boolean,
  compare: (a: unknown, b: unknown) => number,
  lessFn: (a: unknown, b: unknown) => boolean
): Stability;
