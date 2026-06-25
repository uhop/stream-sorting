/**
 * Push-side handle for writing items to an `ObjectStreamWrapper`.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/ObjectStreamWrapper
 */
export declare class ItemWriter<T = unknown> {
  write(item: T): Promise<void>;
  writeAll(source: AsyncIterable<T> | Iterable<T>): Promise<void>;
  end(): Promise<void>;
  get ended(): boolean;
}

/**
 * Storage abstraction the sort algorithms read and write through (local file,
 * memory, S3, etc.).
 *
 * @see https://github.com/uhop/stream-sorting/wiki/ObjectStreamWrapper
 */
export declare class ObjectStreamWrapper<T = unknown> {
  openWriter(): ItemWriter<T>;
  openReader(): AsyncIterable<T>;
  close(): Promise<void>;
  delete(): Promise<void>;
}

/**
 * Writes every item from a source into a writer, then ends it.
 *
 * @see https://github.com/uhop/stream-sorting/wiki/ObjectStreamWrapper
 */
export declare function consume<T>(
  writer: ItemWriter<T>,
  source: AsyncIterable<T> | Iterable<T>
): Promise<void>;
