// @ts-self-types="./full-join.d.ts"

import {prepare, runJoin} from './engine.js';

const fullJoin = (inputs, options) => runJoin(prepare(inputs, options, 'fullJoin', () => true));

export default fullJoin;
export {fullJoin};
