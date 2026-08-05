import * as fs from 'fs';
import * as path from 'path';

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

/**
 * Detects the package manager governing a directory by looking for lockfiles,
 * walking up from `startDir` to (and including) `stopDir`. Defaults to npm.
 */
export function detectPackageManager(startDir: string, stopDir?: string): PackageManager {
  let current = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : undefined;
  for (;;) {
    for (const [lockfile, manager] of LOCKFILES) {
      if (fs.existsSync(path.join(current, lockfile))) {
        return manager;
      }
    }
    if (current === stop) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return 'npm';
}

/**
 * Finds the nearest ancestor (including `startDir`) that contains a
 * package.json, walking up to the filesystem root or `stopDir`.
 */
export function findPackageRoot(startDir: string, stopDir?: string): string | undefined {
  let current = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : undefined;
  for (;;) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    if (current === stop) {
      return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Locates a locally installed Playwright CLI entry point relative to a
 * directory, preferring the package root's node_modules.
 */
export function findLocalPlaywrightCli(startDir: string, stopDir?: string): string | undefined {
  let current = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : undefined;
  for (;;) {
    const candidates = [
      path.join(current, 'node_modules', '@playwright', 'test', 'cli.js'),
      path.join(current, 'node_modules', 'playwright', 'cli.js'),
      path.join(current, 'node_modules', 'playwright-core', 'cli.js'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    if (current === stop) {
      return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}
