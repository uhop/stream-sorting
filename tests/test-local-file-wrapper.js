import test from 'tape-six';

import {readFile, stat, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

import LocalFileWrapper from '../src/local-file-wrapper.js';

import {streamToArrayOnce} from './helpers.js';

const writeAll = (writable, items) =>
  new Promise((resolve, reject) => {
    writable.on('finish', resolve);
    writable.on('error', reject);
    for (const item of items) writable.write(item);
    writable.end();
  });

const tmpPath = () => join(tmpdir(), `lfw-${randomUUID()}.jsonl`);

test('LocalFileWrapper: write → close → read → close roundtrip', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await writeAll(w.openWrite(), [1, 2, 3]);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), [1, 2, 3]);
  await w.close();
  await w.delete();
});

test('LocalFileWrapper: roundtrips objects with default JSON serializer', async t => {
  const items = [
    {id: 1, name: 'alpha'},
    {id: 2, name: 'beta', nested: {x: 10, y: [1, 2, 3]}},
    {id: 3, name: 'gamma', date: '2026-05-22'}
  ];
  const w = new LocalFileWrapper({path: tmpPath()});
  await writeAll(w.openWrite(), items);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), items);
  await w.delete();
});

test('LocalFileWrapper: empty file reads as empty stream', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await writeAll(w.openWrite(), []);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), []);
  await w.delete();
});

test('LocalFileWrapper: file framing is one JSON value per line, trailing newline', async t => {
  const path = tmpPath();
  const w = new LocalFileWrapper({path});
  await writeAll(w.openWrite(), [{a: 1}, {b: 2}, {c: 3}]);
  await w.close();
  const text = await readFile(path, 'utf8');
  t.equal(text, '{"a":1}\n{"b":2}\n{"c":3}\n', 'JSONL on disk');
  await w.delete();
});

test('LocalFileWrapper: openWrite while writing discards previous content', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await writeAll(w.openWrite(), [1, 2, 3]);
  await writeAll(w.openWrite(), [10, 20]);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), [10, 20]);
  await w.delete();
});

test('LocalFileWrapper: openRead while writing throws', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  w.openWrite();
  t.throws(() => w.openRead(), /cannot openRead\(\) while writing/);
  await w.close();
  await w.delete();
});

test('LocalFileWrapper: openWrite while reading throws', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await writeAll(w.openWrite(), [1, 2]);
  await w.close();
  w.openRead();
  t.throws(() => w.openWrite(), /cannot openWrite\(\) while reading/);
  await w.close();
  await w.delete();
});

test('LocalFileWrapper: close is idempotent on an idle wrapper', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await w.close();
  await w.close();
  t.pass('close x2 on idle wrapper does not throw');
});

test('LocalFileWrapper: delete on never-written wrapper does not throw (file absent)', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await w.delete();
  t.pass('delete with no backing file does not throw');
});

test('LocalFileWrapper: delete removes the file from disk', async t => {
  const path = tmpPath();
  const w = new LocalFileWrapper({path});
  await writeAll(w.openWrite(), [1, 2, 3]);
  await w.close();
  await stat(path);
  await w.delete();
  let exists = true;
  try {
    await stat(path);
  } catch (err) {
    if (err.code === 'ENOENT') exists = false;
    else throw err;
  }
  t.notOk(exists, 'file removed');
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
  await writeAll(w.openWrite(), items);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), items);
  await w.delete();
});

test('LocalFileWrapper: re-read after close returns same items', async t => {
  const w = new LocalFileWrapper({path: tmpPath()});
  await writeAll(w.openWrite(), ['x', 'y', 'z']);
  await w.close();

  t.deepEqual(await streamToArrayOnce(w.openRead()), ['x', 'y', 'z'], 'first read');
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), ['x', 'y', 'z'], 'second read');
  await w.close();
  await w.delete();
});

test('LocalFileWrapper: constructor rejects missing path', t => {
  t.throws(() => new LocalFileWrapper(), /options\.path is required/);
  t.throws(() => new LocalFileWrapper({}), /options\.path is required/);
  t.throws(() => new LocalFileWrapper({path: ''}), /options\.path is required/);
  t.throws(() => new LocalFileWrapper({path: 42}), /options\.path is required/);
});

test('LocalFileWrapper: survives unicode payloads', async t => {
  const items = ['héllo', 'wörld', '日本語', '🎉', {emoji: '🚀', greet: 'привет'}];
  const w = new LocalFileWrapper({path: tmpPath()});
  await writeAll(w.openWrite(), items);
  await w.close();
  t.deepEqual(await streamToArrayOnce(w.openRead()), items);
  await w.delete();
});

test('LocalFileWrapper: works under a freshly-mkdtemp directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lfw-dir-'));
  try {
    const w = new LocalFileWrapper({path: join(dir, 'run.jsonl')});
    await writeAll(w.openWrite(), [1, 2, 3]);
    await w.close();
    t.deepEqual(await streamToArrayOnce(w.openRead()), [1, 2, 3]);
    await w.delete();
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
