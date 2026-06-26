// @ts-self-types="./aggregate.d.ts"

import {resolveComparator, validateInput, identity} from '../ordering.js';
import {DONE, makeReader} from '../reader.js';

const collectInit = () => [];
const collectFold = (acc, item) => (acc.push(item), acc);

// Default master fold: keep the first row at a key (collapse duplicate master keys).
const FIRST = Symbol('first');
const firstInit = () => FIRST;
const firstFold = (acc, row) => (acc === FIRST ? row : acc);

const prepare = (master, children, options) => {
  const label = 'aggregate';

  let mode, masterFn, masterInput, masterKey, masterInit, masterFold, masterFinalize;
  if (typeof master === 'function') {
    mode = 'group';
    masterFn = master;
  } else if (master !== null && typeof master === 'object') {
    mode = 'master';
    validateInput(master.input, `${label}: master`);
    masterInput = master.input;
    masterKey = master.key ?? identity;
    masterInit = master.init ?? firstInit;
    masterFold = master.fold ?? firstFold;
    masterFinalize = master.finalize ?? identity;
    for (const [fn, fname] of [
      [masterKey, 'key'],
      [masterInit, 'init'],
      [masterFold, 'fold'],
      [masterFinalize, 'finalize']
    ]) {
      if (typeof fn !== 'function') {
        throw new TypeError(`${label}: master \`${fname}\` must be a function`);
      }
    }
  } else {
    throw new TypeError(
      `${label}: master must be a {input, key} descriptor or a \`key => object\` function`
    );
  }

  if (children === null || typeof children !== 'object' || Array.isArray(children)) {
    throw new TypeError(`${label}: \`children\` must be an object map of named descriptors`);
  }
  const entries = Object.entries(children);
  if (entries.length < 1) throw new TypeError(`${label}: at least one child is required`);

  options = options || {};

  const {compare: compareKey} = resolveComparator(options.compareKey, options.lessKey, label);

  const combine = options.combine ?? ((m, parts) => ({...m, ...parts}));
  if (typeof combine !== 'function') {
    throw new TypeError(`${label}: \`combine\` must be a function`);
  }

  const maxGroupSize = options.maxGroupSize;
  if (maxGroupSize !== undefined && (!Number.isInteger(maxGroupSize) || maxGroupSize <= 0)) {
    throw new TypeError(`${label}: \`maxGroupSize\` must be a positive integer`);
  }

  const normChildren = entries.map(([name, desc]) => {
    if (desc === null || typeof desc !== 'object') {
      throw new TypeError(`${label}["${name}"]: descriptor must be an object`);
    }
    validateInput(desc.input, `${label}["${name}"]`);
    const key = desc.key ?? identity;
    const init = desc.init ?? collectInit;
    const fold = desc.fold ?? collectFold;
    const finalize = desc.finalize ?? identity;
    for (const [fn, fname] of [
      [key, 'key'],
      [init, 'init'],
      [fold, 'fold'],
      [finalize, 'finalize']
    ]) {
      if (typeof fn !== 'function') {
        throw new TypeError(`${label}["${name}"]: \`${fname}\` must be a function`);
      }
    }
    return {name, input: desc.input, key, init, fold, finalize, required: desc.required === true};
  });

  return {
    label,
    mode,
    masterFn,
    masterInput,
    masterKey,
    masterInit,
    masterFold,
    masterFinalize,
    children: normChildren,
    compareKey,
    combine,
    maxGroupSize
  };
};

async function* runAggregate({
  label,
  mode,
  masterFn,
  masterInput,
  masterKey,
  masterInit,
  masterFold,
  masterFinalize,
  children,
  compareKey,
  combine,
  maxGroupSize
}) {
  const states = children.map(c => ({
    ...c,
    reader: makeReader(c.input),
    hasLast: false,
    lastKey: undefined
  }));
  const masterReader = mode === 'master' ? makeReader(masterInput) : null;

  const checkMono = (s, k) => {
    if (s.hasLast && compareKey(k, s.lastKey) < 0) {
      throw new Error(`${label}: input "${s.name}" is not sorted by key`);
    }
    s.hasLast = true;
    s.lastKey = k;
  };

  const foldChildAt = async (s, key) => {
    // master mode: drop child items with no master at their key (orphans)
    while (true) {
      const head = await s.reader.peek();
      if (head === DONE) break;
      const k = s.key(head);
      if (compareKey(k, key) >= 0) break;
      checkMono(s, k);
      await s.reader.take();
    }
    let acc = s.init();
    let count = 0;
    while (true) {
      const head = await s.reader.peek();
      if (head === DONE) break;
      const k = s.key(head);
      if (compareKey(k, key) !== 0) break;
      checkMono(s, k);
      acc = s.fold(acc, await s.reader.take());
      ++count;
      if (maxGroupSize !== undefined && count > maxGroupSize) {
        throw new RangeError(
          `${label}: group for input "${s.name}" exceeds maxGroupSize=${maxGroupSize}`
        );
      }
    }
    return {result: s.finalize(acc), count};
  };

  const foldChildren = async key => {
    const parts = {};
    let drop = false;
    for (const s of states) {
      const {result, count} = await foldChildAt(s, key);
      parts[s.name] = result;
      if (count === 0 && s.required) drop = true;
    }
    return {parts, drop};
  };

  try {
    if (mode === 'group') {
      while (true) {
        let key;
        let found = false;
        for (const s of states) {
          const head = await s.reader.peek();
          if (head === DONE) continue;
          const k = s.key(head);
          if (!found || compareKey(k, key) < 0) {
            key = k;
            found = true;
          }
        }
        if (!found) break;
        const {parts, drop} = await foldChildren(key);
        if (!drop) {
          const r = combine(masterFn(key), parts);
          if (r !== undefined) yield r;
        }
      }
    } else {
      while (true) {
        const mh = await masterReader.peek();
        if (mh === DONE) break;
        const km = masterKey(mh);
        // Fold the master group at this key into a single base (duplicate master keys collapse).
        let acc = masterInit();
        while (true) {
          const head = await masterReader.peek();
          if (head === DONE) break;
          const c = compareKey(masterKey(head), km);
          if (c < 0) throw new Error(`${label}: master is not sorted by key`);
          if (c > 0) break;
          acc = masterFold(acc, await masterReader.take());
        }
        const base = masterFinalize(acc);
        const {parts, drop} = await foldChildren(km);
        if (!drop) {
          const r = combine(base, parts);
          if (r !== undefined) yield r;
        }
      }
    }
  } finally {
    for (const s of states) await s.reader.dispose();
    if (masterReader) await masterReader.dispose();
  }
}

const aggregate = (master, children, options) => runAggregate(prepare(master, children, options));

export default aggregate;
export {aggregate};
