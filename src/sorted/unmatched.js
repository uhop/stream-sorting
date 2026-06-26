// @ts-self-types="./unmatched.d.ts"

import {prepareFilter, runFilter} from './keyed-filter.js';

const unmatched = (primary, probe, options) =>
  runFilter({
    ...prepareFilter(primary, probe, options, 'unmatched'),
    keepWhenPresent: false,
    label: 'unmatched'
  });

export default unmatched;
export {unmatched};
