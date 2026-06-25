// @ts-self-types="./engine.d.ts"

import {normalizeComparator, validateInput, defaultCompare} from '../ordering.js';
import {DONE, makeReader} from '../reader.js';

const identity = x => x;

export const prepare = (inputs, options, label, optionalFor) => {
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) {
    throw new TypeError(`${label}: \`inputs\` must be an object map of named descriptors`);
  }
  const entries = Object.entries(inputs);
  if (entries.length < 2) {
    throw new TypeError(`${label}: at least two named inputs are required`);
  }

  options = options || {};

  const {compare: compareKey} =
    options.compareKey !== undefined || options.lessKey !== undefined
      ? normalizeComparator({compare: options.compareKey, lessFn: options.lessKey}, label)
      : {compare: defaultCompare};

  const combine = options.combine ?? (bag => bag);
  if (typeof combine !== 'function') {
    throw new TypeError(`${label}: \`combine\` must be a function`);
  }

  const maxGroupSize = options.maxGroupSize;
  if (maxGroupSize !== undefined && (!Number.isInteger(maxGroupSize) || maxGroupSize <= 0)) {
    throw new TypeError(`${label}: \`maxGroupSize\` must be a positive integer`);
  }

  const normalized = entries.map(([name, desc], i) => {
    if (desc === null || typeof desc !== 'object') {
      throw new TypeError(`${label}["${name}"]: descriptor must be an object`);
    }
    validateInput(desc.input, `${label}["${name}"]`);
    const key = desc.key ?? identity;
    if (typeof key !== 'function') {
      throw new TypeError(`${label}["${name}"]: \`key\` must be a function`);
    }
    return {name, input: desc.input, key, optional: optionalFor(desc, i)};
  });

  return {label, inputs: normalized, compareKey, combine, maxGroupSize};
};

function* product(states, factors, combine) {
  const n = factors.length;
  const idx = new Array(n).fill(0);
  while (true) {
    const bag = {};
    for (let i = 0; i < n; ++i) bag[states[i].name] = factors[i][idx[i]];
    const r = combine(bag);
    if (r !== undefined) yield r;
    let i = n - 1;
    for (; i >= 0; --i) {
      if (++idx[i] < factors[i].length) break;
      idx[i] = 0;
    }
    if (i < 0) break;
  }
}

export async function* runJoin({label, inputs, compareKey, combine, maxGroupSize}) {
  const states = inputs.map(inp => ({...inp, reader: makeReader(inp.input)}));
  try {
    while (true) {
      let minKey;
      let minFound = false;
      for (const s of states) {
        const head = await s.reader.peek();
        if (head === DONE) continue;
        const k = s.key(head);
        if (!minFound || compareKey(k, minKey) < 0) {
          minKey = k;
          minFound = true;
        }
      }
      if (!minFound) break;

      const factors = new Array(states.length);
      let allRequiredPresent = true;
      for (let i = 0; i < states.length; ++i) {
        const s = states[i];
        const group = [];
        while (true) {
          const head = await s.reader.peek();
          if (head === DONE) break;
          const c = compareKey(s.key(head), minKey);
          if (c < 0) throw new Error(`${label}: input "${s.name}" is not sorted by key`);
          if (c > 0) break;
          group.push(await s.reader.take());
          if (maxGroupSize !== undefined && group.length > maxGroupSize) {
            throw new RangeError(
              `${label}: group for input "${s.name}" exceeds maxGroupSize=${maxGroupSize}`
            );
          }
        }
        if (group.length === 0 && !s.optional) allRequiredPresent = false;
        factors[i] = group.length ? group : [null];
      }

      if (allRequiredPresent) yield* product(states, factors, combine);
    }
  } finally {
    for (const s of states) await s.reader.dispose();
  }
}
