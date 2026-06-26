import type {KeyComparatorOptions} from '../ordering.js';

export interface FilterInput<T = unknown, K = unknown> {
  input: AsyncIterable<T> | Iterable<T>;
  key?: (item: T) => K;
}

export type FilterOptions = KeyComparatorOptions;

export declare function prepareFilter(primary: any, probe: any, options: any, label: string): any;

export declare function runFilter(config: any): AsyncGenerator<any, void, void>;
