// @ts-self-types="./polyphase-sort.d.ts"

import {makeTmpWrapperFactory} from './local-file-wrapper.js';
import {normalizeComparator, validateInput, makeStability} from './ordering.js';
import {DONE, makeReader} from './reader.js';

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
        const make = makeTmpWrapperFactory(tmpDir, 'polyphase');
        const wrappers = [];
        for (let i = 0; i < count; ++i) wrappers.push(make(i));
        return wrappers;
      }
    };
  }
  throw new TypeError(
    'polyphaseSort: either `files`, or `k` with `tmpDir`/`createWrapper`, is required'
  );
};

// order-n generalized Fibonacci, descending: Knuth TAOCP vol 3 §5.4.2
const nextLevel = c => [...c.slice(1).map(x => x + c[0]), c[0]];

async function* mergeStep(contributors, runCompare) {
  for (const c of contributors) c.activeRun = (await c.reader.peek()) !== DONE;
  while (true) {
    let best = null;
    let bestHead = DONE;
    for (const c of contributors) {
      if (!c.activeRun) continue;
      const head = await c.reader.peek();
      if (best === null || runCompare(head, bestHead) < 0) {
        best = c;
        bestHead = head;
      }
    }
    if (best === null) break;
    const item = await best.reader.take();
    yield item;
    const next = await best.reader.peek();
    if (next === DONE || runCompare(next, item) < 0) best.activeRun = false;
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
  let real = [];
  let dummy = [];
  let writers = [];
  let readers = [];
  const ensureWrappers = () => {
    if (created) return;
    created = true;
    wrappers = makeWrappers();
    real = wrappers.map(() => 0);
    dummy = wrappers.map(() => 0);
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
            runsRemaining: real[i] + dummy[i]
          }))
        : []
    });
  };

  const disposeReader = async i => {
    const r = readers[i];
    readers[i] = null;
    if (r) await r.dispose();
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
      let bestDef = c[0] - real[0];
      for (let i = 1; i < inputCount; ++i) {
        const def = c[i] - real[i];
        if (def > bestDef) {
          bestDef = def;
          idx = i;
        }
      }
      if (bestDef <= 0) {
        c = nextLevel(c);
        idx = 0;
        bestDef = c[0] - real[0];
        for (let i = 1; i < inputCount; ++i) {
          const def = c[i] - real[i];
          if (def > bestDef) {
            bestDef = def;
            idx = i;
          }
        }
      }
      if (writers[idx] === null) writers[idx] = wrappers[idx].openWriter();
      await writers[idx].writeAll(sortedBuffer);
      ++real[idx];
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
      dummy[i] = c[i] - real[i];
      virtualSeries += dummy[i];
      realRunsRemaining += real[i];
    }

    while (true) {
      const inputs = [];
      for (let i = 0; i < K; ++i) if (i !== outputFile) inputs.push(i);

      for (const i of inputs) {
        if (readers[i] === null && real[i] > 0) readers[i] = makeReader(wrappers[i].openReader());
      }

      let steps = Infinity;
      for (const i of inputs) {
        const total = real[i] + dummy[i];
        if (total < steps) steps = total;
      }
      if (!Number.isFinite(steps)) steps = 0;

      let outputWriter = null;
      for (let s = 0; s < steps; ++s) {
        const contributors = [];
        for (const i of inputs) {
          if (dummy[i] > 0) --dummy[i];
          else {
            --real[i];
            contributors.push({reader: readers[i]});
          }
        }

        if (contributors.length === 0) {
          ++dummy[outputFile];
          continue;
        }

        if (realRunsRemaining === contributors.length) {
          for await (const env of mergeStep(contributors, runCompare)) yield unwrap(env);
          return;
        }

        if (outputWriter === null) outputWriter = wrappers[outputFile].openWriter();
        for await (const env of mergeStep(contributors, runCompare)) {
          await outputWriter.write(env);
          ++itemsWritten;
        }
        ++real[outputFile];
        realRunsRemaining -= contributors.length - 1;
      }

      if (outputWriter !== null) await outputWriter.end();

      ++passesComplete;
      emitProgress('merge');

      let emptied = -1;
      for (const i of inputs) {
        if (real[i] + dummy[i] === 0) {
          emptied = i;
          break;
        }
      }
      if (emptied === -1) throw new Error('polyphaseSort: merge failed to reduce runs');
      await disposeReader(emptied);
      outputFile = emptied;
    }
  } finally {
    await cleanup();
  }
}

export default polyphaseSort;
export {polyphaseSort};
export {runPolyphaseSort};
