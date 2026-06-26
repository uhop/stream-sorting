import test from 'tape-six';

import sortJsonl from '../src/utils/sort-jsonl.js';
import MemoryWrapper from '../src/memory-wrapper.js';

import {collect} from './helpers.js';

const byId = (a, b) => a.id - b.id;
const mem = () => ({createWrapper: () => new MemoryWrapper()});

async function* gen(array) {
  for (const item of array) yield item;
}

test('sortJsonl: sorts a text JSONL stream and re-emits JSONL text', async t => {
  const out = await collect(
    sortJsonl(['{"id":3}\n{"id":1}\n{"id":2}\n'], {compare: byId, ...mem()})
  );
  t.equal(out.join(''), '{"id":1}\n{"id":2}\n{"id":3}\n');
});

test('sortJsonl: handles lines split across chunks', async t => {
  const out = await collect(
    sortJsonl(['{"id":3}\n{"i', 'd":1}\n{"id', '":2}\n'], {compare: byId, ...mem()})
  );
  t.equal(out.join(''), '{"id":1}\n{"id":2}\n{"id":3}\n');
});

test('sortJsonl: a final line without a trailing newline is included', async t => {
  const out = await collect(sortJsonl(['{"id":2}\n{"id":1}'], {compare: byId, ...mem()}));
  t.equal(out.join(''), '{"id":1}\n{"id":2}\n');
});

test('sortJsonl: custom parse and stringify hooks', async t => {
  const out = await collect(
    sortJsonl(['b=2\na=1\n'], {
      compare: (a, b) => a.k - b.k,
      parse: line => {
        const [key, v] = line.split('=');
        return {key, k: Number(v)};
      },
      stringify: item => `${item.key}=${item.k}`,
      ...mem()
    })
  );
  t.equal(out.join(''), 'a=1\nb=2\n');
});

test('sortJsonl: accepts an async iterable of chunks', async t => {
  const out = await collect(
    sortJsonl(gen(['{"id":2}\n', '{"id":1}\n']), {compare: byId, ...mem()})
  );
  t.equal(out.join(''), '{"id":1}\n{"id":2}\n');
});

test('sortJsonl: empty input emits nothing', async t => {
  const out = await collect(sortJsonl([], {compare: byId, ...mem()}));
  t.deepEqual(out, []);
});

test('sortJsonl: bad options throw synchronously (delegated to sort)', async t => {
  t.throws(() => sortJsonl(['{}\n'], {...mem()}), /compare|lessFn/, 'needs a comparator');
  t.throws(() => sortJsonl(null, {compare: byId, ...mem()}), /sortJsonl/, 'input required');
});
