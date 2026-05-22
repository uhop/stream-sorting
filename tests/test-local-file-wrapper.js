import test from 'tape-six';

import {readFile, stat, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

import LocalFileWrapper from '../src/local-file-wrapper.js';

import {collect} from './helpers.js';

const tmpPath = () => join(tmpdir(), `lfw-${randomUUID()}.jsonl`);

const fileExists = async path => {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
};

test('LocalFileWrapper: write → end → read roundtrip', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.write(1);
  await writer.write(2);
  await writer.write(3);
  await writer.end();
  t.deepEqual(await collect(w.openReader()), [1, 2, 3]);
  await w.delete();
});

test('LocalFileWrapper: writeAll drains without ending; ended flag honest', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.writeAll([{a: 1}, {a: 2}]);
  t.notOk(writer.ended);
  await writer.write({a: 3});
  await writer.end();
  t.ok(writer.ended);
  t.deepEqual(await collect(w.openReader()), [{a: 1}, {a: 2}, {a: 3}]);
  await w.delete();
});

test('LocalFileWrapper: writeAll accepts async iterables', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
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
  await w.delete();
});

test('LocalFileWrapper: end() is idempotent', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.write(1);
  const p1 = writer.end();
  const p2 = writer.end();
  t.equal(p1, p2, 'second end() returns the first promise');
  await p1;
  await w.delete();
});

test('LocalFileWrapper: write after end rejects', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.end();
  await t.rejects(writer.write(1), /write\(\) after end\(\)/);
  await t.rejects(writer.writeAll([2]), /write\(\) after end\(\)/);
  await w.delete();
});

test('LocalFileWrapper: empty file reads as empty iterable', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.end();
  t.deepEqual(await collect(w.openReader()), []);
  await w.delete();
});

test('LocalFileWrapper: framing on disk is one JSON value per line, trailing newline', async t => {
  const path = tmpPath();
  const w = new LocalFileWrapper({path});
  const writer = w.openWriter();
  await writer.writeAll([{a: 1}, {b: 2}, {c: 3}]);
  await writer.end();
  const text = await readFile(path, 'utf8');
  t.equal(text, '{"a":1}\n{"b":2}\n{"c":3}\n');
  await w.delete();
});

test('LocalFileWrapper: openWriter discards previous content', async t => {
  const path = tmpPath();
  const w = new LocalFileWrapper({path});
  const w1 = w.openWriter();
  await w1.writeAll([1, 2, 3]);
  await w1.end();
  const w2 = w.openWriter();
  await w2.writeAll([10, 20]);
  await w2.end();
  t.deepEqual(await collect(w.openReader()), [10, 20]);
  await w.delete();
});

test('LocalFileWrapper: openReader while writing throws', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  t.throws(() => w.openReader(), /cannot openReader\(\) while writing/);
  await writer.end();
  await w.delete();
});

test('LocalFileWrapper: openWriter while reading throws', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.writeAll([1, 2]);
  await writer.end();
  const iter = w.openReader()[Symbol.asyncIterator]();
  await iter.next();
  t.throws(() => w.openWriter(), /cannot openWriter\(\) while reading/);
  await iter.return();
  await w.delete();
});

test('LocalFileWrapper: iterator return() cleans up after early break', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3, 4, 5]);
  await writer.end();

  const seen = [];
  for await (const item of w.openReader()) {
    seen.push(item);
    if (item === 3) break;
  }
  t.deepEqual(seen, [1, 2, 3]);
  // Should be idle now — openWriter would throw otherwise.
  const w2 = w.openWriter();
  await w2.end();
  await w.delete();
});

test('LocalFileWrapper: thrown exception in loop triggers return() cleanup', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
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
  const w2 = w.openWriter();
  await w2.end();
  await w.delete();
});

test('LocalFileWrapper: opening a second reader supersedes the first cleanly', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3]);
  await writer.end();

  w.openReader(); // r1 — abandoned without iterating; should not leak handles
  const r2 = w.openReader();
  t.deepEqual(await collect(r2), [1, 2, 3], 'r2 reads from start');
  await w.delete();
});

test('LocalFileWrapper: delete removes file from disk', async t => {
  const path = tmpPath();
  const w = new LocalFileWrapper({path});
  const writer = w.openWriter();
  await writer.writeAll([1, 2, 3]);
  await writer.end();
  t.ok(await fileExists(path), 'file written');
  await w.delete();
  t.notOk(await fileExists(path), 'file removed');
});

test('LocalFileWrapper: delete on never-written wrapper does not throw', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await w.delete();
  t.pass('delete with no backing file does not throw');
});

test('LocalFileWrapper: custom serialize / deserialize round-trip', async t => {
  const items = [
    {id: 1, tag: 'a'},
    {id: 2, tag: 'b'},
    {id: 3, tag: 'c'}
  ];
  const w = new LocalFileWrapper({
    path: tmpPath(),
    serialize: item => `${item.id}|${item.tag}`,
    deserialize: text => {
      const [id, tag] = text.split('|');
      return {id: Number(id), tag};
    }
  });
  const writer = w.openWriter();
  await writer.writeAll(items);
  await writer.end();
  t.deepEqual(await collect(w.openReader()), items);
  await w.delete();
});

test('LocalFileWrapper: survives unicode payloads (UTF-8 across chunk boundaries)', async t => {
  const items = ['héllo', 'wörld', '日本語', '🎉', {emoji: '🚀', greet: 'привет'}];
  const w = new LocalFileWrapper({path: tmpPath()});
  const writer = w.openWriter();
  await writer.writeAll(items);
  await writer.end();
  t.deepEqual(await collect(w.openReader()), items);
  await w.delete();
});

test('LocalFileWrapper: works under a freshly-mkdtemp directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lfw-dir-'));
  try {
    const w = new LocalFileWrapper({path: join(dir, 'run.jsonl')});
    const writer = w.openWriter();
    await writer.writeAll([1, 2, 3]);
    await writer.end();
    t.deepEqual(await collect(w.openReader()), [1, 2, 3]);
    await w.delete();
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('LocalFileWrapper: constructor rejects missing path', t => {
  t.throws(() => new LocalFileWrapper(), /options\.path is required/);
  t.throws(() => new LocalFileWrapper({}), /options\.path is required/);
  t.throws(() => new LocalFileWrapper({path: ''}), /options\.path is required/);
  t.throws(() => new LocalFileWrapper({path: 42}), /options\.path is required/);
});
