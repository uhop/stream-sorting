# Architecture

`stream-sorting` is a streaming sort plus a suite of operations on sorted object-mode `Readable` streams. The scope rule for the family: **anything that requires or preserves sortedness lives here.** Combinators that know nothing about sortedness (`zip`, `select`, `race`, `concat`) live in [`stream-join`](https://github.com/uhop/stream-join); 1→N split / route / filter ops live in [`stream-fork`](https://github.com/uhop/stream-fork); cross-cutting pipeline plumbing (`readableFrom`, `chain`) lives in [`stream-chain`](https://github.com/uhop/stream-chain).

**Node-only.** The package targets server / CLI contexts. The disk-backed sort relies on `node:fs`, `node:os`, `node:path`; there is no web entry point and no browser test surface. Sorting at billion-record scale is a server problem.

The package is currently in scaffold phase. The wrapper protocol and its two built-in implementations have shipped (see below); the algorithms that compose them are still **(planned)**.

## Project layout

```
package.json                  # Package config; "tape6" section configures test discovery
src/                          # Source code (one main component per file at root)
├── index.js                  # Entry point
├── index.d.ts
└── utils/                    # Helpers users compose with the main components
tests/                        # Test files (test-*.js using tape-six) + helpers.js
dev-docs/                     # Internal design notes (not in the published tarball)
wiki/                         # GitHub wiki documentation (git submodule)
.github/                      # CI workflows, Dependabot config
```

The split between `src/` root and `src/utils/` is structural: **main components** stay at root; **helpers users compose with main components** go under `utils/`. Same convention as `stream-join`.

## Object-stream wrapper protocol (shipped)

The wrapper protocol — interface, base classes, and the `consume` helper — lives at `src/wrapper.js`. Every algorithm in the package operates against `ObjectStreamWrapper<T>`. The contract is **runtime-agnostic** — no `node:stream` or Web Streams types appear — so wrappers can use whatever internal mechanism best fits their backing store (Node FS streams for local files, AWS SDK for S3, async generators for arrays, Web Streams if benchmarks show them faster):

```ts
class ItemWriter<T> {
  write(item: T): Promise<void>; // backpressure-aware (abstract)
  writeAll(source: AsyncIterable<T> | Iterable<T>): Promise<void>; // default: write loop
  end(): Promise<void>; // idempotent (abstract)
  readonly ended: boolean; // flips sync inside end() (abstract)
}

class ObjectStreamWrapper<T = unknown> {
  openWriter(): ItemWriter<T>;
  openReader(): AsyncIterable<T>; // iterator.return() releases per-read resources
  close(): Promise<void>; // coarse-grained: abandon current mode
  delete(): Promise<void>; // idempotent; removes underlying storage
}
```

Both are real JS classes — subclass them for `instanceof` checks and to inherit `ItemWriter.writeAll`'s default loop (subclasses override `writeAll` only if storage offers a smarter bulk path). Plain objects matching the shape also work (structural typing).

**Mode-exclusive.** A wrapper is `idle`, `writing`, or `reading` at any moment. `openWriter()` while reading throws (and vice versa); call `close()` first. Both built-in algorithms write-then-read, never both at once.

**Cleanup via `return()`.** The iterator returned from `openReader()[Symbol.asyncIterator]()` implements `return()`, so resources are released automatically when the consumer `break`s from `for await` or an exception unwinds the loop. The wrapper-level `wrapper.close()` is the coarse-grained escape hatch — useful when a session is abandoned without iterating, or as defensive cleanup before `delete()`.

**Built-in wrappers:**

- **`MemoryWrapper`** — array-backed. For tests, small data, and benchmarking the algorithm independently of disk. Re-reads after a closed session replay the same items.
- **`LocalFileWrapper`** — local-filesystem-backed. Default framing is JSON-line-delimited; the read path uses stream-chain's `gen(fixUtf8Stream(), lines(), deserialize)` (UTF-8-safe across chunk boundaries; compatible with stream-chain's `jsonl/parserStream`). `serialize` / `deserialize` options take per-item functions; result must not contain `\n`. **`path` is required** — no default `tmpDir`, because Linux `/tmp` is commonly tmpfs (RAM-backed) and would silently defeat the disk-backed sort.

