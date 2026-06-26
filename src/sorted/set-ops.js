// @ts-self-types="./set-ops.d.ts"

import {resolveComparator, validateInput} from '../ordering.js';
import {DONE, makeReader} from '../reader.js';

export const prepareSetOp = (streams, options, label, minStreams = 1) => {
  if (!Array.isArray(streams) || streams.length < minStreams) {
    throw new TypeError(`${label}: \`streams\` must be an array of at least ${minStreams}`);
  }
  streams.forEach((s, i) => validateInput(s, `${label}[${i}]`));
  options = options || {};
  const {compare} = resolveComparator(options.compare, options.lessFn, label);
  return {streams, compare};
};

// Per-reader monotonic take: throws if a stream yields a value below its previous one.
export const makeTake = (readers, compare, label) => {
  const last = readers.map(() => undefined);
  const seen = readers.map(() => false);
  return async i => {
    const v = await readers[i].take();
    if (seen[i] && compare(v, last[i]) < 0) throw new Error(`${label}: stream ${i} is not sorted`);
    last[i] = v;
    seen[i] = true;
    return v;
  };
};

export async function* mergeRun(streams, compare, label) {
  const readers = streams.map(makeReader);
  const take = makeTake(readers, compare, label);
  try {
    while (true) {
      let best = -1;
      let bestVal;
      for (let i = 0; i < readers.length; ++i) {
        const h = await readers[i].peek();
        if (h === DONE) continue;
        if (best === -1 || compare(h, bestVal) < 0) {
          best = i;
          bestVal = h;
        }
      }
      if (best === -1) break;
      yield await take(best);
    }
  } finally {
    for (const r of readers) await r.dispose();
  }
}
