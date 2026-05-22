// @ts-self-types="./memory-wrapper.d.ts"

import {Readable, Writable} from 'node:stream';

const MODE_IDLE = 'idle';
const MODE_WRITING = 'writing';
const MODE_READING = 'reading';

class MemoryWrapper {
  constructor() {
    this._items = [];
    this._mode = MODE_IDLE;
    this._writable = null;
    this._readable = null;
  }

  openWrite() {
    if (this._mode === MODE_READING) {
      throw new Error('MemoryWrapper: cannot openWrite() while reading; call close() first');
    }
    this._items = [];
    this._mode = MODE_WRITING;
    const items = this._items;
    this._writable = new Writable({
      objectMode: true,
      write(chunk, _enc, cb) {
        items.push(chunk);
        cb();
      }
    });
    return this._writable;
  }

  openRead() {
    if (this._mode === MODE_WRITING) {
      throw new Error('MemoryWrapper: cannot openRead() while writing; call close() first');
    }
    this._mode = MODE_READING;
    const items = this._items;
    let i = 0;
    this._readable = new Readable({
      objectMode: true,
      read() {
        this.push(i < items.length ? items[i++] : null);
      }
    });
    return this._readable;
  }

  async close() {
    if (this._mode === MODE_WRITING && this._writable && !this._writable.writableEnded) {
      this._writable.end();
    }
    if (this._mode === MODE_READING && this._readable && !this._readable.destroyed) {
      this._readable.destroy();
    }
    this._mode = MODE_IDLE;
    this._writable = null;
    this._readable = null;
  }

  async delete() {
    await this.close();
    this._items = [];
  }
}

export default MemoryWrapper;
