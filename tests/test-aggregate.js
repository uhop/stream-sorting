import test from 'tape-six';

import aggregate from '../src/sorted/aggregate.js';

import {collect, streamFromArray} from './helpers.js';

const byId = r => r.id;
const byDept = r => r.deptId;

async function* gen(array) {
  for (const item of array) yield item;
}

test('aggregate: master mode nests a child group under each master row', async t => {
  const depts = [
    {id: 1, name: 'Sales'},
    {id: 2, name: 'Eng'}
  ];
  const emps = [
    {deptId: 1, who: 'Ann'},
    {deptId: 1, who: 'Bob'},
    {deptId: 2, who: 'Cid'}
  ];
  const out = await collect(
    aggregate({input: depts, key: byId}, {employees: {input: emps, key: byDept}})
  );
  t.deepEqual(out, [
    {
      id: 1,
      name: 'Sales',
      employees: [
        {deptId: 1, who: 'Ann'},
        {deptId: 1, who: 'Bob'}
      ]
    },
    {id: 2, name: 'Eng', employees: [{deptId: 2, who: 'Cid'}]}
  ]);
});

test('aggregate: master with no child items gets an empty group (finalize(init()))', async t => {
  const depts = [{id: 1}, {id: 2}, {id: 3}];
  const emps = [{deptId: 2, who: 'Bob'}];
  const out = await collect(
    aggregate({input: depts, key: byId}, {employees: {input: emps, key: byDept}})
  );
  t.deepEqual(out, [
    {id: 1, employees: []},
    {id: 2, employees: [{deptId: 2, who: 'Bob'}]},
    {id: 3, employees: []}
  ]);
});

test('aggregate: child items with no master are dropped (orphans)', async t => {
  const depts = [{id: 2}];
  const emps = [
    {deptId: 1, who: 'Ann'},
    {deptId: 2, who: 'Bob'},
    {deptId: 3, who: 'Cid'}
  ];
  const out = await collect(
    aggregate({input: depts, key: byId}, {employees: {input: emps, key: byDept}})
  );
  t.deepEqual(out, [{id: 2, employees: [{deptId: 2, who: 'Bob'}]}]);
});

test('aggregate: group-by mode synthesizes the master from the key', async t => {
  const emps = [
    {deptId: 1, who: 'Ann'},
    {deptId: 1, who: 'Bob'},
    {deptId: 2, who: 'Cid'}
  ];
  const out = await collect(
    aggregate(deptId => ({id: deptId}), {employees: {input: emps, key: byDept}})
  );
  t.deepEqual(out, [
    {
      id: 1,
      employees: [
        {deptId: 1, who: 'Ann'},
        {deptId: 1, who: 'Bob'}
      ]
    },
    {id: 2, employees: [{deptId: 2, who: 'Cid'}]}
  ]);
});

test('aggregate: scalar fold via init / fold / finalize (count + average)', async t => {
  const depts = [{id: 1}, {id: 2}];
  const salaries = [
    {deptId: 1, amt: 100},
    {deptId: 1, amt: 200},
    {deptId: 2, amt: 90}
  ];
  const out = await collect(
    aggregate(
      {input: depts, key: byId},
      {
        headcount: {input: salaries, key: byDept, init: () => 0, fold: n => n + 1},
        avg: {
          input: salaries,
          key: byDept,
          init: () => ({sum: 0, n: 0}),
          fold: (acc, r) => ({sum: acc.sum + r.amt, n: acc.n + 1}),
          finalize: acc => (acc.n ? acc.sum / acc.n : 0)
        }
      }
    )
  );
  t.deepEqual(out, [
    {id: 1, headcount: 2, avg: 150},
    {id: 2, headcount: 1, avg: 90}
  ]);
});

test('aggregate: multiple child inputs under one master', async t => {
  const depts = [{id: 1}, {id: 2}];
  const emps = [
    {deptId: 1, who: 'Ann'},
    {deptId: 2, who: 'Bob'}
  ];
  const rooms = [
    {deptId: 1, room: 'A'},
    {deptId: 1, room: 'B'}
  ];
  const out = await collect(
    aggregate(
      {input: depts, key: byId},
      {
        employees: {input: emps, key: byDept},
        rooms: {input: rooms, key: byDept, init: () => 0, fold: n => n + 1}
      }
    )
  );
  t.deepEqual(out, [
    {id: 1, employees: [{deptId: 1, who: 'Ann'}], rooms: 2},
    {id: 2, employees: [{deptId: 2, who: 'Bob'}], rooms: 0}
  ]);
});

test('aggregate: required child drops masters with an empty group', async t => {
  const depts = [{id: 1}, {id: 2}, {id: 3}];
  const emps = [{deptId: 1}, {deptId: 3}];
  const out = await collect(
    aggregate(
      {input: depts, key: byId},
      {employees: {input: emps, key: byDept, required: true}},
      {combine: (d, {employees}) => ({id: d.id, n: employees.length})}
    )
  );
  t.deepEqual(out, [
    {id: 1, n: 1},
    {id: 3, n: 1}
  ]);
});

test('aggregate: custom combine receives (master, parts)', async t => {
  const depts = [{id: 1, name: 'Sales'}];
  const emps = [
    {deptId: 1, who: 'Ann'},
    {deptId: 1, who: 'Bob'}
  ];
  const out = await collect(
    aggregate(
      {input: depts, key: byId},
      {employees: {input: emps, key: byDept}},
      {combine: (dept, {employees}) => `${dept.name}: ${employees.map(e => e.who).join(', ')}`}
    )
  );
  t.deepEqual(out, ['Sales: Ann, Bob']);
});

