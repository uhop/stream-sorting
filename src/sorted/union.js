// @ts-self-types="./union.d.ts"

import {prepareSetOp, mergeRun} from './set-ops.js';

async function* unionRun(streams, compare) {
  let has = false;
  let last;
  for await (const v of mergeRun(streams, compare, 'union')) {
    if (!has || compare(v, last) !== 0) {
      yield v;
      last = v;
      has = true;
    }
  }
}

const union = (streams, options) => {
  const {streams: s, compare} = prepareSetOp(streams, options, 'union');
  return unionRun(s, compare);
};

export default union;
export {union};
