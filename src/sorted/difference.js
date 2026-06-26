// @ts-self-types="./difference.d.ts"

import {prepareSetOp, makeTake} from './set-ops.js';
import {DONE, makeReader} from '../reader.js';

async function* differenceRun(streams, compare) {
  const readers = streams.map(makeReader);
  const take = makeTake(readers, compare, 'difference');
  const [primary, ...rest] = readers;
  try {
    while (true) {
      const ph = await primary.peek();
      if (ph === DONE) break;
      const val = ph;
      // consume all primary items equal to val (dedup the output)
      let h = await primary.peek();
      while (h !== DONE && compare(h, val) === 0) {
        await take(0);
        h = await primary.peek();
      }
      // present if any of the rest holds val (advance each to >= val)
      let present = false;
      for (let j = 0; j < rest.length; ++j) {
        let rh = await rest[j].peek();
        while (rh !== DONE && compare(rh, val) < 0) {
          await take(j + 1);
          rh = await rest[j].peek();
        }
        if (rh !== DONE && compare(rh, val) === 0) present = true;
      }
      if (!present) yield val;
    }
  } finally {
    for (const r of readers) await r.dispose();
  }
}

const difference = (streams, options) => {
  const {streams: s, compare} = prepareSetOp(streams, options, 'difference');
  return differenceRun(s, compare);
};

export default difference;
export {difference};
