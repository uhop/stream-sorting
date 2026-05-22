// @ts-self-types="./memory-wrapper.d.ts"

import {ItemWriter, ObjectStreamWrapper} from './wrapper.js';

const MODE_IDLE = 'idle';
const MODE_WRITING = 'writing';
const MODE_READING = 'reading';

const writeAfterEnd = () => new Error('MemoryWriter: write() after end()');

class MemoryWriter extends ItemWriter {
  constructor(wrapper) {
    super();
    this._wrapper = wrapper;
    this._items = wrapper._items;
    this._ended = false;
    this._endPromise = null;
  }

  get ended() {
    return this._ended;
  }

  async write(item) {
    if (this._ended) throw writeAfterEnd();
    this._items.push(item);
  }

  end() {
    if (!this._ended) {
      this._ended = true;
      if (this._wrapper._writer === this) {
        this._wrapper._mode = MODE_IDLE;
        this._wrapper._writer = null;
      }
      this._endPromise = Promise.resolve();
    }
    return this._endPromise;
  }
}

class MemoryWrapper extends ObjectStreamWrapper {
  constructor() {
    super();
    this._items = [];
    this._mode = MODE_IDLE;
    this._writer = null;
    this._iterator = null;
  }

  openWriter() {
    if (this._mode === MODE_READING) {
      throw new Error('MemoryWrapper: cannot openWriter() while reading; call close() first');
    }
    this._items = [];
    this._mode = MODE_WRITING;
    this._writer = new MemoryWriter(this);
    return this._writer;
  }

  openReader() {
    if (this._mode === MODE_WRITING) {
      throw new Error('MemoryWrapper: cannot openReader() while writing; call close() first');
    }
    if (this._iterator && this._iterator.return) this._iterator.return();
    this._mode = MODE_READING;

    const items = this._items;
    const wrapper = this;
    let i = 0;
    let done = false;

    const finalize = () => {
      if (done) return;
      done = true;
      if (wrapper._iterator === iterator) {
        wrapper._mode = MODE_IDLE;
        wrapper._iterator = null;
      }
    };

    const iterator = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      async next() {
        if (done) return {value: undefined, done: true};
        if (i >= items.length) {
          finalize();
          return {value: undefined, done: true};
        }
        return {value: items[i++], done: false};
      },
      async return(value) {
        finalize();
        return {value, done: true};
      }
    };

    this._iterator = iterator;
    return iterator;
  }

  async close() {
    if (this._mode === MODE_WRITING && this._writer && !this._writer.ended) {
      await this._writer.end();
    }
    if (this._mode === MODE_READING && this._iterator) {
      await this._iterator.return();
    }
    this._mode = MODE_IDLE;
    this._writer = null;
    this._iterator = null;
  }

  async delete() {
    await this.close();
    this._items = [];
  }
}

export default MemoryWrapper;
