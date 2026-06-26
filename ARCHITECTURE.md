# Architecture

`stream-sorting` is a streaming sort plus a suite of operations on sorted object-mode `Readable` streams. The scope rule for the family: **anything that requires or preserves sortedness lives here.** Combinators that know nothing about sortedness (`zip`, `select`, `race`, `concat`) live in [`stream-join`](https://github.com/uhop/stream-join); 1→N split / route / filter ops live in [`stream-fork`](https://github.com/uhop/stream-fork); cross-cutting pipeline plumbing (`readableFrom`, `chain`) lives in [`stream-chain`](https://github.com/uhop/stream-chain).

**Node-only.** The package targets server / CLI contexts. The disk-backed sort relies on `node:fs`, `node:os`, `node:path`; there is no web entry point and no browser test surface. Sorting at billion-record scale is a server problem.

All operations are implemented (the package has not yet published its first npm release): the wrapper protocol and its two built-in implementations, both sort algorithms (`sort`, `polyphaseSort`), the join family (`join`, `leftJoin`, `fullJoin`), `aggregate`, the key-based filters (`matching`, `unmatched`), and the set operations (`merge`, `union`, `intersection`, `difference`) — all detailed below.

## Project layout

```
package.json                  # Package config; "tape6" section configures test discovery
src/                          # Source code (one main component per file at root)
├── index.js                  # Entry point
├── index.d.ts
├── sorted/                   # Operations on sorted streams (join, leftJoin, fullJoin, …)
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

## Main components

### `sort(input, options)` — external merge sort (shipped)

**Strategy:** disk-backed external (k-way) merge sort. `input` is `AsyncIterable<T> | Iterable<T>`; the result is an `AsyncIterable<T>`.

1. **Run-formation phase.** Pull items into an in-memory buffer of up to `batchSize` items. When full (or input ends), sort via `Array.prototype.sort(compare)` and flush to a fresh wrapper as one sorted run.
2. **k-way-merge phase.** K-way-merge all run wrappers via [`stream-join`](https://github.com/uhop/stream-join)'s `mergeSorted` (`select` + `sortedInsert(lessFn)` + `pickFirst`) and yield in order. In-memory fast path: when the whole input fits in one batch it is sorted in memory and emitted directly — no wrapper, no disk.

**Why disk-backed.** The design point is "sort a billion records on a laptop without OOMing." Two alternatives floated during design were rejected: an in-memory-only buffer (does not scale), and a sliding-window approximate sort (does not actually sort).

**Options:**

- `compare: (a, b) => number` **or** `lessFn: (a, b) => boolean` — comparator (`compare` semantics identical to `Array.prototype.sort`).
- `tmpDir?: string` **or** `createWrapper?: (runIndex) => ObjectStreamWrapper` — storage. `tmpDir` uses the built-in `LocalFileWrapper` (one run file each); `createWrapper` supplies custom backing storage. `tmpDir` has **no default** (Linux `/tmp` is commonly tmpfs / RAM-backed and would defeat the algorithm).
- `batchSize?: number` — soft cap on in-memory items per run. Default 10000.
- `stable?: boolean` — keep input order for equal items. Default `true` (internal sequence tag, stripped before emit).
- `onProgress?: (stats) => void` — progress at run / merge boundaries.
- `keepTempFiles?: boolean` — keep run files instead of deleting them. Default `false`.

### `polyphaseSort(input, options)` — polyphase merge sort (shipped)

The fixed-file-budget companion to `sort`: it uses exactly `K` files regardless of input size, which suits bounded file budgets and storage spread across drives / buckets / machines (one wrapper each).

1. **Distribution.** Pre-sort input into runs and write them across `K − 1` input files following a perfect generalized-Fibonacci distribution; where the real run count is not perfect, the shortfall is tracked as virtual (empty) runs.
2. **Merge phases.** Repeatedly merge the `K − 1` inputs into the one output file with a hand-written series-aware merge (a run ends at a sort-order break; D3); when an input drains it becomes the next output and the old output rejoins the inputs. The final merge (every file down to ≤ 1 run) streams straight to the caller. In-memory fast path like `sort`.

**Options:** `compare` / `lessFn`, `batchSize`, `stable`, `onProgress`, `keepTempFiles` as in `sort`, plus storage: `files: ObjectStreamWrapper[]` (explicit, `K = files.length ≥ 3`, user-owned — closed not deleted) **or** `k?: number` (default 4, min 3) with `tmpDir` / `createWrapper`.

### `join` / `leftJoin` / `fullJoin` — key-based sorted join (shipped)

Key-based join of two or more sorted streams, at `src/sorted/{join,left-join,full-join}.js` (re-exported from the index). **Pre-condition:** every input is sorted by its key; an out-of-order input throws at runtime. Closes the long-standing user request on `stream-join` for "join two large feeds by ID."

**Inputs** are a **named map** of descriptors — `{dept: {input, key}, emp: {input, key}}` — where `key` extracts the join key (default identity) and the map key names the input both on input and in the result. Each descriptor also takes `optional?: boolean`.

**Options:** `compareKey` **or** `lessKey` (default natural order; composite/tuple keys need an explicit comparator); `combine?: (bag) => row` building each output from the named bag `{name: row | null}` (default returns the bag; returning `undefined` drops the combination); `maxGroupSize?: number` guarding a Cartesian blow-up.

**Semantics:** inner by default (a row emits only when every required input has the key); equal keys form a Cartesian product (SQL semantics). `optional: true` null-fills a side — `leftJoin` (first input required, rest optional) and `fullJoin` (all optional) are thin wrappers over the same engine; for arbitrary requiredness across N inputs, set `optional` per input on `join`.

**Merge:** a custom group-aware walk — the deliberate D3 exception, like `polyphaseSort` — sharing the peekable reader at `src/reader.js`. A flat `select` + `sortedInsert` merge can't express equal-key grouping across inputs plus the Cartesian product, so the engine (`src/sorted/engine.js`) orchestrates directly: find the minimum key, gather each input's equal-key group, emit the product, advance.

### Filters: `matching` / `unmatched` (shipped)

Key-based filters at `src/sorted/{matching,unmatched}.js` (thin wrappers over the shared `src/sorted/keyed-filter.js`): emit rows of the primary stream whose key is present (`matching`) or absent (`unmatched`) in the probe — no `combine`, no product; whole rows pass through, primary duplicates preserved (semi / anti-join). Both inputs are `{input, key?}` descriptors `(primary, probe)`; `compareKey` / `lessKey`, default natural order. Closely related to keyed `intersection` / `difference`, but they keep the primary's whole rows rather than emitting shared values.

### `aggregate(master, children, options)` — group/fold sorted streams (shipped)

Group sorted child streams under a master by key, folding each child's per-key group into one result — SQL-style `GROUP BY` over streams, one output row per key. At `src/sorted/aggregate.js` (re-exported from the index), sharing the same group-aware merge and peekable reader (`src/reader.js`) as the join family.

**The master** drives the spine and is one of two forms:

- a **`{input, key, init?, fold?, finalize?}` descriptor** — an external master stream (a dimension table); its keys define which rows emit (a master key with no children still emits; child items with no master are dropped). Duplicate master rows at a key fold to one base — first row wins by default; an `init`/`fold`/`finalize` can merge them.
- a **`key => object` function** — the base is synthesized from the group key (group-by); the spine is then the children's own keys.

**Children** are a named map; each folds its per-key group with `init()` (no args) / `fold(acc, item)` / `finalize(acc)` (default = collect-to-array), scoped to the master's key boundaries — a master with no items for a child gets `finalize(init())`. `required: true` drops masters whose group for that child is empty. Every scalar SQL aggregate is a fold (count, sum, avg via finalize, min/max, array_agg = the default — ordering free since children arrive sorted).

**Options:** `compareKey` **or** `lessKey` (composite/tuple keys need an explicit comparator); `combine(base, parts)` builds each row from the master base and the named bag of child results (default `{...base, ...parts}`, `undefined` drops the row); `maxGroupSize` guards a runaway group.

**Multi-level nesting** (department → employee → equipment) is composition, not a built-in: a `join` to enrich foreign keys, a re-`sort` to the ancestor key path, then a flat `aggregate` per level (`aggregate` emits in key order, so its output feeds the next level still sorted).

### Set operations on sorted streams (shipped)

Value-based operations on an array of sorted streams, at `src/sorted/{merge,union,intersection,difference}.js` with the shared core in `src/sorted/set-ops.js`. Each takes `{compare?, lessFn?}` (default natural order); the comparator defines both order and equality. `union` / `intersection` / `difference` emit sets (deduped); `merge` keeps duplicates.

- **`merge(streams, options)`** — k-way merge keeping all duplicates; the foundational op (was `mergeSorted`). Ties keep input order; `union` builds on it.
- **`union(streams, options)`** — `merge` plus adjacent dedup, across and within streams: `{1,2,3} ∪ {2,3,4} = {1,2,3,4}`.
- **`intersection(streams, options)`** — values present in **all** streams (≥ 2 inputs), deduped: advance the minimum head, emit once when every head agrees.
- **`difference(streams, options)`** — values in `streams[0]` not present in any of `streams[1..]`, deduped.

Whether `stream-join` drops its `utils/merge-sorted` copy in favor of this `merge` is still open (see vault `projects/stream-sorting/queue.md`).

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
            → src/sort.js                 (shipped — k-way merge sort)
            → src/polyphase-sort.js       (shipped — polyphase merge sort)
            → src/sorted/join.js, src/sorted/left-join.js,
              src/sorted/full-join.js     (shipped — join family)
            → src/sorted/aggregate.js     (shipped — group / fold)
            → src/sorted/matching.js, src/sorted/unmatched.js   (shipped — keyed filters)
            → src/sorted/merge.js, src/sorted/union.js,
              src/sorted/intersection.js, src/sorted/difference.js   (shipped — set ops)

src/sort.js, src/polyphase-sort.js, src/sorted/* → src/ordering.js  (shipped — comparator + stability + defaultCompare)
src/polyphase-sort.js, src/sorted/{engine,aggregate,set-ops,keyed-filter}.js → src/reader.js   (shipped — peekable reader)
src/sorted/{join,left-join,full-join}.js → src/sorted/engine.js          (shipped — prepare + runJoin)
src/sorted/{merge,union}.js → src/sorted/set-ops.js                       (shipped — prepareSetOp + mergeRun)
src/sorted/{matching,unmatched}.js → src/sorted/keyed-filter.js          (shipped — prepareFilter + runFilter)
                        ↓
                   stream-join (select, sortedInsert, pickFirst)   — k-way sort + ops
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

## Import paths

```js
import sort from 'stream-sorting/sort.js';
import polyphaseSort from 'stream-sorting/polyphase-sort.js';
import join from 'stream-sorting/sorted/join.js';
import leftJoin from 'stream-sorting/sorted/left-join.js';
import fullJoin from 'stream-sorting/sorted/full-join.js';
import aggregate from 'stream-sorting/sorted/aggregate.js';
import matching from 'stream-sorting/sorted/matching.js';
import unmatched from 'stream-sorting/sorted/unmatched.js';
import merge from 'stream-sorting/sorted/merge.js';
import union from 'stream-sorting/sorted/union.js';
import intersection from 'stream-sorting/sorted/intersection.js';
import difference from 'stream-sorting/sorted/difference.js';

// or all from the index
import {sort, join, aggregate, matching, merge, union /* … */} from 'stream-sorting';

// Helper builders (planned)
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

Together, the family closes the billion-row pipeline story end-to-end in pure Node streams: sort each input with `stream-sorting`, `join` the sorted streams, fork the output downstream.

## What is NOT here

- **No unsorted combinators.** `zip` / `select` / `race` / `concat` live in `stream-join`.
- **No 1→N operations.** Split / route / filter live in `stream-fork`.
- **No JSON parsing / generation.** That's `stream-json`.
- **No in-memory-only sort.** The package's design point is arbitrary-cardinality sorting; the `compare` argument is identical to what `Array.prototype.sort` takes, so an in-memory sort is one line of user code (`stream.toArray().sort(compare)`) and not worth a separate API.
- **No streaming-quantile / approximate-sort.** Different problem domain; pursue separately if ever needed.
