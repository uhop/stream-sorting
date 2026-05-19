# stream-sorting [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/stream-sorting.svg
[npm-url]: https://npmjs.org/package/stream-sorting

`stream-sorting` is a streaming sort plus a suite of operations that consume or produce sorted [object-mode Readable](https://nodejs.org/api/stream.html#stream_object_mode) streams. The headline operation is a **disk-backed external merge sort** designed to sort a billion records on a laptop without OOMing. On top of the sort, the package builds:

- **`mergeJoin`** / **`joinBy`** — SQL-style key-based join of sorted streams (inner / left / right / full)
- **`union`** / **`intersection`** / **`difference`** — set operations on sorted streams
- **`mergeSorted`** — k-way sorted merge without deduplication

`stream-sorting` is part of the `stream-chain` / `stream-json` family. Scope: anything that **requires or preserves sortedness**. Combinators that know nothing about sortedness (`zip`, `select`, `race`, `concat`) live in [`stream-join`](https://www.npmjs.com/package/stream-join); 1→N split / route / filter ops live in [`stream-fork`](https://www.npmjs.com/package/stream-fork).

Runtime dependency today: [`stream-chain`](https://www.npmjs.com/package/stream-chain). The k-way-merge phase of the sort, and every sorted-stream operation in the suite, composes [`stream-join`](https://github.com/uhop/stream-join)'s `select` + `sortedInsert` primitives rather than reimplementing them; `stream-join` becomes a second runtime dependency once its 2.0.0 publishes. Distributed under New BSD license.

## Status

**Scaffold phase.** The package layout, conventions, and intended API surface are in place; component implementations land incrementally. See the [wiki](https://github.com/uhop/stream-sorting/wiki) for current state and `ARCHITECTURE.md` for the design.

## Installation

```bash
npm i stream-sorting
```

## Planned API

### `sort(stream, options)` — external merge sort

```js
const sort = require('stream-sorting/sort');

const sorted = sort(input, {
  compare: (a, b) => a.id - b.id,
  memoryBudget: 64 * 1024 * 1024,
  tmpDir: '/tmp',
  cleanup: true
});

sorted.pipe(downstream);
```

Items accumulate in an in-memory buffer up to `memoryBudget`, are sorted with `Array.prototype.sort(compare)`, and flushed to a run file under `tmpDir`. The runs are then k-way-merged streaming-style. Comparator semantics match `Array.prototype.sort` — `(a, b) => number`, negative if `a < b`.

### `mergeJoin(streamA, streamB, options)` / `joinBy`

```js
const mergeJoin = require('stream-sorting/merge-join');

const joined = mergeJoin(left, right, {
  keyFn: row => row.id,
  combine: (a, b) => ({...a, ...b}),
  variant: 'inner' // 'inner' | 'left' | 'right' | 'full'
});
```

**Pre-condition:** both inputs are sorted by the join key. Walks both streams via `stream-join`'s `select` + `sortedInsert(byKey)`; emits combined rows when keys match.

### Set operations on sorted streams

- `union(streams, lessFn)` — sorted merge with cross-stream deduplication. `{1,2,3} ∪ {2,3,4} = {1,2,3,4}`.
- `intersection(streams, lessFn)` — values present in all input streams.
- `difference(streamA, streamsB, lessFn)` — values in `streamA` not in any `streamsB[i]`.

### `mergeSorted(streams, lessFn, options?)`

K-way sorted merge without deduplication. The suite's foundational operation.

## Family

| Package | Scope |
|---|---|
| [`stream-chain`](https://github.com/uhop/stream-chain) | Pipeline plumbing: `chain`, `readableFrom`, `final`. |
| [`stream-json`](https://github.com/uhop/stream-json) | JSON streaming parser / generator. |
| [`stream-join`](https://github.com/uhop/stream-join) | N→1 combinators that know nothing about sortedness. |
| [`stream-fork`](https://github.com/uhop/stream-fork) | 1→N split / route / filter. |
| **`stream-sorting`** | **Sort + sorted-stream operations.** |

Together, the family closes the billion-row pipeline story end-to-end in pure Node streams: sort each input with `stream-sorting`, `mergeJoin` the sorted streams, fork the output downstream.

## Documentation

- AI agent rules: `AGENTS.md`.
- Architecture: `ARCHITECTURE.md`.
- AI-facing reference: `llms.txt` (short) and `llms-full.txt` (long).
- Wiki (usage docs, design notes): <https://github.com/uhop/stream-sorting/wiki>.

## Release notes

_Initial scaffold._
