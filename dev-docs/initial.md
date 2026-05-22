# stream-sorting — design

Sort huge object streams. Two algorithms shipped side-by-side: a straight k-way merge sort (the default), and a polyphase merge sort (the fixed-file-budget variant). Both work on the same object-stream-wrapper abstraction so the user can plug in any backing storage — local files, in-memory buffers, S3, a remote disk over SSH, sharded volumes, or a heterogeneous mix. The point isn't "use disk as RAM"; the point is to be unbounded by what fits on one machine.

## Goals & non-goals

### Goals

- Sort arbitrarily large object streams that don't fit in memory.
- Storage is abstracted via an **object-stream wrapper protocol**. The algorithm sees only object streams; the wrapper hides what's behind them. Default: local file with JSON-line serialization.
- Two algorithms exposed as separate modules:
  - `sort` — straight k-way merge sort. Pre-sort runs to disk, single-pass k-way merge across all runs. The headline default.
  - `polyphase-sort` — polyphase merge sort. Fixed K wrappers, Fibonacci distribution, K-1 → 1 merges with role swap. For fixed-file-budget scenarios and heterogeneous/distributed storage.
- Pure Node object-mode streams. Web Streams interop via edge conversion (`Readable.fromWeb` / `toWeb`).
- Stable by default; opt-out for users who provide their own tiebreaker in the comparator.

### Non-goals (initially)

- In-memory-only sort. That's `(await stream.toArray()).sort(compare)`, one line of user code.
- Resumability. Polyphase has natural pass-boundary save points; we'll design the wrapper protocol to accommodate it later but not implement in v1. K-way is harder; probably never.
- Parallel/distributed sort coordination. The _storage_ can be distributed (via custom wrappers); the _compute_ is single-process.
- Web Streams as first-class input/output. Convert at the boundaries.

## Two algorithms

### `sort` — k-way merge sort (default)

- Pre-sort input items into runs in memory; flush each run via a fresh wrapper.
- Run count R = ceil(input_size / batch_size); each run gets its own wrapper.
- Final merge: a single K-way merge across all R wrappers, K = R.
- Reuses `stream-join`'s `select` + `sortedInsert` for the merge — essentially a `mergeSorted` call with progress wiring.

**Best for:** the common case. Modern SSDs, file handles cheap, single-pass merge is the optimal I/O strategy on flash. Simpler internals; less to go wrong.

**Drawback:** R can grow large for very big inputs. If R exceeds the OS file handle limit (~1024 default on Linux ulimit), need either a higher ulimit or a two-pass merge (group runs, merge groups, then merge the intermediates). Two-pass merge deferred until benchmarks demand.

### `polyphase-sort` — polyphase merge sort (fixed file budget)

- Pre-sort input items into batches (sorted series).
- Distribute the series across K-1 input wrappers according to K-way Fibonacci numbers.
- Merge K-1 inputs item-by-item into 1 output wrapper. When one input exhausts its current series, the output wrapper switches to an input role and the now-empty input becomes the new output.
- Repeat until one file holds the final sorted stream.
- **Series detection:** a series ends when the next item would go backwards (break in sort order). Series are not delimited explicitly on disk.
- **Virtual series:** if the actual run count doesn't fit a Fibonacci distribution, pad with imaginary empty series. The merge just sees an immediately-exhausted input.
- **Final-pass optimization:** when the state reaches `0 1 1 … 1` (one designated output empty, every other file holds exactly one series), route the last merge directly to the caller's output stream instead of writing-then-copying.
- Custom merge logic. `stream-join`'s `select` doesn't have a series-boundary concept; wrapping it to synthesize series-end events is awkward and slow. Hand-written merge loop is cleaner.

**Best for:** fixed-file-budget scenarios; spreading I/O across heterogeneous storage (one wrapper per drive, per S3 bucket, per machine); environments where many open files are problematic; sorting streams larger than any single backing store.

