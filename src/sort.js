// @ts-self-types="./sort.d.ts"

import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

import readableFrom from 'stream-chain/utils/readableFrom.js';
import mergeSorted from 'stream-join/utils/merge-sorted.js';

import LocalFileWrapper from './local-file-wrapper.js';
import {consume} from './wrapper.js';
import {normalizeComparator, validateInput, makeStability} from './ordering.js';

const DEFAULT_BATCH_SIZE = 10000;

const resolveWrapperFactory = ({tmpDir, createWrapper}) => {
  if (tmpDir !== undefined && createWrapper !== undefined) {
    throw new TypeError('sort: pass `tmpDir` OR `createWrapper`, not both');
  }
  if (createWrapper !== undefined) {
    if (typeof createWrapper !== 'function')
      throw new TypeError('sort: `createWrapper` must be a function');
    return createWrapper;
  }
  if (tmpDir !== undefined) {
    if (typeof tmpDir !== 'string' || !tmpDir)
      throw new TypeError('sort: `tmpDir` must be a non-empty string');
    const unique = randomUUID();
    return runIndex =>
      new LocalFileWrapper({
        path: join(tmpDir, `stream-sorting-${process.pid}-${unique}-${runIndex}.jsonl`)
      });
  }
  throw new TypeError('sort: either `tmpDir` or `createWrapper` is required');
};

const sort = (input, options) => {
  validateInput(input, 'sort');
  if (!options) throw new TypeError('sort: options object is required');

  const {compare, lessFn} = normalizeComparator(
    {compare: options.compare, lessFn: options.lessFn},
    'sort'
  );

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0)
    throw new TypeError('sort: `batchSize` must be a positive integer');

  const stable = options.stable !== false;
  const keepTempFiles = options.keepTempFiles === true;
  const onProgress = options.onProgress;

  const createWrapper = resolveWrapperFactory({
    tmpDir: options.tmpDir,
    createWrapper: options.createWrapper
  });

  return runSort({
    input,
    compare,
    lessFn,
    batchSize,
    stable,
    keepTempFiles,
    onProgress,
    createWrapper
  });
};

async function* runSort({
  input,
  compare,
  lessFn,
  batchSize,
  stable,
  keepTempFiles,
  onProgress,
  createWrapper
}) {
  const {wrap, unwrap, runCompare, mergeLess} = makeStability(stable, compare, lessFn);

  const wrappers = [];
  let itemsRead = 0;
  let itemsWritten = 0;
  const emitProgress = phase => {
    if (onProgress)
      onProgress({
        phase,
        itemsRead,
        itemsWritten,
        runsCreated: wrappers.length
      });
  };

  try {
    let buffer = [];
    const flushRun = async () => {
      buffer.sort(runCompare);
      const wrapper = createWrapper(wrappers.length);
      wrappers.push(wrapper);
      await consume(wrapper.openWriter(), buffer);
      itemsWritten += buffer.length;
      buffer = [];
      emitProgress('pre-sort');
    };

    // Check-then-push so the last batch is held until we know it's the last —
    // input ≤ batchSize then takes the in-memory fast path.
    for await (const item of input) {
      if (buffer.length >= batchSize) await flushRun();
      buffer.push(wrap(item));
      itemsRead++;
    }

    if (wrappers.length === 0) {
      buffer.sort(runCompare);
      itemsWritten = buffer.length;
      emitProgress('final-merge');
      for (const envelope of buffer) yield unwrap(envelope);
      return;
    }

    if (buffer.length > 0) await flushRun();

    if (wrappers.length === 1) {
      emitProgress('final-merge');
      for await (const envelope of wrappers[0].openReader()) yield unwrap(envelope);
      return;
    }

    const readables = wrappers.map(w => readableFrom(w.openReader()));
    const merged = mergeSorted(readables, mergeLess);
    emitProgress('final-merge');
    for await (const envelope of merged) yield unwrap(envelope);
  } finally {
    for (const wrapper of wrappers) {
      try {
        if (keepTempFiles) await wrapper.close();
        else await wrapper.delete();
      } catch (_) {
        // best-effort cleanup; do not mask the original error
      }
    }
  }
}

export default sort;
export {sort};
export {runSort};
