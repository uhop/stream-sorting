// @ts-self-types="./matching.d.ts"

import {prepareFilter, runFilter} from './keyed-filter.js';

const matching = (primary, probe, options) =>
  runFilter({
    ...prepareFilter(primary, probe, options, 'matching'),
    keepWhenPresent: true,
    label: 'matching'
  });

export default matching;
export {matching};
