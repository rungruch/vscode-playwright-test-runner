#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Only generated TypeScript test output is removed. Keeping this as an
// explicit path prevents deleted tests from lingering and being run by Mocha.
const output = path.resolve(__dirname, '..', 'out');
if (path.basename(output) !== 'out') {
  throw new Error(`Refusing to clean unexpected path: ${output}`);
}
fs.rmSync(output, { recursive: true, force: true });
