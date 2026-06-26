// @ts-self-types="./sort-jsonl.d.ts"

import chain from 'stream-chain';
import readableFrom from 'stream-chain/utils/readableFrom.js';
import fixUtf8Stream from 'stream-chain/utils/fixUtf8Stream.js';
import lines from 'stream-chain/utils/lines.js';

import sort from '../sort.js';
import {validateInput} from '../ordering.js';

async function* stringifyLines(source, stringify) {
  for await (const item of source) yield stringify(item) + '\n';
}

const sortJsonl = (input, options) => {
  validateInput(input, 'sortJsonl');
  const opts = options || {};
  const parse = opts.parse ?? (text => JSON.parse(text));
  const stringify = opts.stringify ?? (item => JSON.stringify(item));
  if (typeof parse !== 'function' || typeof stringify !== 'function') {
    throw new TypeError('sortJsonl: `parse` and `stringify` must be functions');
  }
  const objects = chain([readableFrom(input), fixUtf8Stream(), lines(), text => parse(text)]);
  return stringifyLines(sort(objects, opts), stringify);
};

export default sortJsonl;
export {sortJsonl};
