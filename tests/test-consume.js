import test from 'tape-six';

import MemoryWrapper from '../src/memory-wrapper.js';
import {consume} from '../src/wrapper.js';

import {collect} from './helpers.js';

test('consume: drains an iterable then ends the writer', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await consume(writer, [1, 2, 3]);
  t.ok(writer.ended, 'writer is ended');
  t.deepEqual(await collect(w.openReader()), [1, 2, 3]);
});

test('consume: works with async iterables', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await consume(
    writer,
    (async function* () {
      yield 'a';
      yield 'b';
      yield 'c';
    })()
  );
  t.deepEqual(await collect(w.openReader()), ['a', 'b', 'c']);
});

test('consume: composes with prior imperative writes', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.write(0);
  await consume(writer, [1, 2, 3]);
  t.deepEqual(await collect(w.openReader()), [0, 1, 2, 3]);
});

test('consume: also re-exported from the root entry', async t => {
  const {consume: rootConsume} = await import('../src/index.js');
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await rootConsume(writer, ['x', 'y']);
  t.deepEqual(await collect(w.openReader()), ['x', 'y']);
});

test('consume: rejects if the writer was already ended', async t => {
  const w = new MemoryWrapper();
  const writer = w.openWriter();
  await writer.end();
  await t.rejects(consume(writer, [1, 2, 3]), /write\(\) after end\(\)/);
});
