import * as path from 'path';

/** Builds Playwright CLI arguments for discovery and companion CLI tools. */

export interface RunSelection {
  /** Absolute file paths of selected test files. */
  files: string[];
  /** Escaped title-path regexes for selected tests or suites. */
  titleFilters: string[];
}

export interface UiArgumentOptions {
  configFile?: string;
  cwd: string;
  projects?: string[];
  extraOptions?: string[];
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test filter that tolerates Playwright's project/file prefix, title-path
 * separators, and tags appended after the test title.
 */
export function fullTitleFilter(titlePath: string | readonly string[]): string {
  return `${filterTitlePath(titlePath)}(?:\\s+@\\S+)*$`;
}

/** Suite filter that tolerates prefixes/separators and includes descendants. */
export function suiteTitleFilter(titlePath: string | readonly string[]): string {
  return filterTitlePath(titlePath);
}

function filterTitlePath(titlePath: string | readonly string[]): string {
  const titles = typeof titlePath === 'string' ? [titlePath] : titlePath;
  return titles.map(escapeRegExp).join('.*');
}

/** Arguments for `playwright test --list --reporter=json` discovery. */
export function buildDiscoveryArguments(options: { configFile?: string }): string[] {
  const args = ['test', '--list', '--reporter=json'];
  if (options.configFile) {
    args.push('--config', options.configFile);
  }
  return args;
}

/** Arguments for launching Playwright's interactive UI, optionally scoped. */
export function buildUiArguments(selection: RunSelection, options: UiArgumentOptions): string[] {
  return buildInteractiveArguments('--ui', selection, options);
}

/** Arguments for launching a scoped test in Playwright Inspector. */
export function buildDebugArguments(selection: RunSelection, options: UiArgumentOptions): string[] {
  return buildInteractiveArguments('--debug', selection, options);
}

function buildInteractiveArguments(
  mode: '--ui' | '--debug',
  selection: RunSelection,
  options: UiArgumentOptions,
): string[] {
  const args = ['test', mode];
  if (options.configFile) {
    args.push('--config', options.configFile);
  }
  for (const project of options.projects ?? []) {
    if (project) {
      args.push('--project', project);
    }
  }
  for (const extra of options.extraOptions ?? []) {
    if (extra) {
      args.push(extra);
    }
  }
  if (selection.titleFilters.length > 0) {
    args.push('--grep', combineFilters(selection.titleFilters));
  }
  for (const file of selection.files) {
    args.push(relativeOrAbsolute(file, options.cwd));
  }
  return args;
}

export function combineFilters(filters: string[]): string {
  if (filters.length === 1) {
    return filters[0];
  }
  return filters.map((f) => `(?:${f})`).join('|');
}

function relativeOrAbsolute(file: string, cwd: string): string {
  const relative = path.relative(cwd, file);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return file;
}
