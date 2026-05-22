# AGENTS.md — stream-sorting

> `stream-sorting` is a streaming sort and a suite of operations that consume or produce sorted object-mode Readable streams. Scope: anything that **requires or preserves sortedness**. The headline operation is a disk-backed external merge sort designed to sort a billion records on a laptop without OOMing. Built on [`stream-chain`](https://www.npmjs.com/package/stream-chain) (for `readableFrom`) and [`stream-join`](https://www.npmjs.com/package/stream-join) (for `select` + `sortedInsert`, the k-way merge primitives). Part of the `stream-chain` / `stream-json` / `stream-join` family. **Node-only** — the package targets server / CLI contexts; browsers are out of scope.

For project structure, module dependencies, and the architecture overview see [ARCHITECTURE.md](./ARCHITECTURE.md).
For detailed usage docs and API references see the [wiki](https://github.com/uhop/stream-sorting/wiki).

## Setup

This project uses a git submodule for the wiki:

```bash
git clone --recursive https://github.com/uhop/stream-sorting.git
cd stream-sorting
npm install
```

## Commands

- **Install:** `npm install`
- **Test:** `npm test` (runs `tape6 --flags FO`)
- **Test (Bun):** `npm run test:bun`
- **Test (Deno):** `npm run test:deno`
- **Test (single file):** `node tests/test-<name>.js`
- **TypeScript check:** `npm run ts-check`
- **JavaScript check (tsc --checkJs):** `npm run js-check`
- **TypeScript tests:** `npm run ts-test`
- **Lint:** `npm run lint` (Prettier check)
- **Lint fix:** `npm run lint:fix` (Prettier write)

## Project structure

```
stream-sorting/
├── package.json              # Package config; "tape6" section configures test discovery
├── src/                      # Source code
│   ├── index.js              # Entry point
│   ├── index.d.ts
│   └── utils/                # Helpers users compose with main components
├── tests/                    # Test files (test-*.js using tape-six) + helpers.js
├── dev-docs/                 # Internal design notes (not in the published tarball)
├── wiki/                     # GitHub wiki documentation (git submodule)
└── .github/                  # CI workflows, Dependabot config
```

`src/utils/` follows the fleet convention of separating helpers from main components. Main components and shared internal infrastructure live at `src/` root; everything users compose **with** those main components lives under `src/utils/`.

## Code style

- **ESM throughout** (`"type": "module"` in package.json). Use `import` / `export`; no `require()` / `module.exports`.
- **No transpilation** — code runs directly.
- **Lambda-style functions** for stand-alone definitions that don't use `this` (`const fn = (...) => …`); `function` declarations only for generators (`function*`) and the rare `this`-dependent case.
- **Prettier** for formatting (see `.prettierrc`): 100 char width, single quotes, no bracket spacing, no trailing commas, arrow parens "avoid".
- 2-space indentation.
- Semicolons are enforced by Prettier (default `semi: true`).

## Critical rules

- **Two runtime dependencies: `stream-chain` and `stream-join`.** `stream-chain` provides `readableFrom` (async-iterable → Readable). `stream-join` provides `select` + `sortedInsert` (the k-way merge primitives every planned component composes). Never add other packages to `dependencies`; only `devDependencies` are otherwise allowed.
- **Node-only.** The package targets Node servers and CLIs. The disk-backed sort relies on `node:fs`, `node:os`, `node:path`. No web entry point; no browser tests.
- **AsyncIterable in / AsyncIterable out.** Algorithms accept `AsyncIterable<T> | Iterable<T>` (Node Readables, Web ReadableStreams, generators, arrays all satisfy) and return `AsyncIterable<T>`. No `node:stream` or Web Streams types appear in the public surface — users convert at the boundary with `readableFrom(...)` / `ReadableStream.from(...)` / direct `for await`. See `dev-docs/initial.md` / the wrapper-protocol section in `ARCHITECTURE.md` for rationale.
- **Backpressure must be handled correctly.** Async iteration is naturally backpressured (the producer pauses while the consumer awaits). Do not add buffering on top of input beyond the sort's run-buffer.
- **Sort is disk-backed by default.** The external-merge-sort engine writes sorted runs to on-disk files (chunk size capped by a configurable in-memory budget), then k-way-merges them. The design point is "sort a billion records on a laptop without OOMing"; in-memory-only and sliding-window-approximate strategies were considered and rejected during design.
- **k-way merge reuses `stream-join`.** The merge phase composes `select` + `sortedInsert(lessFn)` from `stream-join` — do not reimplement.
- **Comparator API follows `Array.prototype.sort`.** Comparators are `(a, b) => number`: negative if `a < b`, positive if `a > b`, zero if equal. Helpers may provide `lessFn = (a, b) => bool` adapters where the underlying primitive expects one.
- **Do not modify or delete test expectations** without understanding why they changed.
- **Do not add comments or remove comments** unless explicitly asked.
- **Keep `.js` and `.d.ts` files in sync** for every source file. All public API has a hand-written `.d.ts` sidecar with the `// @ts-self-types="./X.d.ts"` directive at the top of the `.js`.
- **Helpers live under `src/utils/`.** Main components and shared infrastructure stay at `src/` root.

## Architecture quick reference

The package is in early scaffolding. **Implemented:**

- The wrapper protocol at `src/wrapper.js` (`ObjectStreamWrapper<T>` + `ItemWriter<T>` base classes, extendable for `instanceof` / shared defaults, structurally satisfiable too; mode-exclusive `idle | writing | reading`). The protocol is runtime-agnostic: `openWriter()` returns an `ItemWriter<T>` with `write(item)` / `writeAll(iter)` / `end()` / `ended`; `openReader()` returns an `AsyncIterable<T>`. A `consume(writer, source)` helper (also in `src/wrapper.js`) drains an iterable and ends the writer in one call.
- Two built-in wrappers: `MemoryWrapper` (array-backed; for tests + small data) and `LocalFileWrapper` (local FS, JSONL by default, user-overridable `serialize` / `deserialize`, no default `tmpDir` per the Linux-tmpfs footgun).
- **`sort(input, options)`** — external merge sort. `input` is `AsyncIterable<T> | Iterable<T>`; returns `AsyncIterable<T>`. Pulls items into `batchSize`-bounded buffers, sorts via `Array.prototype.sort`, drains to a wrapper, repeats; once input is exhausted, k-way-merges runs via `stream-join`'s `mergeSorted`. In-memory fast path when input ≤ `batchSize`. Accept `compare` OR `lessFn` (D5). Accept `tmpDir` OR `createWrapper` (one-line `LocalFileWrapper` convenience vs explicit factory). `stable: true` default (D10), `onProgress(stats)`, `keepTempFiles`.

Planned next:

- **`polyphase-sort(input, options)`** — polyphase merge sort (fixed file budget); same API shape, custom merge logic (D2/D3).
- **`mergeJoin(streamA, streamB, options)`** / **`joinBy`** — SQL-style key-based join of two sorted streams. Walks both via stream-join's `select` + `sortedInsert(byKey)`; emits combined rows on key match; `null` / skip per variant (`inner` / `left` / `right` / `full`).
- **`union(streams, lessFn)`** — sorted merge with duplicate elimination across all inputs.
- **`intersection(streams, lessFn)`** — values present in ALL input streams.
- **`difference(streamA, ...streamsB, lessFn)`** — values in `streamA` not in any `streamsB[i]`.
- **`mergeSorted(streams, lessFn, options?)`** — sorted merge without dedup. Logically the foundational operation in the suite; may eventually subsume the copy that currently lives in `stream-join/utils/merge-sorted` (open decision; see vault `projects/stream-sorting/queue.md`).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module map and dependency graph as components land.

## Verification commands

- `npm test` — run the full test suite (parallel workers)
- `node tests/test-<name>.js` — run a single test file directly
- `npm run test:bun` — run with Bun
- `npm run test:deno` — run with Deno
- `npm run ts-check` — TypeScript type checking
- `npm run js-check` — `tsc --allowJs --checkJs` over the JS sources
- `npm run ts-test` — typing tests
- `npm run lint` — Prettier check
- `npm run lint:fix` — Prettier write

## File layout

- Entry point: `src/index.js` + `src/index.d.ts`.
- Main components: TBD as the package is built out — one `.js` + `.d.ts` pair per public component at `src/` root.
- Helpers: `src/utils/*.js` (each with its `.d.ts`).
- Tests: `tests/test-*.js` (ESM), plus `tests/helpers.js` for shared stream test utilities.
- Design notes: `dev-docs/*.md` (internal; not in the published tarball).
- Wiki docs: `wiki/` (git submodule).

## When reading the codebase

- Start with `ARCHITECTURE.md` for the module map and dependency graph.
- Each main component's `.d.ts` is the canonical API reference for that component.
- The `tests/` files demonstrate every supported usage pattern.
- Wiki markdown files in `wiki/` contain detailed usage docs.
- Family context: [`stream-join`](https://github.com/uhop/stream-join) ships the unsorted N→1 combinators (`zip`, `select`, `race`, `concat`) plus the `sortedInsert` / `pickFirst` helpers this package builds on. Anything that requires or preserves sortedness lives here.
