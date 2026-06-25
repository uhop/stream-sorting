# stream-sorting [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/stream-sorting.svg
[npm-url]: https://npmjs.org/package/stream-sorting

`stream-sorting` is a streaming sort plus a suite of operations that consume or produce sorted [object-mode Readable](https://nodejs.org/api/stream.html#stream_object_mode) streams. The headline operation is a **disk-backed external merge sort** designed to sort a billion records on a laptop without OOMing. On top of the sort, the package builds:

- **`join`** / **`leftJoin`** / **`fullJoin`** — key-based join of sorted streams (inner and outer)
- **`union`** / **`intersection`** / **`difference`** — set operations on sorted streams
- **`merge`** — k-way sorted merge without deduplication

`stream-sorting` is part of the `stream-chain` / `stream-json` family. Scope: anything that **requires or preserves sortedness**. Combinators that know nothing about sortedness (`zip`, `select`, `race`, `concat`) live in [`stream-join`](https://www.npmjs.com/package/stream-join); 1→N split / route / filter ops live in [`stream-fork`](https://www.npmjs.com/package/stream-fork). **Node-only** — the package targets server / CLI contexts; browser is out of scope (`node:fs` is load-bearing for the disk-backed sort).

Runtime dependencies: [`stream-chain`](https://www.npmjs.com/package/stream-chain) and [`stream-join`](https://www.npmjs.com/package/stream-join). The k-way-merge phase of the sort composes `stream-join`'s `mergeSorted` (built on `select` + `sortedInsert`); `polyphaseSort` and the join family use custom group-aware merges where a flat merge can't express their sub-stream structure. Distributed under New BSD license.

## Status

**Early development.** The object-stream wrapper protocol, both sort algorithms (`sort`, `polyphaseSort`), and the join family (`join`, `leftJoin`, `fullJoin`) are implemented; the remaining sorted-stream operations (filters, `aggregate`, set ops, `merge`) are planned. See the [wiki](https://github.com/uhop/stream-sorting/wiki) for usage and `ARCHITECTURE.md` for the design.

## Installation

```bash
npm i stream-sorting
```

## API

Object-mode in, object-mode out: every operation accepts `AsyncIterable<T> | Iterable<T>` and returns an `AsyncIterable<T>`. Options, examples, and design notes live in the [wiki](https://github.com/uhop/stream-sorting/wiki).

```js
import sort from 'stream-sorting/sort.js';

for await (const item of sort(input, {compare: (a, b) => a.id - b.id, tmpDir: '/var/sort'})) {
  // items in ascending id order
}
```

### Implemented

- **[`sort`](https://github.com/uhop/stream-sorting/wiki/sort)** — disk-backed external (k-way) merge sort. The headline operation.
- **[`polyphaseSort`](https://github.com/uhop/stream-sorting/wiki/polyphaseSort)** — polyphase merge sort; a fixed file budget, for bounded or heterogeneous storage.
- **Wrapper protocol** — [`ObjectStreamWrapper`](https://github.com/uhop/stream-sorting/wiki/ObjectStreamWrapper) with built-in [`MemoryWrapper`](https://github.com/uhop/stream-sorting/wiki/MemoryWrapper) and [`LocalFileWrapper`](https://github.com/uhop/stream-sorting/wiki/LocalFileWrapper). The storage abstraction the sorts read and write through, so a sort can exceed any single disk.
- **[`join`](https://github.com/uhop/stream-sorting/wiki/join)** / **[`leftJoin`](https://github.com/uhop/stream-sorting/wiki/leftJoin)** / **[`fullJoin`](https://github.com/uhop/stream-sorting/wiki/fullJoin)** — key-based join of two or more sorted streams; named-map inputs, Cartesian product on equal keys, `combine` over a named bag, inner + outer shapes.

### Planned

- **`matching`** / **`unmatched`** — filters: rows of the primary stream whose key is present / absent in the other.
- **`aggregate`** — fold child streams under a master (or a key-derived group) by key; SQL-style group/aggregate.
- **`union`** / **`intersection`** / **`difference`** — set operations on sorted streams.
- **`merge`** — k-way sorted merge without deduplication; the suite's foundational op.

## Family

| Package                                                | Scope                                                |
| ------------------------------------------------------ | ---------------------------------------------------- |
| [`stream-chain`](https://github.com/uhop/stream-chain) | Pipeline plumbing: `chain`, `readableFrom`, `final`. |
| [`stream-json`](https://github.com/uhop/stream-json)   | JSON streaming parser / generator.                   |
| [`stream-join`](https://github.com/uhop/stream-join)   | N→1 combinators that know nothing about sortedness.  |
| [`stream-fork`](https://github.com/uhop/stream-fork)   | 1→N split / route / filter.                          |
| **`stream-sorting`**                                   | **Sort + sorted-stream operations.**                 |

Together, the family closes the billion-row pipeline story end-to-end in pure Node streams: sort each input with `stream-sorting`, `join` the sorted streams, fork the output downstream.

## Documentation

- AI agent rules: `AGENTS.md`.
- Architecture: `ARCHITECTURE.md`.
- AI-facing reference: `llms.txt` (short) and `llms-full.txt` (long).
- Wiki (usage docs, design notes): <https://github.com/uhop/stream-sorting/wiki>.

## Release notes

_Initial scaffold._
