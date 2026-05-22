import {ObjectStreamWrapper} from './wrapper.js';

export interface LocalFileWrapperOptions<T = unknown> {
  /** Absolute path to the backing file. Required — no default. */
  path: string;
  /** Per-item serializer. Default: `JSON.stringify`. Result must not contain `\n`. */
  serialize?: (item: T) => string;
  /** Per-item deserializer. Default: `JSON.parse`. Receives one line of text without trailing `\n`. */
  deserialize?: (text: string) => T;
}

/**
 * Local-filesystem `ObjectStreamWrapper`. Items are framed as JSON-line-delimited
 * text by default (`JSON.stringify(item) + '\n'`); the framing is compatible with
 * `stream-chain`'s `jsonl/parserStream`. Pass `serialize` / `deserialize` to use a
 * different per-item encoding (still line-delimited; result must not contain `\n`).
 *
 * `path` is required: there is no default `tmpDir`, because Linux `/tmp` is
 * commonly tmpfs (RAM-backed) and would silently defeat the disk-backed sort.
 */
declare class LocalFileWrapper<T = unknown> extends ObjectStreamWrapper<T> {
  constructor(options: LocalFileWrapperOptions<T>);
  readonly path: string;
}

export default LocalFileWrapper;