**`consume(writer, source)` helper** (at `src/wrapper.js`, alongside the bases): one-shot convenience equivalent to `await writer.writeAll(source); await writer.end();`. Use when you have all the items in hand and don't need imperative control over per-item writes.

## Main components (planned)

### `sort(stream, options)` — external merge sort

**Strategy:** disk-backed external merge sort.

1. **Run-formation phase.** Pull items from the input stream into an in-memory buffer of size ≤ `memoryBudget`. When the buffer is full (or input ends), sort it in memory via `Array.prototype.sort(compare)` and flush it to a file under `tmpDir` as a single sorted run.
2. **k-way-merge phase.** Open all run files as object-mode Readable streams. Compose `select` + `sortedInsert(lessFn)` from [`stream-join`](https://github.com/uhop/stream-join) to produce the merged sorted output. Yield through `readableFrom` from [`stream-chain`](https://github.com/uhop/stream-chain) so downstream backpressure flows naturally.

**Why disk-backed.** The design point is "sort a billion records on a laptop without OOMing." Two alternatives floated during design were rejected: an in-memory-only buffer (does not scale), and a sliding-window approximate sort (does not actually sort — items can come out unordered when the window is too small for the input's disorder).

**Options:**

- `compare: (a, b) => number` — comparator, semantics identical to `Array.prototype.sort`.
- `memoryBudget?: number` — soft cap on in-memory items per run (heuristic, since item size varies). Default TBD; likely ~64 MB equivalent.
- `tmpDir?: string` — directory for run files. **Required** for `LocalFileWrapper` — no default (Linux `/tmp` is commonly tmpfs / RAM-backed and would defeat the algorithm's whole purpose). See `dev-docs/initial.md` for the rationale.
- `cleanup?: boolean` — delete run files after the merge ends or errors. Default: `true`.
- `serialize?: (item) => Buffer | string` / `deserialize?: (chunk) => item` — on-disk encoding hooks. Default: JSON line-delimited.

### `mergeJoin(streamA, streamB, options)` / `joinBy` — key-based sorted join (planned)

SQL-style join of two sorted streams. **Pre-condition:** both inputs are sorted by the join key. Walks both via `stream-join`'s `select` + `sortedInsert(byKey)`; emits combined rows when keys match.

**Options:**

- `keyFn?: (item) => key` (or `keyA` / `keyB` if the two sides use different field names).
- `compareKey?: (a, b) => number` — defaults to default comparison.
- `combine?: (rowA, rowB) => merged` — defaults to `{...rowA, ...rowB}`.
- `variant?: 'inner' | 'left' | 'right' | 'full'` — default `'inner'`. Non-matches emit a row with `null` on the missing side for `left`/`right`/`full`, skipped for `inner`.

Closes the long-standing user request on `stream-join` for "join two large feeds by ID."

### Set operations on sorted streams (planned)

All take N sorted input streams (2 for `difference`) plus a comparator and emit a sorted output stream.

- **`union(streams, lessFn)`** — sorted merge with **duplicate elimination across streams**: `{1,2,3} ∪ {2,3,4} = {1,2,3,4}` (distinct from plain `mergeSorted` which would emit `{1,2,2,3,3,4}`). Implemented as `select` + `sortedInsert` wrapping the picker with "skip if equal to last emitted."
- **`intersection(streams, lessFn)`** — emit values present in **all** streams. 2-way case: walk both, emit when keys match, advance the smaller side otherwise. k-way: extension via simultaneous key-tracking across streams.
- **`difference(streamA, ...streamsB, lessFn)`** — emit values in `streamA` not present in any `streamsB[i]`.

### `mergeSorted(streams, lessFn, options?)` — sorted merge without dedup (planned)

The suite's foundational operation: a k-way sorted merge of input streams under a `lessFn`. Same primitive as `stream-join/utils/merge-sorted`. Open decision (see vault `projects/stream-sorting/queue.md`): (a) move it here and have `stream-join` delete its copy; (b) leave `stream-join`'s copy as a back-compat alias re-exporting from `stream-sorting`; (c) accept the duplication. To be settled when `stream-sorting` reaches publish-readiness.

## Helpers (`src/utils/`, planned)

Helpers compose with the main components. Likely candidates:

- Run-file serializer / deserializer adapters (JSON line-delimited default; pluggable for other encodings).
- Key-extraction adapters around `compare` → `lessFn` for the set ops.
- Common comparator builders (e.g., `byKey('field')`, `byKeys(['field1', 'field2'])`, `byKey('field', desc)`).

## Module dependency graph (target)

```
src/index.js → src/wrapper.js             (shipped — protocol bases + consume)
            → src/memory-wrapper.js       (shipped — array-backed)
            → src/local-file-wrapper.js   (shipped — local FS, JSONL default)
            → src/sort.js, src/merge-join.js, src/union.js,
              src/intersection.js, src/difference.js, src/merge-sorted.js
                        ↓
                   stream-join (select, sortedInsert, pickFirst)
                        ↓
                   stream-chain (readableFrom; jsonl utils, gen, asStream)
```

Runtime dependencies: `stream-chain` and `stream-join`. The disk-backed sort additionally relies on Node built-ins (`node:fs`, `node:os`, `node:path`, `node:stream`).

## Backpressure

Pull-based, end-to-end. The output Readable (from `readableFrom`) advances only when its downstream consumer asks for data; the merge generator pulls from run-file Readables as the output is drained; run-file Readables themselves apply normal Node stream backpressure to the OS read calls. No buffering is added between layers beyond the sort's run-formation buffer.

## Error handling

Errors propagate end-to-end with the original value preserved (same model as `stream-join` — see its ARCHITECTURE.md for the puller-level mechanics). For the disk-backed sort:

- Errors during run formation drop the in-memory buffer and reject the output.
- Errors during merge close all open run-file streams, then reject the output.
- `cleanup: true` (default) deletes any run files written so far on error.

## Testing

- **Framework:** `tape-six` (`tape6`).
- **Run all:** `npm test` (parallel workers via `tape6 --flags FO`).
- **Run single file:** `node tests/test-<name>.js`.
- **Run with Bun:** `npm run test:bun`.
- **Run with Deno:** `npm run test:deno`.
- **TypeScript check:** `npm run ts-check`.
- **`tsc --checkJs` against the JS sources:** `npm run js-check`.
- **Typing tests:** `npm run ts-test`.
- **Lint:** `npm run lint` (Prettier check).
- **Lint fix:** `npm run lint:fix` (Prettier write).

## Import paths (target)

```js
import sort from 'stream-sorting/sort.js';
import mergeJoin from 'stream-sorting/merge-join.js';
import union from 'stream-sorting/union.js';
import intersection from 'stream-sorting/intersection.js';
import difference from 'stream-sorting/difference.js';
import mergeSorted from 'stream-sorting/merge-sorted.js';

// Helper builders
import byKey from 'stream-sorting/utils/by-key.js';
```

The default export from `import 'stream-sorting'` is TBD — likely `sort` since it is the headline operation, mirroring `stream-join`'s pattern of defaulting to its headline `zip`.

## Family positioning

| Package                                                | Scope                                                                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`stream-chain`](https://github.com/uhop/stream-chain) | Pipeline plumbing: `chain`, `readableFrom`, `final`.                                                                                                       |
| [`stream-json`](https://github.com/uhop/stream-json)   | JSON streaming parser / generator built on `stream-chain`.                                                                                                 |
| [`stream-join`](https://github.com/uhop/stream-join)   | N→1 combinators that know nothing about sortedness: `zip`, `select`, `race`, `concat`. Helpers: `pickFirst`, `pickMin`, `sortedInsert`.                    |
| [`stream-fork`](https://github.com/uhop/stream-fork)   | 1→N split / route / filter.                                                                                                                                |
| **`stream-sorting`**                                   | **Anything that requires or preserves sortedness:** external merge sort, key-based join, set operations (union / intersection / difference), sorted merge. |

Together, the family closes the billion-row pipeline story end-to-end in pure Node streams: sort each input with `stream-sorting`, `mergeJoin` the sorted streams, fork the output downstream.

## What is NOT here

- **No unsorted combinators.** `zip` / `select` / `race` / `concat` live in `stream-join`.
- **No 1→N operations.** Split / route / filter live in `stream-fork`.
- **No JSON parsing / generation.** That's `stream-json`.
- **No in-memory-only sort.** The package's design point is arbitrary-cardinality sorting; the `compare` argument is identical to what `Array.prototype.sort` takes, so an in-memory sort is one line of user code (`stream.toArray().sort(compare)`) and not worth a separate API.
- **No streaming-quantile / approximate-sort.** Different problem domain; pursue separately if ever needed.
