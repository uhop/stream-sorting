// @ts-self-types="./intersection.d.ts"

import {prepareSetOp, makeTake} from './set-ops.js';
import {DONE, makeReader} from '../reader.js';

async function* intersectionRun(streams, compare) {
  const readers = streams.map(makeReader);
  const take = makeTake(readers, compare, 'intersection');
  const drainEqual = async (i, val) => {
    let h = await readers[i].peek();
    while (h !== DONE && compare(h, val) === 0) {
      await take(i);
      h = await readers[i].peek();
    }
  };
  try {
    while (true) {
      let minVal;
      let maxVal;
      let minIdx = 0;
      let first = true;
      let done = false;
      for (let i = 0; i < readers.length; ++i) {
        const h = await readers[i].peek();
        if (h === DONE) {
          done = true;
          break;
        }
        if (first) {
          minVal = maxVal = h;
          minIdx = i;
          first = false;
        } else {
          if (compare(h, minVal) < 0) {
            minVal = h;
            minIdx = i;
          }
          if (compare(h, maxVal) > 0) maxVal = h;
        }
      }
      if (done) break;
      if (compare(minVal, maxVal) === 0) {
        yield minVal;
        for (let i = 0; i < readers.length; ++i) await drainEqual(i, minVal);
      } else {
        await drainEqual(minIdx, minVal);
      }
    }
  } finally {
    for (const r of readers) await r.dispose();
  }
}

const intersection = (streams, options) => {
  const {streams: s, compare} = prepareSetOp(streams, options, 'intersection', 2);
  return intersectionRun(s, compare);
};

export default intersection;
export {intersection};
