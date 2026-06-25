// @ts-self-types="./left-join.d.ts"

import {prepare, runJoin} from './engine.js';

const leftJoin = (inputs, options) =>
  runJoin(prepare(inputs, options, 'leftJoin', (_desc, i) => i > 0));

export default leftJoin;
export {leftJoin};
