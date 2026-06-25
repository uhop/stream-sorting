import test from 'tape-six';

import MemoryWrapper from '../src/memory-wrapper.js';

import {collect} from './helpers.js';

test('MemoryWrapper: write → end → read roundtrip', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.write(1);
  await writer.write(2);
  await writer.write(3);
  await writer.end();
  t.deepEqual(await collect(w.openReader()), [1, 2, 3]);
});

test('MemoryWrapper: writeAll drains an iterable without ending', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3]);
  t.notOk(writer.ended, 'writeAll does not end the writer');
  await writer.write(4);
  await writer.end();
  t.deepEqual(await collect(w.openReader()), [1, 2, 3, 4]);
});

test('MemoryWrapper: writeAll accepts async iterables', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll(
    (async function* () {
      yield 'a';
      yield 'b';
      yield 'c';
    })()
  );
  await writer.end();
  t.deepEqual(await collect(w.openReader()), ['a', 'b', 'c']);
});

test('MemoryWrapper: ended flag flips synchronously inside end()', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.write(1);
  t.notOk(writer.ended, 'not ended before end()');
  const p = writer.end();
  t.ok(writer.ended, 'ended set synchronously inside end()');
  await p;
});

test('MemoryWrapper: end() is idempotent', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.write(1);
  const p1 = writer.end();
  const p2 = writer.end();
  t.equal(p1, p2, 'second end() returns the first promise');
  await p1;
});

test('MemoryWrapper: write after end throws', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.write(1);
  await writer.end();
  await t.rejects(writer.write(2), /write\(\) after end\(\)/);
  await t.rejects(writer.writeAll([3]), /write\(\) after end\(\)/);
});

test('MemoryWrapper: empty wrapper reads as empty iterable', async t => {
  const w = new MemoryWrapper();
  t.deepEqual(await collect(w.openReader()), []);
});

test('MemoryWrapper: openWriter discards previous content', async t => {
  const w = new MemoryWrapper();
  const w1 = w.openWriter();
  await w1.writeAll([1, 2, 3]);
  await w1.end();
  const w2 = w.openWriter();
  await w2.writeAll([10, 20]);
  await w2.end();
  t.deepEqual(await collect(w.openReader()), [10, 20]);
});

test('MemoryWrapper: openReader while writing throws', async t => {
  const w = new MemoryWrapper();
  w.openWriter();
  t.throws(() => w.openReader(), /cannot openReader\(\) while writing/);
});

test('MemoryWrapper: openWriter while reading throws', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll([1, 2]);
  await writer.end();
  const iter = w.openReader()[Symbol.asyncIterator]();
  await iter.next();
  t.throws(() => w.openWriter(), /cannot openWriter\(\) while reading/);
  await iter.return();
});

test('MemoryWrapper: iterator return() resets mode (early break)', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3, 4, 5]);
  await writer.end();

  const seen = [];
  for await (const item of w.openReader()) {
    seen.push(item);
    if (item === 3) break;
  }
  t.deepEqual(seen, [1, 2, 3], 'consumed until break');
  // After break, return() fired automatically; mode should be idle and
  // openWriter should succeed (would throw otherwise).
  w.openWriter();
  t.pass('openWriter after early break works');
});

test('MemoryWrapper: thrown exception in loop triggers return() cleanup', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3]);
  await writer.end();

  try {
    for await (const item of w.openReader()) {
      if (item === 2) throw new Error('boom');
      void item;
    }
    t.fail('expected throw');
  } catch (err) {
    t.equal(err.message, 'boom');
  }
  w.openWriter();
  t.pass('openWriter after thrown loop works');
});

test('MemoryWrapper: opening a second reader closes the first', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3]);
  await writer.end();

  const r1 = w.openReader();
  // Open r2 — should clean up r1 (mode stays reading on the new one)
  const r2 = w.openReader();
  t.deepEqual(await collect(r2), [1, 2, 3], 'r2 reads from start');
  // r1 was abandoned; iterating it now yields done (mode was reset under it).
  // Implementation detail: r1's iterator was return()ed during r2's openReader().
  const seen = await collect(r1);
  t.deepEqual(seen, [], 'r1 yields nothing after being superseded');
});

test('MemoryWrapper: close idempotent on idle', async t => {
  const w = new MemoryWrapper();
  await w.close();
  await w.close();
  t.pass('close x2 on idle wrapper does not throw');
});

test('MemoryWrapper: delete clears content', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3]);
  await writer.end();
  await w.delete();
  t.deepEqual(await collect(w.openReader()), []);
});

test('MemoryWrapper: handles objects, not just primitives', async t => {
  const w = new MemoryWrapper();
  const items = [
    {id: 1, name: 'a'},
    {id: 2, name: 'b'},
    {id: 3, name: 'c'}
  ];
  const writer = w.openWriter();
  await writer.writeAll(items);
  await writer.end();
  t.deepEqual(await collect(w.openReader()), items);
});

test('MemoryWrapper: re-read after natural completion works', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.writeAll(['a', 'b', 'c']);
  await writer.end();
  t.deepEqual(await collect(w.openReader()), ['a', 'b', 'c'], 'first read');
  t.deepEqual(await collect(w.openReader()), ['a', 'b', 'c'], 'second read');
});
