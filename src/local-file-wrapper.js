// @ts-self-types="./local-file-wrapper.d.ts"

import {createReadStream, createWriteStream} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {Transform} from 'node:stream';

import asStream from 'stream-chain/asStream.js';
import gen from 'stream-chain/gen.js';
import fixUtf8Stream from 'stream-chain/utils/fixUtf8Stream.js';
import lines from 'stream-chain/utils/lines.js';

const MODE_IDLE = 'idle';
const MODE_WRITING = 'writing';
const MODE_READING = 'reading';

const defaultSerialize = item => JSON.stringify(item);
const defaultDeserialize = text => JSON.parse(text);

class LocalFileWrapper {
  constructor(options) {
    if (!options || typeof options.path !== 'string' || !options.path) {
      throw new TypeError(
        'LocalFileWrapper: options.path is required (no default — Linux /tmp is commonly tmpfs and would defeat the disk-backed sort)'
      );
    }
    this._path = options.path;
    this._serialize = options.serialize || defaultSerialize;
    this._deserialize = options.deserialize || defaultDeserialize;
    this._mode = MODE_IDLE;
    this._fileStream = null;
    this._userStream = null;
  }

  get path() {
    return this._path;
  }

  openWrite() {
    if (this._mode === MODE_READING) {
      throw new Error('LocalFileWrapper: cannot openWrite() while reading; call close() first');
    }
    const serialize = this._serialize;
    const encoder = new Transform({
      writableObjectMode: true,
      readableObjectMode: false,
      transform(chunk, _enc, cb) {
        try {
          this.push(serialize(chunk) + '\n');
          cb(null);
        } catch (err) {
          cb(err);
        }
      }
    });
    const fileStream = createWriteStream(this._path);
    encoder.pipe(fileStream);
    fileStream.on('error', err => encoder.destroy(err));
    this._fileStream = fileStream;
    this._userStream = encoder;
    this._mode = MODE_WRITING;
    return encoder;
  }

  openRead() {
    if (this._mode === MODE_WRITING) {
      throw new Error('LocalFileWrapper: cannot openRead() while writing; call close() first');
    }
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
    this._fileStream = fileStream;
    this._userStream = parser;
    this._mode = MODE_READING;
    return parser;
  }

  async close() {
    const fileStream = this._fileStream;
    const userStream = this._userStream;
    const mode = this._mode;
    this._mode = MODE_IDLE;
    this._fileStream = null;
    this._userStream = null;
    if (mode === MODE_WRITING) {
      if (userStream && !userStream.writableEnded) userStream.end();
      const writeFile = /** @type {import('node:fs').WriteStream | null} */ (fileStream);
      if (writeFile && !writeFile.writableFinished) {
        await new Promise((resolve, reject) => {
          writeFile.once('finish', resolve);
          writeFile.once('error', reject);
        });
      }
    } else if (mode === MODE_READING) {
      if (fileStream && !fileStream.destroyed) fileStream.destroy();
      if (userStream && !userStream.destroyed) userStream.destroy();
    }
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

export default LocalFileWrapper;
