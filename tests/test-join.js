import test from 'tape-six';

import join from '../src/sorted/join.js';
import leftJoin from '../src/sorted/left-join.js';
import fullJoin from '../src/sorted/full-join.js';

import {collect, streamFromArray} from './helpers.js';

const byId = r => r.id;

async function* gen(array) {
  for (const item of array) yield item;
}

test('join: inner join keeps only matched keys (default combine = named bag)', async t => {
  const a = [
    {id: 1, x: 'a1'},
    {id: 2, x: 'a2'},
    {id: 3, x: 'a3'}
  ];
  const b = [
    {id: 2, y: 'b2'},
    {id: 3, y: 'b3'},
    {id: 4, y: 'b4'}
  ];
  const out = await collect(join({a: {input: a, key: byId}, b: {input: b, key: byId}}));
  t.deepEqual(out, [
    {a: {id: 2, x: 'a2'}, b: {id: 2, y: 'b2'}},
    {a: {id: 3, x: 'a3'}, b: {id: 3, y: 'b3'}}
  ]);
});

test('join: custom combine receives the named bag', async t => {
  const a = [{id: 1, x: 'a1'}];
  const b = [{id: 1, y: 'b1'}];
  const out = await collect(
    join(
      {a: {input: a, key: byId}, b: {input: b, key: byId}},
      {combine: ({a, b}) => ({id: a.id, x: a.x, y: b.y})}
    )
  );
  t.deepEqual(out, [{id: 1, x: 'a1', y: 'b1'}]);
});

test('join: equal keys form a Cartesian product', async t => {
  const a = [
    {k: 1, n: 'a'},
    {k: 1, n: 'b'}
  ];
  const b = [
    {k: 1, m: 'x'},
    {k: 1, m: 'y'}
  ];
  const out = await collect(
    join(
      {a: {input: a, key: r => r.k}, b: {input: b, key: r => r.k}},
      {combine: ({a, b}) => `${a.n}${b.m}`}
    )
  );
  t.deepEqual(out, ['ax', 'ay', 'bx', 'by']);
});

test('join: different key extractors per input (heterogeneous tables)', async t => {
  const depts = [
    {deptId: 1, name: 'Sales'},
    {deptId: 2, name: 'Eng'}
  ];
  const emps = [
    {id: 10, dep: 1, who: 'Ann'},
    {id: 11, dep: 2, who: 'Bob'}
  ];
  const out = await collect(
    join(
      {dept: {input: depts, key: d => d.deptId}, emp: {input: emps, key: e => e.dep}},
      {combine: ({dept, emp}) => `${emp.who}@${dept.name}`}
    )
  );
  t.deepEqual(out, ['Ann@Sales', 'Bob@Eng']);
});

test('join: composite keys with an explicit compareKey', async t => {
  const a = [
    {d: 1, e: 1},
    {d: 1, e: 2},
    {d: 2, e: 1}
  ];
  const b = [
    {d: 1, e: 2},
    {d: 2, e: 1}
  ];
  const cmp = (x, y) => x[0] - y[0] || x[1] - y[1];
  const out = await collect(
    join(
      {a: {input: a, key: r => [r.d, r.e]}, b: {input: b, key: r => [r.d, r.e]}},
      {compareKey: cmp, combine: ({a}) => `${a.d}.${a.e}`}
    )
  );
  t.deepEqual(out, ['1.2', '2.1']);
});

test('join: lessKey is accepted as an alternative to compareKey', async t => {
  const a = [1, 2, 3];
  const b = [2, 3, 4];
  const out = await collect(
    join({a: {input: a}, b: {input: b}}, {lessKey: (x, y) => x < y, combine: ({a}) => a})
  );
  t.deepEqual(out, [2, 3]);
});

test('join: combine returning undefined drops the pair', async t => {
  const a = [{id: 1}, {id: 2}, {id: 3}];
  const b = [{id: 1}, {id: 2}, {id: 3}];
  const out = await collect(
    join(
      {a: {input: a, key: byId}, b: {input: b, key: byId}},
      {combine: ({a}) => (a.id === 2 ? undefined : a.id)}
    )
  );
  t.deepEqual(out, [1, 3]);
});