**Drawback:** more I/O passes (~log_φ(R)); more complex code. Pays off when fewer-files is a hard constraint or when each wrapper is expensive (e.g., a separate machine).

## Object-stream wrapper protocol

The wrapper is the core abstraction. It ferries objects to and from some backing storage. The algorithm only sees object streams; the wrapper hides everything else.

```ts
interface ObjectStreamWrapper {
  // Returns a Writable that consumes objects. Discards any previous content.
  openWrite(): Writable; // object-mode

  // Returns a Readable that produces previously-written objects in order.
  openRead(): Readable; // object-mode

  // Releases handles for the current mode.
  close(): Promise<void>;

  // Removes underlying storage (implicitly closes first).
  delete(): Promise<void>;
}
```

**Mode-exclusive.** A wrapper is in one of `idle` / `writing` / `reading` at any moment. Calling `openWrite()` while `writing` re-opens and discards. Calling `openRead()` while `writing` is an error (close first). Both algorithms operate write-then-read; never both at once.

**Asynchronous by nature.** Network or remote storage means latency. `close()` and `delete()` return Promises. The streams returned by `openWrite` / `openRead` are normal Node streams (backpressure flows through them).

**Lifecycle.** The algorithm owns wrappers it creates via factory; the user owns wrappers passed explicitly. On algorithm completion (success or error) the algorithm calls `delete()` on its own wrappers and `close()` on user-passed wrappers. `keepTempFiles: true` skips deletion for debugging.

### Built-in wrappers (shipped, zero extra deps)

- **`LocalFileWrapper`** — local filesystem. Configured with a path or a factory; default serialization is JSON-line-delimited. User can supply `serialize` / `deserialize` to override (e.g., a binary encoding for hot paths). **No default `tmpDir`** — caller must specify a path explicitly. Linux `/tmp` is commonly tmpfs (RAM-backed), which defeats the algorithm's whole point; we force the conversation rather than ship a footgun.
- **`MemoryWrapper`** — in-memory `Array<T>`. For tests, small data, and benchmarking the algorithm independently of disk.

### Example wrappers (documented in `dev-docs/wrappers.md`, not shipped)

Recipes for users to copy. None added as runtime deps.

- **S3 / GCS / R2 object storage** — multipart upload on write; streaming GET on read.
- **Remote disk over SSH** — `ssh host 'cat > file'` for write; `ssh host 'cat file'` for read. Plus serialization in/out of the pipe.
- **HDFS / other distributed filesystem** — same shape; whatever client library the user already uses.
- **Sharded local disk** — round-robin across N physical disks; one wrapper per disk for polyphase K=N.
- **Database table** — write via batched `INSERT`; read via cursor / `SELECT … ORDER BY rowid`.
- **Another machine's pipe** — write via netcat, read by reading from the connection. Useful for very-rare cases like "sort spans more disk than I have on any one machine."

The point: the algorithm doesn't care. As long as the wrapper conforms to the protocol, you can sort across any storage you can ferry objects through.

## Stream model

Algorithm core works with Node object-mode `Readable` / `Writable` streams.

**Internally we pull from input streams via an event-based puller, not `[Symbol.asyncIterator]()`.** Node's async-iterator support on Readable streams is officially marked experimental and has known issues: it wraps original `'error'` values in `AbortError`, behavior shifts across minor releases, and we cannot rely on it in production. This is the same call `stream-join` made — see its `src/stream-puller.js` (and the open D11 proposal to promote that primitive to `stream-chain`).

The puller has shape `{next, close}`:

- `next()` returns `Promise<{value, done}>`, resolving with the next chunk or signalling end.
- Rejects with the **original** error value (no `AbortError` wrapper).
- `close()` releases listeners; idempotent.

