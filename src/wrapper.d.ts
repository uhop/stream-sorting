/**
 * Push-side handle returned by `ObjectStreamWrapper.openWriter()`.
 *
 * Subclassing provides a default `writeAll(source)` that calls `write` in a
 * serialized loop (per-item backpressure flows through the awaited `write`).
 * Subclasses MUST override `write`, `end`, and the `ended` getter; they MAY
 * override `writeAll` if the storage offers a more efficient bulk path.
 *
 * - `write(item)` resolves when the item has been accepted by the underlying
 *   storage.
 * - `writeAll(source)` does NOT call `end()` — compose the two explicitly,
 *   or use the free helper `consume(writer, source)`.
 * - `end()` MUST be idempotent: second and later calls return the same
 *   promise as the first.
 * - `ended` MUST flip to `true` synchronously inside the first `end()` call.
 */
export declare class ItemWriter<T = unknown> {
  write(item: T): Promise<void>;
  writeAll(source: AsyncIterable<T> | Iterable<T>): Promise<void>;
  end(): Promise<void>;
  get ended(): boolean;
}

/**
 * Wrapper contract for ferrying objects to and from some backing storage.
 * The sort algorithms only see this interface; the wrapper hides the rest
 * (local file, in-memory array, S3, SSH pipe, sharded volume, etc.).
 *
 * The base class is a marker — methods stubbed to throw "must override".
 * Subclasses MAY `extends ObjectStreamWrapper` for `instanceof` checks and
 * intent documentation, or implement the contract structurally (TypeScript
 * accepts either).
 *
 * Mode-exclusive: a wrapper is `idle`, `writing`, or `reading` at any
 * moment.
 * - `openWriter()` while `idle` or `writing` → discards previous content
 *   and returns a fresh writer.
 * - `openWriter()` while `reading` → throws; call `close()` first.
 * - `openReader()` while `idle` or `reading` → returns a fresh iterable
 *   from the start (in `reading`, previous iterator is disposed).
 * - `openReader()` while `writing` → throws; call `close()` first.
 *
 * Cleanup: the iterator returned from `openReader()[Symbol.asyncIterator]()`
 * MUST implement `return()`, so resources are released automatically when
 * the consumer breaks early from `for await` or an exception unwinds the
 * loop. `wrapper.close()` is the coarse-grained "abandon current mode"
 * escape hatch (also useful as defensive cleanup before `delete()`).
 */
export declare class ObjectStreamWrapper<T = unknown> {
  openWriter(): ItemWriter<T>;
  openReader(): AsyncIterable<T>;
  close(): Promise<void>;
  delete(): Promise<void>;
}

/**
 * Drain `source` into `writer` and end the writer. One-shot convenience for
 * the common "write all then close" pattern; equivalent to
 * `await writer.writeAll(source); await writer.end();`.
 */
export declare function consume<T>(
  writer: ItemWriter<T>,
  source: AsyncIterable<T> | Iterable<T>
): Promise<void>;
