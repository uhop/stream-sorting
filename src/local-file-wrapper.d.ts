import {ObjectStreamWrapper} from './wrapper.js';

export interface LocalFileWrapperOptions<T = unknown> {
  path: string;
  serialize?: (item: T) => string;
  deserialize?: (text: string) => T;
}

/**
 * Local-filesystem `ObjectStreamWrapper` (line-delimited; JSON by default).
 *
 * @see https://github.com/uhop/stream-sorting/wiki/LocalFileWrapper
 */
declare class LocalFileWrapper<T = unknown> extends ObjectStreamWrapper<T> {
  constructor(options: LocalFileWrapperOptions<T>);
  readonly path: string;
}

export default LocalFileWrapper;
