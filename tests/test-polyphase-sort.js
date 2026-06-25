import test from 'tape-six';

import {readdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import polyphaseSort from '../src/polyphase-sort.js';
import MemoryWrapper from '../src/memory-wrapper.js';

import {collect} from './helpers.js';

const asc = (a, b) => a - b;
const desc = (a, b) => b - a;
const lessAsc = (a, b) => a < b;

const withTmpDir = async fn => {
  const dir = await mkdtemp(join(tmpdir(), 'polyphase-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
};

const sortInMem = async (input, opts) => {
  const {k = 4, ...rest} = opts;
  const wrappers = [];
  const createWrapper = () => {
    const w = new MemoryWrapper();
    wrappers.push(w);
    return w;
  };
  const out = await collect(polyphaseSort(input, {k, createWrapper, ...rest}));
  return {out, wrappers};
};

const mulberry32 = seed => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('polyphaseSort: empty input emits nothing', async t => {
  const {out} = await sortInMem([], {compare: asc});
  t.deepEqual(out, []);
});

test('polyphaseSort: single item emits that item', async t => {
  const {out} = await sortInMem([42], {compare: asc});
  t.deepEqual(out, [42]);
});

test('polyphaseSort: in-memory fast path (input <= batchSize) opens no wrappers', async t => {
  const {out, wrappers} = await sortInMem([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5], {compare: asc});
  t.deepEqual(out, [1, 1, 2, 3, 3, 4, 5, 5, 5, 6, 9]);
  t.equal(wrappers.length, 0, 'no wrappers created on fast path');
});

test('polyphaseSort: single full batch (input === batchSize) uses fast path', async t => {
  const {out, wrappers} = await sortInMem([5, 4, 3, 2, 1], {compare: asc, batchSize: 5});
  t.deepEqual(out, [1, 2, 3, 4, 5]);
  t.equal(wrappers.length, 0, 'fast path');
});

test('polyphaseSort: multi-batch path (input > batchSize)', async t => {
  const {out, wrappers} = await sortInMem([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5], {
    compare: asc,
    batchSize: 3
  });
  t.deepEqual(out, [1, 1, 2, 3, 3, 4, 5, 5, 5, 6, 9]);
  t.equal(wrappers.length, 4, 'K=4 wrappers, fixed file budget');
});

test('polyphaseSort: file budget stays fixed regardless of run count', async t => {
  for (const k of [3, 4, 5, 7]) {
    const n = 500;
    const input = [];
    for (let i = 0; i < n; ++i) input.push(((i * 41) % n) + 1);
    const {out, wrappers} = await sortInMem(input, {compare: asc, batchSize: 7, k});
    t.equal(wrappers.length, k, `K=${k}: exactly ${k} wrappers`);
    t.equal(out.length, n, `K=${k}: all items`);
    for (let j = 1; j < out.length; ++j) t.ok(out[j - 1] <= out[j], `K=${k}: sorted at ${j}`);
  }
});

test('polyphaseSort: lessFn instead of compare', async t => {
  const {out} = await sortInMem([3, 1, 4, 1, 5, 9, 2, 6], {lessFn: lessAsc, batchSize: 2});
  t.deepEqual(out, [1, 1, 2, 3, 4, 5, 6, 9]);
});

test('polyphaseSort: descending comparator', async t => {
  const {out} = await sortInMem([3, 1, 4, 1, 5, 9, 2, 6], {compare: desc, batchSize: 2});
  t.deepEqual(out, [9, 6, 5, 4, 3, 2, 1, 1]);
});

test('polyphaseSort: stable preserves input order for equal keys (multi-pass)', async t => {
  for (const k of [3, 4, 5]) {
    const items = [];
    for (let i = 0; i < 60; ++i) items.push({key: i % 4, i});
    const {out} = await sortInMem(items, {compare: (x, y) => x.key - y.key, batchSize: 5, k});
    const byKey = {0: [], 1: [], 2: [], 3: []};
    for (const o of out) byKey[o.key].push(o.i);
    for (const key of [0, 1, 2, 3]) {
      const arr = byKey[key];
      for (let j = 1; j < arr.length; ++j) {
        t.ok(arr[j - 1] < arr[j], `K=${k} stable for key ${key}: ${arr[j - 1]} < ${arr[j]}`);
      }
    }
  }
});

test('polyphaseSort: stable=false still sorts by key', async t => {
  const items = [];
  for (let i = 0; i < 40; ++i) items.push({key: i % 4, i});
  const {out} = await sortInMem(items, {
    compare: (x, y) => x.key - y.key,
    stable: false,
    batchSize: 5
  });
  t.equal(out.length, 40);
  for (let j = 1; j < out.length; ++j) t.ok(out[j - 1].key <= out[j].key, `sorted by key at ${j}`);
});

test('polyphaseSort: async iterable input', async t => {
  const gen = (async function* () {
    for (const v of [3, 1, 4, 1, 5, 9, 2, 6]) yield v;
  })();
  const {out} = await sortInMem(gen, {compare: asc, batchSize: 3});
  t.deepEqual(out, [1, 1, 2, 3, 4, 5, 6, 9]);
});

test('polyphaseSort: composes via for-await with no boundary conversion', async t => {
  const out = [];
  for await (const item of polyphaseSort([5, 2, 7, 1, 4, 8, 3, 6], {
    compare: asc,
    createWrapper: () => new MemoryWrapper(),
    k: 4,
    batchSize: 2
  })) {
    out.push(item);
  }
  t.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('polyphaseSort: large input across many passes', async t => {
  const n = 2000;
  const input = [];
  for (let i = 0; i < n; ++i) input.push(((i * 977) % n) + 1);
  const {out} = await sortInMem(input, {compare: asc, batchSize: 16, k: 4});
  t.equal(out.length, n);
  for (let j = 1; j < out.length; ++j) t.ok(out[j - 1] <= out[j], `sorted at ${j}`);
});

test('polyphaseSort: explicit files[] storage (user wrappers, not deleted)', async t => {
  const files = [new MemoryWrapper(), new MemoryWrapper(), new MemoryWrapper()];
  const out = await collect(
    polyphaseSort([5, 2, 7, 1, 4, 8, 3, 6, 9, 0], {compare: asc, files, batchSize: 2})
  );
  t.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('polyphaseSort: tmpDir creates and cleans up files', async t => {
  await withTmpDir(async dir => {
    const out = await collect(
      polyphaseSort([5, 2, 7, 1, 4, 9, 3, 6, 8], {compare: asc, tmpDir: dir, batchSize: 2})
    );
    t.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const files = await readdir(dir);
    t.deepEqual(files, [], 'temp files cleaned up');
  });
});

test('polyphaseSort: keepTempFiles: true preserves files', async t => {
  await withTmpDir(async dir => {
    const out = await collect(
      polyphaseSort([5, 2, 7, 1, 4, 9, 3, 6, 8], {
        compare: asc,
        tmpDir: dir,
        batchSize: 2,
        keepTempFiles: true
      })
    );
    t.deepEqual(out, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const files = await readdir(dir);
    t.ok(files.length > 0, 'temp files preserved');
    for (const f of files) t.matchString(f, /^stream-sorting-polyphase-\d+-[\da-f-]+-\d+\.jsonl$/);
  });
});

test('polyphaseSort: sorts object payloads with default JSON serializer', async t => {
  await withTmpDir(async dir => {
    const items = [
      {id: 5, name: 'eve'},
      {id: 2, name: 'bob'},
      {id: 7, name: 'gina'},
      {id: 1, name: 'alice'},
      {id: 4, name: 'dan'},
      {id: 3, name: 'cara'}
    ];
    const out = await collect(
      polyphaseSort(items, {compare: (a, b) => a.id - b.id, tmpDir: dir, batchSize: 2})
    );
    t.deepEqual(
      out.map(o => o.id),
      [1, 2, 3, 4, 5, 7]
    );
  });
});

test('polyphaseSort: comparator throws — error propagates, wrappers cleaned up', async t => {
  await withTmpDir(async dir => {
    const failing = () => {
      throw new Error('comparator boom');
    };
    await t.rejects(
      collect(polyphaseSort([3, 1, 2, 4, 5, 6], {compare: failing, tmpDir: dir, batchSize: 2})),
      /comparator boom/
    );
    const files = await readdir(dir);
    t.deepEqual(files, [], 'cleanup ran on error');
  });
});

test('polyphaseSort: input errors propagate', async t => {
  const failing = (async function* () {
    yield 1;
    yield 2;
    yield 3;
    throw new Error('input boom');
  })();
  await t.rejects(sortInMem(failing, {compare: asc, batchSize: 2}), /input boom/);
});

test('polyphaseSort: onProgress reports pre-sort and merge phases', async t => {
  const calls = [];
  await collect(
    polyphaseSort([5, 2, 7, 1, 4, 9, 3, 6, 8, 0], {
      compare: asc,
      createWrapper: () => new MemoryWrapper(),
      k: 4,
      batchSize: 2,
      onProgress: stats => calls.push({...stats})
    })
  );
  const phases = calls.map(c => c.phase);
  t.ok(phases.includes('pre-sort'), 'pre-sort phase reported');
  t.ok(phases.includes('merge'), 'merge phase reported');
  const last = calls[calls.length - 1];
  t.equal(last.itemsRead, 10, 'final itemsRead');
});

test('polyphaseSort: throws when both compare and lessFn given', t => {
  t.throws(
    () => polyphaseSort([1, 2], {compare: asc, lessFn: lessAsc, tmpDir: '/tmp'}),
    /`compare` OR `lessFn`/
  );
});

test('polyphaseSort: throws when neither compare nor lessFn given', t => {
  t.throws(() => polyphaseSort([1, 2], {tmpDir: '/tmp'}), /`compare` or `lessFn` is required/);
});

test('polyphaseSort: throws when files and k both given', t => {
  t.throws(
    () =>
      polyphaseSort([1, 2], {
        compare: asc,
        files: [new MemoryWrapper(), new MemoryWrapper(), new MemoryWrapper()],
        k: 4
      }),
    /`files` OR `k`/
  );
});

test('polyphaseSort: throws when files too short', t => {
  t.throws(
    () => polyphaseSort([1, 2], {compare: asc, files: [new MemoryWrapper(), new MemoryWrapper()]}),
    /at least 3 wrappers/
  );
});

test('polyphaseSort: throws when k < 3', t => {
  t.throws(
    () => polyphaseSort([1, 2], {compare: asc, k: 2, tmpDir: '/tmp'}),
    /`k` must be an integer >= 3/
  );
});

test('polyphaseSort: throws when both tmpDir and createWrapper given', t => {
  t.throws(
    () =>
      polyphaseSort([1, 2], {
        compare: asc,
        tmpDir: '/tmp',
        createWrapper: () => new MemoryWrapper()
      }),
    /`tmpDir` OR `createWrapper`/
  );
});

test('polyphaseSort: throws when no storage given', t => {
  t.throws(() => polyphaseSort([1, 2], {compare: asc}), /either `files`/);
});

test('polyphaseSort: throws when batchSize invalid', t => {
  t.throws(
    () => polyphaseSort([1], {compare: asc, tmpDir: '/tmp', batchSize: 0}),
    /`batchSize` must be a positive integer/
  );
  t.throws(
    () => polyphaseSort([1], {compare: asc, tmpDir: '/tmp', batchSize: 1.5}),
    /`batchSize` must be a positive integer/
  );
});

test('polyphaseSort: throws on missing / non-iterable input', t => {
  t.throws(() => polyphaseSort(null, {compare: asc, tmpDir: '/tmp'}), /input is required/);
  t.throws(() => polyphaseSort(42, {compare: asc, tmpDir: '/tmp'}), /must be iterable/);
});

test('polyphaseSort: randomized property test vs Array.sort (correctness + stability)', async t => {
  const rand = mulberry32(0x5eed1234);
  const lengths = [0, 1, 2, 3, 5, 8, 13, 17, 31, 50, 97, 150];
  const batchSizes = [1, 2, 3, 7];
  const ks = [3, 4, 5, 7];
  let cases = 0;
  for (const n of lengths) {
    for (const batchSize of batchSizes) {
      for (const k of ks) {
        const items = [];
        for (let i = 0; i < n; ++i) items.push({key: Math.floor(rand() * 5), i});
        const compare = (a, b) => a.key - b.key;
        const expected = items
          .map((v, i) => [v, i])
          .sort((a, b) => compare(a[0], b[0]) || a[1] - b[1])
          .map(p => p[0]);
        const {out} = await sortInMem(items, {compare, batchSize, k});
        const ok =
          out.length === expected.length &&
          out.every((v, idx) => v.key === expected[idx].key && v.i === expected[idx].i);
        if (!ok) {
          t.fail(`mismatch n=${n} batchSize=${batchSize} k=${k}`);
          t.deepEqual(out, expected, `n=${n} batchSize=${batchSize} k=${k}`);
          return;
        }
        ++cases;
      }
    }
  }
  t.ok(cases > 0, `${cases} randomized cases passed`);
});

test('polyphaseSort: randomized numeric with duplicates and negatives', async t => {
  const rand = mulberry32(0xc0ffee);
  for (let trial = 0; trial < 40; ++trial) {
    const n = Math.floor(rand() * 200);
    const input = [];
    for (let i = 0; i < n; ++i) input.push(Math.floor(rand() * 40) - 20);
    const k = [3, 4, 5, 7][Math.floor(rand() * 4)];
    const batchSize = 1 + Math.floor(rand() * 9);
    const {out} = await sortInMem(input, {compare: asc, batchSize, k, stable: false});
    const expected = input.slice().sort(asc);
    t.deepEqual(out, expected, `trial ${trial} n=${n} k=${k} batchSize=${batchSize}`);
  }
});
