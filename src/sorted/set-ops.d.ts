export interface SetOpOptions {
  compare?: (a: any, b: any) => number;
  lessFn?: (a: any, b: any) => boolean;
}

export declare function prepareSetOp(
  streams: unknown,
  options: any,
  label: string,
  minStreams?: number
): {
  streams: Array<AsyncIterable<unknown> | Iterable<unknown>>;
  compare: (a: any, b: any) => number;
};

export declare function makeTake(
  readers: any[],
  compare: (a: any, b: any) => number,
  label: string
): (i: number) => Promise<any>;

export declare function mergeRun<T>(
  streams: Array<AsyncIterable<T> | Iterable<T>>,
  compare: (a: T, b: T) => number,
  label: string
): AsyncGenerator<T, void, void>;
