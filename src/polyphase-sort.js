// @ts-self-types="./polyphase-sort.d.ts"

import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

import LocalFileWrapper from './local-file-wrapper.js';
import {normalizeComparator, validateInput, makeStability} from './ordering.js';

const DEFAULT_BATCH_SIZE = 10000;
const DEFAULT_K = 4;

const resolveStorage = ({files, k, tmpDir, createWrapper}) => {
  if (files !== undefined) {
    if (k !== undefined || tmpDir !== undefined || createWrapper !== undefined) {
      throw new TypeError(
        'polyphaseSort: pass `files` OR `k` with `tmpDir`/`createWrapper`, not both'
      );
    }
    if (!Array.isArray(files) || files.length < 3) {
      throw new TypeError('polyphaseSort: `files` must be an array of at least 3 wrappers');
    }
    return {K: files.length, owned: false, makeWrappers: () => files.slice()};
  }
  if (tmpDir !== undefined && createWrapper !== undefined) {
    throw new TypeError('polyphaseSort: pass `tmpDir` OR `createWrapper`, not both');
  }
  const count = k ?? DEFAULT_K;
  if (!Number.isInteger(count) || count < 3) {
    throw new TypeError('polyphaseSort: `k` must be an integer >= 3');
  }
  if (createWrapper !== undefined) {
    if (typeof createWrapper !== 'function') {
      throw new TypeError('polyphaseSort: `createWrapper` must be a function');
    }
    return {
      K: count,
      owned: true,
      makeWrappers: () => {
        const wrappers = [];
        for (let i = 0; i < count; ++i) wrappers.push(createWrapper(i));
        return wrappers;
      }
    };
  }
  if (tmpDir !== undefined) {
    if (typeof tmpDir !== 'string' || !tmpDir) {
      throw new TypeError('polyphaseSort: `tmpDir` must be a non-empty string');
    }
    return {
      K: count,
      owned: true,
      makeWrappers: () => {
        const unique = randomUUID();
        const wrappers = [];
        for (let i = 0; i < count; ++i) {
          wrappers.push(
            new LocalFileWrapper({
              path: join(tmpDir, `stream-sorting-polyphase-${process.pid}-${unique}-${i}.jsonl`)
            })
          );
        }
        return wrappers;
      }
    };
  }
  throw new TypeError(
    'polyphaseSort: either `files`, or `k` with `tmpDir`/`createWrapper`, is required'
  );
};

const nextLevel = c => {
  const n = c.length;
  const next = new Array(n);
  for (let i = 0; i < n - 1; ++i) next[i] = c[0] + c[i + 1];
  next[n - 1] = c[0];
  return next;
};

async function* mergeContributors(contributors, readItem, runCompare) {
  for (const c of contributors) {
    c.head = await readItem(c.fileIdx);
    c.active = true;
  }
  let active = contributors.length;
  while (active > 0) {
    let best = null;
    for (const c of contributors) {
      if (c.active && (best === null || runCompare(c.head, best.head) < 0)) best = c;
    }
    yield best.head;
    if (--best.remaining > 0) best.head = await readItem(best.fileIdx);
    else {
      best.active = false;
      --active;
    }
  }
}

const polyphaseSort = (input, options) => {
  validateInput(input, 'polyphaseSort');
  if (!options) throw new TypeError('polyphaseSort: options object is required');

  const {compare, lessFn} = normalizeComparator(
    {compare: options.compare, lessFn: options.lessFn},
    'polyphaseSort'
  );

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0)
    throw new TypeError('polyphaseSort: `batchSize` must be a positive integer');

  const stable = options.stable !== false;
  const keepTempFiles = options.keepTempFiles === true;
  const onProgress = options.onProgress;

  const {K, owned, makeWrappers} = resolveStorage({
    files: options.files,
    k: options.k,
    tmpDir: options.tmpDir,
    createWrapper: options.createWrapper
  });

  return runPolyphaseSort({
    input,
    compare,
    lessFn,
    batchSize,
    stable,
    keepTempFiles,
    onProgress,
    K,
    owned,
    makeWrappers
  });
};

