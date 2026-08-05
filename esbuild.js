#!/usr/bin/env node
// Bundles the extension with esbuild.
// CommonJS/ES2022 output is required by the VS Code 1.93 baseline.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

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
  outdir: 'dist',
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [{
  ...shared,
  entryPoints: ['src/extension.ts'],
}];

async function main() {
  const output = path.resolve(__dirname, 'dist');
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
