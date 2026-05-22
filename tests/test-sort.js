import test from 'tape-six';

import {readdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import sort from '../src/sort.js';
import MemoryWrapper from '../src/memory-wrapper.js';

import {collect} from './helpers.js';

const asc = (a, b) => a - b;
const desc = (a, b) => b - a;
const lessAsc = (a, b) => a < b;

const withTmpDir = async fn => {
  const dir = await mkdtemp(join(tmpdir(), 'sort-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
};

const sortInMem = async (input, opts) => {
  const wrappers = [];
  const createWrapper = () => {
    const w = new MemoryWrapper();
    wrappers.push(w);
    return w;
  };
  const out = await collect(sort(input, {createWrapper, ...opts}));
  return {out, wrappers};
};

test('sort: empty input emits nothing', async t => {
  const {out} = await sortInMem([], {compare: asc});
  t.deepEqual(out, []);
});

test('sort: single item emits that item', async t => {
  const {out} = await sortInMem([42], {compare: asc});
  t.deepEqual(out, [42]);
});

test('sort: in-memory fast path (input ≤ batchSize)', async t => {
  const {out, wrappers} = await sortInMem([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5], {
    compare: asc
  });
  t.deepEqual(out, [1, 1, 2, 3, 3, 4, 5, 5, 5, 6, 9]);
  t.equal(wrappers.length, 0, 'no wrappers created on fast path');
});

test('sort: multi-batch path (input > batchSize)', async t => {
  const {out, wrappers} = await sortInMem([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5], {
    compare: asc,
    batchSize: 3
  });
  t.deepEqual(out, [1, 1, 2, 3, 3, 4, 5, 5, 5, 6, 9]);
  t.ok(wrappers.length >= 4, `at least 4 runs created, got ${wrappers.length}`);
});

test('sort: single full batch (input === batchSize) uses fast path', async t => {
  const {out, wrappers} = await sortInMem([5, 4, 3, 2, 1], {compare: asc, batchSize: 5});
  t.deepEqual(out, [1, 2, 3, 4, 5]);
  t.equal(wrappers.length, 0, 'fast path');
});

test('sort: lessFn instead of compare', async t => {
  const {out} = await sortInMem([3, 1, 4, 1, 5], {lessFn: lessAsc});
  t.deepEqual(out, [1, 1, 3, 4, 5]);
});

test('sort: descending comparator', async t => {
  const {out} = await sortInMem([3, 1, 4, 1, 5, 9, 2, 6], {compare: desc});
  t.deepEqual(out, [9, 6, 5, 4, 3, 2, 1, 1]);
});

test('sort: stable preserves input order for equal keys (in-memory)', async t => {
  const items = [
    {key: 'a', i: 0},
    {key: 'b', i: 1},
    {key: 'a', i: 2},
    {key: 'b', i: 3},
    {key: 'a', i: 4}
  ];
  const {out} = await sortInMem(items, {compare: (x, y) => x.key.localeCompare(y.key)});
  t.deepEqual(
    out.map(o => o.i),
    [0, 2, 4, 1, 3]
  );
});

test('sort: stable preserves input order for equal keys (multi-batch)', async t => {
  const items = [];
  for (let i = 0; i < 20; ++i) items.push({key: i % 3, i});
  const {out} = await sortInMem(items, {
    compare: (x, y) => x.key - y.key,
    batchSize: 4
  });
  // Within each key group, .i values must be ascending (input order).
  const byKey = {0: [], 1: [], 2: []};
  for (const o of out) byKey[o.key].push(o.i);
  for (const k of [0, 1, 2]) {
    const arr = byKey[k];
    for (let j = 1; j < arr.length; ++j) {
      t.ok(arr[j - 1] < arr[j], `stable for key ${k}: ${arr[j - 1]} < ${arr[j]}`);
    }
  }
});

test('sort: stable=false skips tag overhead', async t => {
  // With stable=false, ties may appear in any order — just check the keys end up sorted.
  const items = [];
  for (let i = 0; i < 30; ++i) items.push({key: i % 4, i});
  const {out} = await sortInMem(items, {
    compare: (x, y) => x.key - y.key,
    stable: false,
    batchSize: 5
  });
  t.equal(out.length, 30);
  for (let j = 1; j < out.length; ++j) {
    t.ok(out[j - 1].key <= out[j].key, `sorted by key at ${j}`);
  }
});

test('sort: async iterable input', async t => {
  const gen = (async function* () {
    yield 3;
    yield 1;
    yield 4;
    yield 1;
    yield 5;
  })();
  const {out} = await sortInMem(gen, {compare: asc});
  t.deepEqual(out, [1, 1, 3, 4, 5]);
});

test('sort: composes via for-await with no boundary conversion', async t => {
  const out = [];
  for await (const item of sort([5, 2, 7, 1, 4], {
    compare: asc,
    createWrapper: () => new MemoryWrapper(),
    batchSize: 2
  })) {
    out.push(item);
  }
  t.deepEqual(out, [1, 2, 4, 5, 7]);
});

test('sort: large input across many runs', async t => {
  const n = 1000;
  const input = [];
  for (let i = 0; i < n; ++i) input.push(((i * 37) % n) + 1); // permutation
  const {out, wrappers} = await sortInMem(input, {compare: asc, batchSize: 50});
  t.equal(out.length, n);
  for (let j = 1; j < out.length; ++j) t.ok(out[j - 1] <= out[j], `sorted at ${j}`);
  t.ok(wrappers.length >= 20, `${wrappers.length} runs`);
});

test('sort: tmpDir creates and cleans up files', async t => {
  await withTmpDir(async dir => {
    const out = await collect(sort([5, 2, 7, 1, 4, 9, 3, 6, 8], {compare: asc, tmpDir: dir}));
    t.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Single batch — fast path, no files written
    const files = await readdir(dir);
    t.deepEqual(files, [], 'no leftover files');
  });
});

test('sort: tmpDir with multi-batch — files cleaned up by default', async t => {
  await withTmpDir(async dir => {
    const out = await collect(
      sort([5, 2, 7, 1, 4, 9, 3, 6, 8], {compare: asc, tmpDir: dir, batchSize: 2})
    );
    t.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const files = await readdir(dir);
    t.deepEqual(files, [], 'temp files cleaned up');
  });
});

test('sort: keepTempFiles: true preserves files', async t => {
  await withTmpDir(async dir => {
    const out = await collect(
      sort([5, 2, 7, 1, 4, 9, 3, 6, 8], {
        compare: asc,
        tmpDir: dir,
        batchSize: 2,
        keepTempFiles: true
      })
    );
    t.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const files = await readdir(dir);
    t.ok(files.length > 0, 'temp files preserved');
    for (const f of files) t.matchString(f, /^stream-sorting-\d+-[\da-f-]+-\d+\.jsonl$/);
  });
});

test('sort: comparator throws — error propagates, wrappers cleaned up', async t => {
  await withTmpDir(async dir => {
    const failing = () => {
      throw new Error('comparator boom');
    };
    await t.rejects(
      collect(sort([3, 1, 2, 4, 5], {compare: failing, tmpDir: dir, batchSize: 2})),
      /comparator boom/
    );
    const files = await readdir(dir);
    t.deepEqual(files, [], 'cleanup ran on error');
  });
});

test('sort: input errors propagate', async t => {
  const failing = (async function* () {
    yield 1;
    yield 2;
    throw new Error('input boom');
  })();
  await t.rejects(sortInMem(failing, {compare: asc}), /input boom/);
});

test('sort: onProgress fires on run completion and merge start', async t => {
  const calls = [];
  await collect(
    sort([5, 2, 7, 1, 4, 9, 3, 6, 8], {
      compare: asc,
      createWrapper: () => new MemoryWrapper(),
      batchSize: 3,
      onProgress: stats => calls.push({...stats})
    })
  );
  // 3 runs of 3 items each, then a merge.
  t.ok(calls.length >= 4, `at least 4 progress calls, got ${calls.length}`);
  const phases = calls.map(c => c.phase);
  t.ok(phases.includes('pre-sort'), 'pre-sort phase reported');
  t.ok(phases.includes('final-merge'), 'final-merge phase reported');
  const last = calls[calls.length - 1];
  t.equal(last.itemsRead, 9, 'final itemsRead');
  t.equal(last.itemsWritten, 9, 'final itemsWritten');
  t.equal(last.runsCreated, 3, 'final runsCreated');
});

test('sort: throws when both compare and lessFn given', t => {
  t.throws(
    () => sort([1, 2], {compare: asc, lessFn: lessAsc, tmpDir: '/tmp'}),
    /`compare` OR `lessFn`/
  );
});

test('sort: throws when neither compare nor lessFn given', t => {
  t.throws(() => sort([1, 2], {tmpDir: '/tmp'}), /`compare` or `lessFn` is required/);
});

test('sort: throws when both tmpDir and createWrapper given', t => {
  t.throws(
    () =>
      sort([1, 2], {
        compare: asc,
        tmpDir: '/tmp',
        createWrapper: () => new MemoryWrapper()
      }),
    /`tmpDir` OR `createWrapper`/
  );
});

test('sort: throws when neither tmpDir nor createWrapper given', t => {
  t.throws(() => sort([1, 2], {compare: asc}), /`tmpDir` or `createWrapper` is required/);
});

test('sort: throws when batchSize invalid', t => {
  t.throws(
    () => sort([1], {compare: asc, tmpDir: '/tmp', batchSize: 0}),
    /`batchSize` must be a positive integer/
  );
  t.throws(
    () => sort([1], {compare: asc, tmpDir: '/tmp', batchSize: -1}),
    /`batchSize` must be a positive integer/
  );
  t.throws(
    () => sort([1], {compare: asc, tmpDir: '/tmp', batchSize: 1.5}),
    /`batchSize` must be a positive integer/
  );
});

test('sort: throws on missing input', t => {
  t.throws(() => sort(null, {compare: asc, tmpDir: '/tmp'}), /input is required/);
  t.throws(() => sort(undefined, {compare: asc, tmpDir: '/tmp'}), /input is required/);
});

test('sort: throws on non-iterable input', t => {
  t.throws(() => sort(42, {compare: asc, tmpDir: '/tmp'}), /must be iterable/);
});

test('sort: sorts object payloads with default JSON serializer', async t => {
  await withTmpDir(async dir => {
    const items = [
      {id: 5, name: 'eve'},
      {id: 2, name: 'bob'},
      {id: 7, name: 'gina'},
      {id: 1, name: 'alice'},
      {id: 4, name: 'dan'}
    ];
    const out = await collect(
      sort(items, {compare: (a, b) => a.id - b.id, tmpDir: dir, batchSize: 2})
    );
    t.deepEqual(
      out.map(o => o.id),
      [1, 2, 4, 5, 7]
    );
  });
});