test('aggregate: duplicate master keys collapse to one row (first wins by default)', async t => {
  const depts = [
    {id: 1, tag: 'a'},
    {id: 1, tag: 'b'}
  ];
  const emps = [{deptId: 1, who: 'Ann'}];
  const out = await collect(
    aggregate({input: depts, key: byId}, {employees: {input: emps, key: byDept}})
  );
  t.deepEqual(out, [{id: 1, tag: 'a', employees: [{deptId: 1, who: 'Ann'}]}]);
});

test('aggregate: a master fold can merge duplicate master rows', async t => {
  const depts = [
    {id: 1, tags: ['a']},
    {id: 1, tags: ['b']},
    {id: 2, tags: ['c']}
  ];
  const emps = [{deptId: 1}, {deptId: 2}];
  const out = await collect(
    aggregate(
      {
        input: depts,
        key: byId,
        init: () => null,
        fold: (acc, d) => (acc ? {...acc, tags: [...acc.tags, ...d.tags]} : d)
      },
      {employees: {input: emps, key: byDept, init: () => 0, fold: n => n + 1}}
    )
  );
  t.deepEqual(out, [
    {id: 1, tags: ['a', 'b'], employees: 1},
    {id: 2, tags: ['c'], employees: 1}
  ]);
});

test('aggregate: composite key with an explicit compareKey', async t => {
  const parents = [
    {a: 1, b: 1},
    {a: 1, b: 2}
  ];
  const kids = [
    {a: 1, b: 1, v: 'x'},
    {a: 1, b: 2, v: 'y'},
    {a: 1, b: 2, v: 'z'}
  ];
  const key = r => [r.a, r.b];
  const out = await collect(
    aggregate(
      {input: parents, key},
      {kids: {input: kids, key}},
      {
        compareKey: (x, y) => x[0] - y[0] || x[1] - y[1],
        combine: (p, {kids}) => `${p.a}.${p.b}:${kids.length}`
      }
    )
  );
  t.deepEqual(out, ['1.1:1', '1.2:2']);
});

test('aggregate: accepts async iterables and Node Readables', async t => {
  const depts = [{id: 1}, {id: 2}];
  const emps = [{deptId: 1}, {deptId: 2}, {deptId: 2}];
  const out = await collect(
    aggregate(
      {input: gen(depts), key: byId},
      {employees: {input: streamFromArray(emps), key: byDept, init: () => 0, fold: n => n + 1}}
    )
  );
  t.deepEqual(out, [
    {id: 1, employees: 1},
    {id: 2, employees: 2}
  ]);
});

test('aggregate: empty master emits nothing', async t => {
  const out = await collect(
    aggregate({input: [], key: byId}, {employees: {input: [{deptId: 1}], key: byDept}})
  );
  t.deepEqual(out, []);
});

test('aggregate: maxGroupSize guards a runaway group', async t => {
  const depts = [{id: 1}];
  const emps = [{deptId: 1}, {deptId: 1}, {deptId: 1}];
  let err = null;
  try {
    await collect(
      aggregate(
        {input: depts, key: byId},
        {employees: {input: emps, key: byDept}},
        {maxGroupSize: 2}
      )
    );
  } catch (e) {
    err = e;
  }
  t.ok(err instanceof RangeError, 'throws RangeError past maxGroupSize');
});

test('aggregate: detects an unsorted child within the consumed range', async t => {
  // The backward key (1 after 2) is reached as an orphan at master key 3, so it is checked.
  const depts = [{id: 2}, {id: 3}];
  const emps = [{deptId: 2}, {deptId: 1}];
  let err = null;
  try {
    await collect(aggregate({input: depts, key: byId}, {employees: {input: emps, key: byDept}}));
  } catch (e) {
    err = e;
  }
  t.ok(err instanceof Error && /not sorted/.test(err.message), 'throws on unsorted child');
});

test('aggregate: group-by mode detects an unsorted child', async t => {
  const emps = [{deptId: 1}, {deptId: 3}, {deptId: 2}];
  let err = null;
  try {
    await collect(aggregate(id => ({id}), {employees: {input: emps, key: byDept}}));
  } catch (e) {
    err = e;
  }
  t.ok(err instanceof Error && /not sorted/.test(err.message), 'throws on unsorted child');
});

test('aggregate: detects an unsorted master at runtime', async t => {
  const depts = [{id: 1}, {id: 3}, {id: 2}];
  const emps = [{deptId: 1}, {deptId: 2}, {deptId: 3}];
  let err = null;
  try {
    await collect(aggregate({input: depts, key: byId}, {employees: {input: emps, key: byDept}}));
  } catch (e) {
    err = e;
  }
  t.ok(err instanceof Error && /not sorted/.test(err.message), 'throws on unsorted master');
});

test('aggregate: validation throws synchronously at the call site', async t => {
  t.throws(
    () => aggregate(42, {a: {input: [1]}}),
    /master must be/,
    'master must be fn or descriptor'
  );
  t.throws(() => aggregate({input: [1], key: byId}, {}), /at least one child/, 'needs >= 1 child');
  t.throws(
    () => aggregate({input: [1], key: byId}, {a: {input: [1], fold: 5}}),
    /fold/,
    'fold must be a function'
  );
  t.throws(
    () => aggregate({input: [1], key: byId}, {a: {key: byId}}),
    /\["a"\]/,
    'each child needs an input'
  );
});
