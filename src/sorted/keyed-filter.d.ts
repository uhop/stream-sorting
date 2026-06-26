export interface FilterInput<T = unknown, K = unknown> {
  input: AsyncIterable<T> | Iterable<T>;
  key?: (item: T) => K;
}

export interface FilterOptions {
  compareKey?: (a: any, b: any) => number;
  lessKey?: (a: any, b: any) => boolean;
}

export declare function prepareFilter(primary: any, probe: any, options: any, label: string): any;

export declare function runFilter(config: any): AsyncGenerator<any, void, void>;
