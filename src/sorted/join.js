// @ts-self-types="./join.d.ts"

import {prepare, runJoin} from './engine.js';

const join = (inputs, options) =>
  runJoin(prepare(inputs, options, 'join', desc => desc.optional === true));

export default join;
export {join};
