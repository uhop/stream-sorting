// @ts-self-types="./wrapper.d.ts"

class ItemWriter {
  get ended() {
    throw new Error('ItemWriter: subclass must override `ended` getter');
  }

  async write(_item) {
    throw new Error('ItemWriter: subclass must override write()');
  }

  async end() {
    throw new Error('ItemWriter: subclass must override end()');
  }

  async writeAll(source) {
    for await (const item of source) await this.write(item);
  }
}

class ObjectStreamWrapper {
  openWriter() {
    throw new Error('ObjectStreamWrapper: subclass must override openWriter()');
  }

  openReader() {
    throw new Error('ObjectStreamWrapper: subclass must override openReader()');
  }

  async close() {
    throw new Error('ObjectStreamWrapper: subclass must override close()');
  }

  async delete() {
    throw new Error('ObjectStreamWrapper: subclass must override delete()');
  }
}

const consume = async (writer, source) => {
  await writer.writeAll(source);
  await writer.end();
};

export {ItemWriter, ObjectStreamWrapper, consume};