test('join: three-way inner join keeps keys present in all', async t => {
  const a = [{id: 1}, {id: 2}, {id: 3}];
  const b = [{id: 2}, {id: 3}, {id: 4}];
  const c = [{id: 3}, {id: 2}, {id: 5}].sort((x, y) => x.id - y.id);
  const out = await collect(
    join(
      {a: {input: a, key: byId}, b: {input: b, key: byId}, c: {input: c, key: byId}},
      {combine: ({a}) => a.id}
    )
  );
  t.deepEqual(out, [2, 3]);
});

test('join: per-input optional acts as a custom outer join', async t => {
  const a = [{id: 1}, {id: 2}, {id: 3}];
  const b = [{id: 2}];
  const out = await collect(
    join({a: {input: a, key: byId}, b: {input: b, key: byId, optional: true}})
  );
  t.deepEqual(out, [
    {a: {id: 1}, b: null},
    {a: {id: 2}, b: {id: 2}},
    {a: {id: 3}, b: null}
  ]);
});

test('join: empty inputs emit nothing', async t => {
  const out = await collect(join({a: {input: []}, b: {input: []}}));
  t.deepEqual(out, []);
});

test('join: accepts async iterables and Node Readables', async t => {
  const a = [{id: 1}, {id: 2}];
  const b = [{id: 2}, {id: 3}];
  const out = await collect(
    join(
      {a: {input: gen(a), key: byId}, b: {input: streamFromArray(b), key: byId}},
      {combine: ({a, b}) => a.id + b.id}
    )
  );
  t.deepEqual(out, [4]);
});

test('leftJoin: first input required, rest null-filled', async t => {
  const a = [{id: 1}, {id: 2}, {id: 3}];
  const b = [{id: 2, v: 'x'}];
  const out = await collect(leftJoin({a: {input: a, key: byId}, b: {input: b, key: byId}}));
  t.deepEqual(out, [
    {a: {id: 1}, b: null},
    {a: {id: 2}, b: {id: 2, v: 'x'}},
    {a: {id: 3}, b: null}
  ]);
});

test('fullJoin: emits for any key on any side', async t => {
  const a = [{id: 1}, {id: 3}];
  const b = [{id: 2}, {id: 3}];
  const out = await collect(fullJoin({a: {input: a, key: byId}, b: {input: b, key: byId}}));
  t.deepEqual(out, [
    {a: {id: 1}, b: null},
    {a: null, b: {id: 2}},
    {a: {id: 3}, b: {id: 3}}
  ]);
});

test('join: maxGroupSize guards a group blow-up', async t => {
  const a = [{k: 1}, {k: 1}, {k: 1}];
  const b = [{k: 1}];
  let err = null;
  try {
    await collect(
      join({a: {input: a, key: r => r.k}, b: {input: b, key: r => r.k}}, {maxGroupSize: 2})
    );
  } catch (e) {
    err = e;
  }
  t.ok(err instanceof RangeError, 'throws RangeError past maxGroupSize');
});

test('join: detects an unsorted input at runtime', async t => {
  const a = [{id: 1}, {id: 3}, {id: 2}];
  const b = [{id: 1}, {id: 2}, {id: 3}];
  let err = null;
  try {
    await collect(join({a: {input: a, key: byId}, b: {input: b, key: byId}}));
  } catch (e) {
    err = e;
  }
  t.ok(err instanceof Error && /not sorted/.test(err.message), 'throws on unsorted input');
});

test('join: validation throws synchronously at the call site', async t => {
  t.throws(() => join([], {}), /object map/, 'array is not a valid map');
  t.throws(() => join({a: {input: [1]}}), /at least two/, 'needs >= 2 inputs');
  t.throws(
    () => join({a: {input: [1]}, b: {input: [2]}}, {combine: 5}),
    /combine/,
    'combine must be a function'
  );
  t.throws(
    () => join({a: {input: [1]}, b: {key: byId}}),
    /\["b"\]/,
    'each descriptor needs an input'
  );
  t.throws(
    () => join({a: {input: [1]}, b: {input: [2]}}, {maxGroupSize: 0}),
    /maxGroupSize/,
    'maxGroupSize must be positive'
  );
});
