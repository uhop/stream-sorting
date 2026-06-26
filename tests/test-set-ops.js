import test from 'tape-six';

import merge from '../src/sorted/merge.js';
import union from '../src/sorted/union.js';
import intersection from '../src/sorted/intersection.js';
import difference from '../src/sorted/difference.js';

import {collect, streamFromArray} from './helpers.js';

const byV = (a, b) => a.v - b.v;

async function* gen(array) {
  for (const item of array) yield item;
}

const rejects = async fn => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

test('merge: k-way merge keeps duplicates, default natural order', async t => {
  t.deepEqual(
    await collect(
      merge([
        [1, 3],
        [2, 4]
      ])
    ),
    [1, 2, 3, 4]
  );
  t.deepEqual(
    await collect(
      merge([
        [1, 2],
        [1, 3]
      ])
    ),
    [1, 1, 2, 3]
  );
});

test('merge: stable on ties (lower stream index first)', async t => {
  const a = [
    {v: 1, s: 'a'},
    {v: 2, s: 'a'}
  ];
  const b = [{v: 1, s: 'b'}];
  t.deepEqual(await collect(merge([a, b], {compare: byV})), [
    {v: 1, s: 'a'},
    {v: 1, s: 'b'},
    {v: 2, s: 'a'}
  ]);
});

test('union: cross-stream and within-stream dedup', async t => {
  t.deepEqual(
    await collect(
      union([
        [1, 2, 3],
        [2, 3, 4]
      ])
    ),
    [1, 2, 3, 4]
  );
  t.deepEqual(
    await collect(
      union([
        [1, 1, 2],
        [2, 2, 5]
      ])
    ),
    [1, 2, 5]
  );
});

test('intersection: values present in all streams (deduped)', async t => {
  t.deepEqual(
    await collect(
      intersection([
        [1, 2, 3],
        [2, 3, 4]
      ])
    ),
    [2, 3]
  );
  t.deepEqual(
    await collect(
      intersection([
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5]
      ])
    ),
    [3]
  );
  t.deepEqual(
    await collect(
      intersection([
        [1, 1, 2, 2],
        [2, 2, 3]
      ])
    ),
    [2]
  );
});

test('intersection: disjoint streams yield nothing', async t => {
  t.deepEqual(
    await collect(
      intersection([
        [1, 3, 5],
        [2, 4, 6]
      ])
    ),
    []
  );
});

test('difference: first stream minus the rest (deduped)', async t => {
  t.deepEqual(await collect(difference([[1, 2, 3], [2]])), [1, 3]);
  t.deepEqual(await collect(difference([[1, 1, 2, 3, 3], [2]])), [1, 3]);
  t.deepEqual(await collect(difference([[1, 2, 3, 4], [2], [4]])), [1, 3]);
  t.deepEqual(await collect(difference([[1, 2, 3]])), [1, 2, 3]);
});

test('set-ops: object streams with a custom comparator', async t => {
  const a = [{v: 1}, {v: 2}, {v: 3}];
  const b = [{v: 2}, {v: 3}];
  t.deepEqual(await collect(intersection([a, b], {compare: byV})), [{v: 2}, {v: 3}]);
});

test('set-ops: accept lessFn, async iterables, and Node Readables', async t => {
  t.deepEqual(
    await collect(
      union(
        [
          [1, 2],
          [2, 3]
        ],
        {lessFn: (a, b) => a < b}
      )
    ),
    [1, 2, 3]
  );
  t.deepEqual(await collect(merge([gen([1, 3]), streamFromArray([2, 4])])), [1, 2, 3, 4]);
});

test('set-ops: empty inputs', async t => {
  t.deepEqual(await collect(merge([[], []])), []);
  t.deepEqual(await collect(union([[], [1]])), [1]);
  t.deepEqual(await collect(intersection([[], [1]])), []);
  t.deepEqual(await collect(difference([[], [1]])), []);
});

test('set-ops: detect an unsorted stream at runtime', async t => {
  const e1 = await rejects(() => collect(merge([[3, 1]])));
  t.ok(e1 instanceof Error && /not sorted/.test(e1.message), 'merge throws');
  // The backward item (2 after 3) is consumed at the end because the other stream outlives it.
  const e2 = await rejects(() =>
    collect(
      intersection([
        [1, 3, 2],
        [1, 2, 3, 4]
      ])
    )
  );
  t.ok(e2 instanceof Error && /not sorted/.test(e2.message), 'intersection throws');
});

test('set-ops: validation throws synchronously', async t => {
  t.throws(() => merge('nope'), /array/, 'streams must be an array');
  t.throws(() => merge([]), /at least 1/, 'merge needs >= 1');
  t.throws(() => intersection([[1]]), /at least 2/, 'intersection needs >= 2');
  t.throws(() => union([[1], 5]), /\[1\]/, 'each stream must be iterable');
});
