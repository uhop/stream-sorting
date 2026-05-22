import test from 'tape-six';

import * as streamSorting from '../src/index.js';

test('scaffold: entry point loads', t => {
  t.ok(streamSorting, 'module loads');
  t.equal(typeof streamSorting, 'object', 'entry exports an object');
});
