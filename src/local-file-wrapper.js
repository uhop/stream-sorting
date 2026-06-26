// @ts-self-types="./local-file-wrapper.d.ts"

import {randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {join} from 'node:path';

import asStream from 'stream-chain/asStream.js';
import gen from 'stream-chain/gen.js';
import fixUtf8Stream from 'stream-chain/utils/fixUtf8Stream.js';
import lines from 'stream-chain/utils/lines.js';

import {ItemWriter, ObjectStreamWrapper} from './wrapper.js';

const MODE_IDLE = 'idle';
const MODE_WRITING = 'writing';
const MODE_READING = 'reading';

const defaultSerialize = item => JSON.stringify(item);
const defaultDeserialize = text => JSON.parse(text);

const writeAfterEnd = () => new Error('LocalFileWriter: write() after end()');

class LocalFileWriter extends ItemWriter {
  constructor(wrapper, fileStream) {
    super();
    this._wrapper = wrapper;
    this._fileStream = fileStream;
    this._ended = false;
    this._endPromise = null;
    this._pendingError = null;
    fileStream.on('error', err => {
      this._pendingError = this._pendingError || err;
    });
  }

  get ended() {
    return this._ended;
  }

  _writeChunk(chunk) {
    const fileStream = this._fileStream;
    if (this._pendingError) return Promise.reject(this._pendingError);
    const ok = fileStream.write(chunk);
    if (ok) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onDrain = () => {
        fileStream.removeListener('error', onError);
        resolve();
      };
      const onError = err => {
        fileStream.removeListener('drain', onDrain);
        reject(err);
      };
      fileStream.once('drain', onDrain);
      fileStream.once('error', onError);
    });
  }

  async write(item) {
    if (this._ended) throw writeAfterEnd();
    await this._writeChunk(this._wrapper._serialize(item) + '\n');
  }

  end() {
    if (!this._ended) {
      this._ended = true;
      const fileStream = this._fileStream;
      const wrapper = this._wrapper;
      const self = this;
      this._endPromise = new Promise((resolve, reject) => {
        const settle = err => {
          if (wrapper._writer === self) {
            wrapper._mode = MODE_IDLE;
            wrapper._writer = null;
          }
          if (err) reject(err);
          else resolve();
        };
        const onFinish = () => {
          fileStream.removeListener('error', onError);
          settle();
        };
        const onError = err => {
          fileStream.removeListener('finish', onFinish);
          settle(err);
        };
        fileStream.once('finish', onFinish);
        fileStream.once('error', onError);
        fileStream.end();
      });
    }
    return this._endPromise;
  }
}

class LocalFileWrapper extends ObjectStreamWrapper {
  constructor(options) {
    super();
    if (!options || typeof options.path !== 'string' || !options.path) {
      throw new TypeError(
        'LocalFileWrapper: options.path is required (no default — Linux /tmp is commonly tmpfs and would defeat the disk-backed sort)'
      );
    }
    this._path = options.path;
    this._serialize = options.serialize || defaultSerialize;
    this._deserialize = options.deserialize || defaultDeserialize;
    this._mode = MODE_IDLE;
    this._writer = null;
    this._reader = null;
  }

  get path() {
    return this._path;
  }

  openWriter() {
    if (this._mode === MODE_READING) {
      throw new Error('LocalFileWrapper: cannot openWriter() while reading; call close() first');
    }
    const fileStream = createWriteStream(this._path);
    this._writer = new LocalFileWriter(this, fileStream);
    this._mode = MODE_WRITING;
    return this._writer;
  }

  openReader() {
    if (this._mode === MODE_WRITING) {
      throw new Error('LocalFileWrapper: cannot openReader() while writing; call close() first');
    }
    if (this._reader) this._reader.dispose();

    const deserialize = this._deserialize;
    const parser = asStream(
      gen(fixUtf8Stream(), lines(), text => deserialize(text)),
      {
        writableObjectMode: false,
        readableObjectMode: true
      }
    );
    const fileStream = createReadStream(this._path);
    fileStream.pipe(parser);
    fileStream.on('error', err => parser.destroy(err));

    const wrapper = this;
    let done = false;

    const finalize = () => {
      if (done) return;
      done = true;
      if (!parser.destroyed) parser.destroy();
      if (!fileStream.destroyed) fileStream.destroy();
      if (wrapper._reader === reader) {
        wrapper._mode = MODE_IDLE;
        wrapper._reader = null;
      }
    };

    const reader = {
      dispose: finalize,
      [Symbol.asyncIterator]() {
        const inner = parser[Symbol.asyncIterator]();
        return {
          async next() {
            const r = await inner.next();
            if (r.done) finalize();
            return r;
          },
          async return(value) {
            try {
              if (inner.return) await inner.return();
            } finally {
              finalize();
            }
            return {value, done: true};
          }
        };
      }
    };

    this._reader = reader;
    this._mode = MODE_READING;
    return reader;
  }

  async close() {
    if (this._mode === MODE_WRITING && this._writer && !this._writer.ended) {
      try {
        await this._writer.end();
      } catch (_) {
        // close() is a cleanup path; swallow flush errors.
      }
    }
    if (this._mode === MODE_READING && this._reader) this._reader.dispose();
    this._mode = MODE_IDLE;
    this._writer = null;
    this._reader = null;
  }

  async delete() {
    await this.close();
    try {
      await unlink(this._path);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

export const makeTmpWrapperFactory = (tmpDir, tag = '') => {
  const unique = randomUUID();
  const prefix = tag ? `stream-sorting-${tag}` : 'stream-sorting';
  return index =>
    new LocalFileWrapper({path: join(tmpDir, `${prefix}-${process.pid}-${unique}-${index}.jsonl`)});
};

export default LocalFileWrapper;