**Proposal: promote the puller from `stream-join` to `stream-chain`.** Today it's internal to stream-join (`src/stream-puller.js`, deliberately not exported). With `stream-sorting`'s polyphase merge wanting it too, the right home is `stream-chain` as a public utility. Both `stream-join` and `stream-sorting` then depend on the same primitive; no duplicated implementation. This is its own piece of work, gated on whoever owns `stream-chain` and stream-join 2.0.

For `sort` (k-way), we don't need direct puller access — `stream-join`'s `select` uses the puller internally. For `polyphase-sort`, the custom merge loop pulls from K-1 inputs directly and needs the primitive.

### Web Streams interop

Web Streams have stable async-iterator support, but the algorithm's primary surface is Node streams (matching the rest of the family). Users wanting Web Streams compatibility convert at the boundaries:

```js
// Node ≥17 — built-in adapters.
const sortedWeb = Readable.toWeb(sort(Readable.fromWeb(webInput), {…}));
```

This keeps the core simple and the family's surface coherent.

## API sketch

```js
import sort from 'stream-sorting/sort.js';
import polyphaseSort from 'stream-sorting/polyphase-sort.js';

// k-way (simple case — built-in LocalFileWrapper with explicit tmpDir)
const sorted = sort(input, {
  compare,               // (a, b) => number, OR…
  lessFn,                // (a, b) => bool   (accept either; provide both for flexibility)
  batchSize: 10000,      // items per run; default 10000, tune up for compact items
  tmpDir: '/var/sort',   // REQUIRED — no default (Linux tmpfs footgun)
  stable: true,          // default true
  onProgress: stats => …,
  keepTempFiles: false,
});

// k-way with custom storage backend
const sorted = sort(input, {
  compare,
  batchSize: 10000,
  createWrapper: () => new MyS3Wrapper(bucket),
  stable: true,
});

// polyphase, explicit wrappers (one per drive, e.g.)
const sorted = polyphaseSort(input, {
  lessFn,
  files: [w1, w2, w3, w4],   // K = files.length
  batchSize: 10000,
  stable: true,
  onProgress: stats => …,
});

// polyphase, factory form (more common)
const sorted = polyphaseSort(input, {
  compare,
  k: 4,                       // default 4 — Knuth's classical choice
  createWrapper: () => new LocalFileWrapper({path: …}),
  batchSize: 10000,
});

// Both return an object-mode Node Readable.
sorted.pipe(downstream);
```

