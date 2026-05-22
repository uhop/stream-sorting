import test from 'tape-six';

import MemoryWrapper from '../src/memory-wrapper.js';

import {streamToArrayOnce} from './helpers.js';

const writeAll = (writable, items) =>
  new Promise((resolve, reject) => {
    writable.on('finish', resolve);
    writable.on('error', reject);
    for (const item of items) writable.write(item);
    writable.end();
  });

test('MemoryWrapper: write → close → read → close roundtrip', async t => {
  const w = new MemoryWrapper();
  await writeAll(w.openWrite(), [1, 2, 3]);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), [1, 2, 3]);
  await w.close();
});

test('MemoryWrapper: empty wrapper reads as empty stream', async t => {
  const w = new MemoryWrapper();
  t.deepEqual(await streamToArrayOnce(w.openRead()), []);
  await w.close();
});

test('MemoryWrapper: openWrite while writing discards previous content', async t => {
  const w = new MemoryWrapper();
  await writeAll(w.openWrite(), [1, 2, 3]);
  await writeAll(w.openWrite(), [4, 5]);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), [4, 5]);
});

test('MemoryWrapper: openRead while writing throws', async t => {
  const w = new MemoryWrapper();
  w.openWrite();
  t.throws(() => w.openRead(), /cannot openRead\(\) while writing/);
  await w.close();
});

test('MemoryWrapper: openWrite while reading throws', async t => {
  const w = new MemoryWrapper();
  await writeAll(w.openWrite(), [1, 2]);
  await w.close();
  w.openRead();
  t.throws(() => w.openWrite(), /cannot openWrite\(\) while reading/);
  await w.close();
});

test('MemoryWrapper: close is idempotent', async t => {
  const w = new MemoryWrapper();
  await w.close();
  await w.close();
  await w.close();
  t.pass('close x3 on idle wrapper does not throw');
});

test('MemoryWrapper: delete on never-opened wrapper does not throw', async t => {
  const w = new MemoryWrapper();
  await w.delete();
  t.pass('delete on idle wrapper does not throw');
});

test('MemoryWrapper: delete clears content', async t => {
  const w = new MemoryWrapper();
  await writeAll(w.openWrite(), [1, 2, 3]);
  await w.close();
  await w.delete();
  t.deepEqual(await streamToArrayOnce(w.openRead()), [], 'content gone after delete');
});

test('MemoryWrapper: handles objects, not just primitives', async t => {
  const w = new MemoryWrapper();
  const items = [
    {id: 1, name: 'a'},
    {id: 2, name: 'b'},
    {id: 3, name: 'c'}
  ];
  await writeAll(w.openWrite(), items);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), items);
});

test('MemoryWrapper: re-read after close returns same items', async t => {
  const w = new MemoryWrapper();
  await writeAll(w.openWrite(), ['a', 'b', 'c']);
  await w.close();

  t.deepEqual(await streamToArrayOnce(w.openRead()), ['a', 'b', 'c'], 'first read');
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), ['a', 'b', 'c'], 'second read');
  await w.close();
});
