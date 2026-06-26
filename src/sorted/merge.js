// @ts-self-types="./merge.d.ts"

import {prepareSetOp, mergeRun} from './set-ops.js';

const merge = (streams, options) => {
  const {streams: s, compare} = prepareSetOp(streams, options, 'merge');
  return mergeRun(s, compare, 'merge');
};

export default merge;
export {merge};