async function* runPolyphaseSort({
  input,
  compare,
  lessFn,
  batchSize,
  stable,
  keepTempFiles,
  onProgress,
  K,
  owned,
  makeWrappers
}) {
  const inputCount = K - 1;
  const {wrap, unwrap, runCompare} = makeStability(stable, compare, lessFn);

  let created = false;
  let wrappers = [];
  let queues = [];
  let writers = [];
  let readers = [];
  const ensureWrappers = () => {
    if (created) return;
    created = true;
    wrappers = makeWrappers();
    queues = wrappers.map(() => []);
    writers = wrappers.map(() => null);
    readers = wrappers.map(() => null);
  };

  let itemsRead = 0;
  let itemsWritten = 0;
  let passesComplete = 0;
  let virtualSeries = 0;
  let outputFile = K - 1;

  const emitProgress = phase => {
    if (!onProgress) return;
    onProgress({
      phase,
      itemsRead,
      itemsWritten,
      passesComplete,
      virtualSeries,
      files: created
        ? wrappers.map((_, i) => ({
            role: i === outputFile ? 'output' : readers[i] ? 'input' : 'idle',
            runsRemaining: queues[i].length
          }))
        : []
    });
  };

  const disposeReader = async i => {
    const r = readers[i];
    readers[i] = null;
    if (r && r.return) {
      try {
        await r.return();
      } catch {}
    }
  };

  const cleanup = async () => {
    if (!created) return;
    for (let i = 0; i < K; ++i) await disposeReader(i);
    for (const w of wrappers) {
      try {
        if (owned && !keepTempFiles) await w.delete();
        else await w.close();
      } catch {}
    }
  };

  try {
    let c = new Array(inputCount).fill(1);
    const placeRun = async sortedBuffer => {
      ensureWrappers();
      let idx = 0;
      let bestDef = c[0] - queues[0].length;
      for (let i = 1; i < inputCount; ++i) {
        const def = c[i] - queues[i].length;
        if (def > bestDef) {
          bestDef = def;
          idx = i;
        }
      }
      if (bestDef <= 0) {
        c = nextLevel(c);
        idx = 0;
        bestDef = c[0] - queues[0].length;
        for (let i = 1; i < inputCount; ++i) {
          const def = c[i] - queues[i].length;
          if (def > bestDef) {
            bestDef = def;
            idx = i;
          }
        }
      }
      if (writers[idx] === null) writers[idx] = wrappers[idx].openWriter();
      await writers[idx].writeAll(sortedBuffer);
      queues[idx].push(sortedBuffer.length);
      itemsWritten += sortedBuffer.length;
      emitProgress('pre-sort');
    };

    let buffer = [];
    for await (const item of input) {
      if (buffer.length >= batchSize) {
        buffer.sort(runCompare);
        await placeRun(buffer);
        buffer = [];
      }
      buffer.push(wrap(item));
      ++itemsRead;
    }

    if (!created) {
      buffer.sort(runCompare);
      itemsWritten = buffer.length;
      emitProgress('final-merge');
      for (const env of buffer) yield unwrap(env);
      return;
    }

    if (buffer.length > 0) {
      buffer.sort(runCompare);
      await placeRun(buffer);
      buffer = [];
    }

    for (let i = 0; i < inputCount; ++i) {
      const writer = writers[i];
      if (writer !== null) {
        await writer.end();
        writers[i] = null;
      }
    }

    let realRunsRemaining = 0;
    for (let i = 0; i < inputCount; ++i) {
      const dummies = c[i] - queues[i].length;
      virtualSeries += dummies;
      realRunsRemaining += queues[i].length;
      if (dummies > 0) queues[i] = new Array(dummies).fill(0).concat(queues[i]);
    }

    const readItem = async fileIdx => {
      const res = await readers[fileIdx].next();
      if (res.done) throw new Error('polyphaseSort: unexpected end of run while merging');
      return res.value;
    };

    while (true) {
      const inputs = [];
      for (let i = 0; i < K; ++i) if (i !== outputFile) inputs.push(i);

      for (const i of inputs) {
        if (readers[i] === null && queues[i].some(len => len > 0)) {
          readers[i] = wrappers[i].openReader()[Symbol.asyncIterator]();
        }
      }

      let steps = Infinity;
      for (const i of inputs) if (queues[i].length < steps) steps = queues[i].length;
      if (!Number.isFinite(steps)) steps = 0;

      let outputWriter = null;
      for (let s = 0; s < steps; ++s) {
        const contributors = [];
        for (const i of inputs) {
          const len = queues[i].shift();
          if (len > 0) contributors.push({fileIdx: i, remaining: len});
        }

        if (contributors.length === 0) {
          queues[outputFile].push(0);
          continue;
        }

        if (realRunsRemaining === contributors.length) {
          for await (const env of mergeContributors(contributors, readItem, runCompare))
            yield unwrap(env);
          return;
        }

        if (outputWriter === null) outputWriter = wrappers[outputFile].openWriter();
        let outLen = 0;
        for await (const env of mergeContributors(contributors, readItem, runCompare)) {
          await outputWriter.write(env);
          ++outLen;
        }
        queues[outputFile].push(outLen);
        itemsWritten += outLen;
        realRunsRemaining -= contributors.length - 1;

        for (const contributor of contributors) {
          if (queues[contributor.fileIdx].length === 0) await disposeReader(contributor.fileIdx);
        }
      }

      if (outputWriter !== null) await outputWriter.end();

      ++passesComplete;
      emitProgress('merge');

      let emptied = -1;
      for (const i of inputs) {
        if (queues[i].length === 0) {
          emptied = i;
          break;
        }
      }
      if (emptied === -1) throw new Error('polyphaseSort: merge failed to reduce runs');
      outputFile = emptied;
    }
  } finally {
    await cleanup();
  }
}

export default polyphaseSort;
export {polyphaseSort};
export {runPolyphaseSort};
