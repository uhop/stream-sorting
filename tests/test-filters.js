import test from 'tape-six';

import matching from '../src/sorted/matching.js';
import unmatched from '../src/sorted/unmatched.js';

import {collect, streamFromArray} from './helpers.js';

const byId = r => r.id;

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

test('matching: emits primary rows whose key is present in probe', async t => {
  const primary = [
    {id: 1, x: 'a'},
    {id: 2, x: 'b'},
    {id: 3, x: 'c'}
  ];
  const probe = [{id: 2}, {id: 3}, {id: 9}];
  const out = await collect(matching({input: primary, key: byId}, {input: probe, key: byId}));
  t.deepEqual(out, [
    {id: 2, x: 'b'},
    {id: 3, x: 'c'}
  ]);
});

test('unmatched: emits primary rows whose key is absent from probe', async t => {
  const primary = [
    {id: 1, x: 'a'},
    {id: 2, x: 'b'},
    {id: 3, x: 'c'}
  ];
  const probe = [{id: 2}];
  const out = await collect(unmatched({input: primary, key: byId}, {input: probe, key: byId}));
  t.deepEqual(out, [
    {id: 1, x: 'a'},
    {id: 3, x: 'c'}
  ]);
});

test('matching: different key shapes; probe is a bare key stream', async t => {
  const primary = [{userId: 1}, {userId: 2}, {userId: 3}];
  const probe = [2, 3]; // bare keys, key = identity
  const out = await collect(matching({input: primary, key: u => u.userId}, {input: probe}));
  t.deepEqual(out, [{userId: 2}, {userId: 3}]);
});

test('matching: primary duplicates are preserved; probe duplicates ignored', async t => {
  const primary = [
    {id: 1, n: 'a'},
    {id: 1, n: 'b'},
    {id: 2, n: 'c'}
  ];
  const probe = [{id: 1}, {id: 1}];
  const out = await collect(matching({input: primary, key: byId}, {input: probe, key: byId}));
  t.deepEqual(out, [
    {id: 1, n: 'a'},
    {id: 1, n: 'b'}
  ]);
});

test('filters: empty probe', async t => {
  const primary = [{id: 1}, {id: 2}];
  t.deepEqual(await collect(matching({input: primary, key: byId}, {input: []})), []);
  t.deepEqual(await collect(unmatched({input: primary, key: byId}, {input: []})), [
    {id: 1},
    {id: 2}
  ]);
});

test('filters: lessKey, async iterable, and Node Readable inputs', async t => {
  const primary = [1, 2, 3, 4];
  const probe = [2, 4];
  const out = await collect(
    matching({input: gen(primary)}, {input: streamFromArray(probe)}, {lessKey: (a, b) => a < b})
  );
  t.deepEqual(out, [2, 4]);
});

test('filters: detect an unsorted primary at runtime', async t => {
  const primary = [{id: 1}, {id: 3}, {id: 2}];
  const probe = [{id: 1}, {id: 2}, {id: 3}];
  const err = await rejects(() =>
    collect(matching({input: primary, key: byId}, {input: probe, key: byId}))
  );
  t.ok(err instanceof Error && /not sorted/.test(err.message), 'throws on unsorted primary');
});

test('filters: validation throws synchronously', async t => {
  t.throws(() => matching(42, {input: [1]}), /primary must be/, 'primary must be a descriptor');
  t.throws(() => matching({input: [1]}, {input: [1], key: 5}), /key/, 'key must be a function');
});
