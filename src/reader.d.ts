export declare const DONE: unique symbol;

export interface PeekableReader<T> {
  peek: () => Promise<T | typeof DONE>;
  take: () => Promise<T | typeof DONE>;
  dispose: () => Promise<void>;
}

export declare function makeReader<T>(iterable: AsyncIterable<T> | Iterable<T>): PeekableReader<T>;
