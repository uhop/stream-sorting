// @ts-self-types="./keyed-filter.d.ts"

import {normalizeComparator, validateInput, defaultCompare} from '../ordering.js';
import {DONE, makeReader} from '../reader.js';

const identity = x => x;

export const prepareFilter = (primary, probe, options, label) => {
  for (const [d, role] of [
    [primary, 'primary'],
    [probe, 'probe']
  ]) {
    if (d === null || typeof d !== 'object') {
      throw new TypeError(`${label}: ${role} must be a {input, key} descriptor`);
    }
    validateInput(d.input, `${label}: ${role}`);
  }
  const pKey = primary.key ?? identity;
  const qKey = probe.key ?? identity;
  if (typeof pKey !== 'function' || typeof qKey !== 'function') {
    throw new TypeError(`${label}: \`key\` must be a function`);
  }
  options = options || {};
  const {compare: compareKey} =
    options.compareKey !== undefined || options.lessKey !== undefined
      ? normalizeComparator({compare: options.compareKey, lessFn: options.lessKey}, label)
      : {compare: defaultCompare};
  return {primaryInput: primary.input, probeInput: probe.input, pKey, qKey, compareKey};
};

export async function* runFilter({
  primaryInput,
  probeInput,
  pKey,
  qKey,
  compareKey,
  keepWhenPresent,
  label
}) {
  const p = makeReader(primaryInput);
  const q = makeReader(probeInput);
  let pHasLast = false;
  let pLast;
  let qHasLast = false;
  let qLast;
  try {
    while (true) {
      const ph = await p.peek();
      if (ph === DONE) break;
      const k = pKey(ph);
      if (pHasLast && compareKey(k, pLast) < 0) {
        throw new Error(`${label}: primary is not sorted by key`);
      }
      pLast = k;
      pHasLast = true;
      // advance probe to the first key >= k
      let qh = await q.peek();
      while (qh !== DONE) {
        const qk = qKey(qh);
        if (compareKey(qk, k) >= 0) break;
        if (qHasLast && compareKey(qk, qLast) < 0) {
          throw new Error(`${label}: probe is not sorted by key`);
        }
        qLast = qk;
        qHasLast = true;
        await q.take();
        qh = await q.peek();
      }
      const present = qh !== DONE && compareKey(qKey(qh), k) === 0;
      const row = await p.take();
      if (present === keepWhenPresent) yield row;
    }
  } finally {
    await p.dispose();
    await q.dispose();
  }
}