Both modules accept `compare` OR `lessFn`. Internally normalize to whichever the merge primitive wants (`stream-join`'s `sortedInsert` takes `lessFn`; the pre-sort uses `compare` for `Array.prototype.sort`). Provide a one-line adapter helper if the user supplied only one form.

### Motivating examples

The algorithm is object-mode in / object-mode out (matches the family convention). Anything that produces an object-mode Readable works as input. For text JSONL sources, `stream-chain` provides the parsing/stringifying utilities — drop them in on either side of sort.

```js
// Sort JSONL output of a shell pipeline.
// `dollar-shell` produces text streams (stdout). `stream-chain` handles the
// text-JSONL ↔ objects conversion on both sides of sort.
import $ from 'dollar-shell';
import chain from 'stream-chain';
import {jsonlParse, jsonlStringify} from 'stream-chain/jsonl/index.js'; // (whichever the exact path is)

const upstream = chain([
  $`tail -F /var/log/big.log | jq -c .`.stream(), // text JSONL
  jsonlParse() // → objects
]);
const sorted = sort(upstream, {
  compare: (a, b) => a.timestamp - b.timestamp,
  batchSize: 50000,
  tmpDir: '/var/sort'
});
sorted.pipe(jsonlStringify()).pipe(fileOrStdout); // back to text JSONL

// Sort a multi-GB on-disk JSONL file.
const sorted = sort(chain([fs.createReadStream('huge.jsonl'), jsonlParse()]), {
  compare,
  batchSize: 10000,
  tmpDir: '/var/sort'
});

// Sort across machines: K=3 wrappers, one per remote disk over SSH.
const sorted = polyphaseSort(input, {
  lessFn,
  files: [sshWrapper('host-a'), sshWrapper('host-b'), sshWrapper('host-c')]
});
```

Any object-mode Readable works as input: `dollar-shell` pipelines (with the JSONL converter), `stream-json` parses, arbitrary `stream-chain` compositions, an HTTP body parsed to objects, a database cursor wrapped in `Readable.from(...)`. The algorithm doesn't care where items come from; it only cares that they come.

**Possible convenience helper (post-v1):** a `sortJsonl(input, options)` shorthand that bakes `stream-chain`'s parse/stringify around `sort()` for the very-common "text JSONL in, text JSONL out" case. Skipping for v1 — the composition above is two extra lines and the JSONL converters already live in `stream-chain` where they belong. Revisit if users keep asking after first publish.

## Pre-sort

Use `Array.prototype.sort(compare)`. V8's TimSort is stable, adaptive (O(n) on already-sorted input), and C++-optimized. Beating it from JS is hopeless.

Pre-sort flow:

1. Pull items via the puller into an in-memory array up to `batchSize`.
2. Call `array.sort(compare)`.
3. Open a fresh wrapper in write mode, write all items, close it.
4. Repeat until input is exhausted.

**Concurrency win (v1):** while step 2-3 runs for batch N, run step 1 for batch N+1. Async overlap, no extra threads, expect ~20-40% wall-clock improvement on I/O-bound workloads.

For `polyphase-sort`: distribute the resulting runs across K-1 wrappers per K-way Fibonacci numbers.
For `sort`: each run gets its own fresh wrapper (created via `createWrapper`).

## Stability

`stable: true` (the default) costs ~8 bytes per item on disk (a monotonic sequence tag) and one tiebreak comparison per merge step.

The tag:

- Assigned during input pull, monotonically increasing per call.
- Persisted with each item to the wrapper's underlying storage.
- Used as a tiebreaker during merge: when the user's comparator returns 0, the smaller tag wins.
- Stripped before items emit to the user's output stream.

For polyphase, the tag is essential because items get reshuffled across passes; "which input file's series this item came from originally" isn't reconstructable. For k-way, the tag could in principle be replaced with run-creation-order tracking (cheaper, no per-item overhead), but unifying both modules behind one mechanism is simpler and the per-item cost is negligible.

`stable: false` skips all of this — users whose comparator already encodes a tiebreaker (e.g., sorting by `(price, id)`) flip the switch and pay nothing.

The user's comparator is never exposed to the tag — it's purely an internal merge-layer concept.

## K selection

- **Polyphase: default K = 4** (3 inputs + 1 output). Knuth's classical recommendation. Fibonacci growth at rate ~1.84^n; good balance between fanout and state complexity. K=7 yields shallower trees but more state to track. User can override.
- **K-way: K is not a tunable.** K = R = ceil(input_size / batch_size). User controls batch size; K falls out.
  - If R exceeds the OS file handle limit, do a two-pass merge: merge in groups of ~64, then merge the intermediates. Deferred until benchmarks justify the complexity. For most real workloads, single-pass merge suffices.

## Concurrency

Two opportunities shipped in v1:

1. **Pre-sort overlap.** Read batch N+1 while sorting and writing batch N. Async overlap; no threads. Easy win.
2. **Merge-time read parallelism.** Multiple input streams read concurrently for free — Node streams overlap I/O naturally. The merge heap step serializes (single-threaded by definition), but I/O interleaves behind it. No code needed; just don't accidentally serialize the reads.

Deferred: 3. Polyphase phase overlap. Each phase reads K-1 and writes 1; phases are sequential by definition. Within a phase, (2) applies. Across phases, no overlap available without rethinking the algorithm.

## Progress reporting

`onProgress(stats)` callback in options. Single listener, zero overhead when unused, works for both Node and Web environments (unlike Node's EventEmitter, which doesn't exist on Web Streams).

Stats shape (preliminary — subject to change):

```ts
interface ProgressStats {
  phase: 'pre-sort' | 'merge' | 'final-merge';
  itemsRead: number;
  itemsWritten: number;
  runsCreated?: number; // k-way only
  passesComplete?: number; // polyphase only
  passesTotal?: number; // polyphase only — estimated, not exact
  virtualSeries?: number; // polyphase only
  files: Array<{
    role: 'input' | 'output' | 'idle';
    seriesRemaining?: number; // polyphase
    itemsRemaining?: number;
  }>;
}
```

Callback fires on natural event boundaries (run-complete during pre-sort, pass-complete during merge). Not periodic — the caller chunks events into UI updates / ETA computations as they see fit.

## Errors and cleanup

The algorithm throws on:

- Comparator throws.
- Input stream emits `'error'`.
- Any wrapper operation fails (open / read / write / close / delete).

Errors carry `cause` so the original error value is preserved end-to-end (no `AbortError` wrapping, per the family convention).

Cleanup contract:

- A `finally` block calls `wrapper.delete()` on every algorithm-owned wrapper, and `wrapper.close()` on every user-passed wrapper.
- Wrapper-cleanup errors during the `finally` are swallowed (don't mask the original error).
- `keepTempFiles: true` in options opts out of cleanup for debugging.

## Resumability — out of scope for v1

Polyphase has natural pass-boundary save points:

- After each phase, state is "file-i contains M_i runs, current output is file-j."
- Serializable as a small JSON sidecar associated with the wrapper-set.
- To resume: load sidecar, re-attach to existing wrappers in read mode for completed passes, continue.
- Wrapper protocol addition needed: an "attach to existing content without truncation" mode. Not in v1, but the protocol should leave room for it (don't bake "openWrite always truncates" into the contract more deeply than needed).

K-way has one easy save point: between "all runs written" and "merge starts."

- Save list of run wrappers + sizes.
- Resume: open all wrappers, run the merge.
- Mid-merge resume: hard (heap state, per-source positions). Probably never.

Defer both. Document the polyphase save-point shape in the design so v2 can pick it up cleanly.

## Stream-join reuse

- **k-way merge sort** uses `stream-join`'s `select` + `sortedInsert` + `pickFirst` for the final merge. Each run wrapper produces a Readable; `select` consumes them; `sortedInsert(lessFn)` is the insert callback; `pickFirst` is the pick (the smallest item always lands at slot 0 once the buffer is sorted). The merge is essentially a `mergeSorted` call wrapped with progress wiring and cleanup logic.
- **Polyphase merge sort** uses a custom merge loop. `select` has no concept of "series boundary within a stream"; polyphase needs that. Wrapping `select` with synthetic series-end events is awkward and slow. The merge is hand-written: pull-and-peek across K-1 wrappers, series-end detected by sort-order break, virtual-series handling, role swap on input exhaustion.

Both algorithms benefit from a shared low-level **stream puller** primitive (the same one `stream-join`'s components use internally). Recommendation: promote it from stream-join to stream-chain so it's a shared public utility rather than duplicated implementation. Track separately.

## Open questions

- **Default `batchSize`.** Starting at 10000. Re-tune after benchmarks. Item-size variation makes a universal default tricky — document the trade-off (larger = fewer passes + fewer files; bounded by memory).
- **Wrapper protocol details.** Does `openRead` after `openWrite` implicitly close the write side, or must the user call `close()` explicitly? Probably the former (less ceremony, harder to misuse). Decide before the protocol freezes.
- **Two-pass merge for k-way when R exceeds ulimit.** Defer until benchmarks demand. May never be needed if users tune `batchSize` appropriately.
- **Whether to expose serialization hooks on `LocalFileWrapper`** or push users to write a custom wrapper for non-JSON encodings. JSON-line default is portable; custom encodings are users' call.
