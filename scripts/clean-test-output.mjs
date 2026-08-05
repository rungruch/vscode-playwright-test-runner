#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only generated TypeScript test output is removed. Keeping this as an
// explicit path prevents deleted tests from lingering and being run by Mocha.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(scriptDirectory, '..', 'out');
if (path.basename(output) !== 'out') {
  throw new Error(`Refusing to clean unexpected path: ${output}`);
}
fs.rmSync(output, { recursive: true, force: true });
