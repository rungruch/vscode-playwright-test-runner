#!/usr/bin/env node
// Bundles the extension with esbuild.
// CommonJS/ES2022 output is required for extension-runtime stability; the
// ESM project root therefore emits the bundle as dist/extension.cjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').BuildOptions}
 */
const shared = {
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  platform: 'node',
  external: ['vscode'],
  sourcemap: production ? false : true,
  sourcesContent: false,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [{
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
}];

async function main() {
  const output = path.resolve(rootDirectory, 'dist');
  if (path.basename(output) !== 'dist') {
    throw new Error(`Refusing to clean unexpected path: ${output}`);
  }
  fs.rmSync(output, { recursive: true, force: true });

  if (watch) {
    const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('Watching for changes...');
    return;
  }
  await Promise.all(builds.map((options) => esbuild.build(options)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
