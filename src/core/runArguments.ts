import * as path from 'path';
import { ForcedInspectorBrowser } from './inspectorBrowser';

/** Builds Playwright CLI arguments for discovery and companion CLI tools. */

export interface RunSelection {
  /** Absolute file paths of selected test files. */
  files: string[];
  /** Escaped title-path regexes for selected tests or suites. */
  titleFilters: string[];
  /** Optional 1-based source line for generated tests sharing a declaration. */
  line?: number;
}

export interface UiArgumentOptions {
  browser?: ForcedInspectorBrowser;
  configFile?: string;
  cwd: string;
  projects?: string[];
  extraOptions?: string[];
  /** Named UI profile host; supplied only for explicitly selected profiles. */
  uiHost?: string;
  /** Named UI profile port; supplied only for explicitly selected profiles. */
  uiPort?: number;
}

export interface FlakeLabOptions extends UiArgumentOptions {
  repeatEach: number;
  workers: number;
  retries: number;
  trace: string;
  failOnFlakyTests: boolean;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TITLE_SEPARATOR = '\\s+(?:›\\s+)?(?:@\\S+\\s+)*(?:›\\s+)?';

/**
 * Test filter that tolerates Playwright's project/file prefix, title-path
 * separators, and tags appended after the test title.
 */
export function fullTitleFilter(titlePath: string | readonly string[], file: string): string {
  return `${filterTitlePath(titlePath, file)}(?:\\s+@\\S+)*$`;
}

/** Suite filter that tolerates prefixes/separators and includes descendants. */
export function suiteTitleFilter(titlePath: string | readonly string[], file: string): string {
  return `${filterTitlePath(titlePath, file)}(?:$|${TITLE_SEPARATOR})`;
}

function filterTitlePath(titlePath: string | readonly string[], file: string): string {
  const titles = typeof titlePath === 'string' ? [titlePath] : titlePath;
  const portableFile = file.replaceAll('\\', '/');
  const fileName = portableFile.slice(portableFile.lastIndexOf('/') + 1);
  const prefix = `(?:^|[\\s/\\\\])${escapeRegExp(fileName)}${TITLE_SEPARATOR}`;
  return `${prefix}${titles.map(escapeRegExp).join(TITLE_SEPARATOR)}`;
}

/** Arguments for `playwright test --list --reporter=json` discovery. */
export function buildDiscoveryArguments(options: { configFile?: string; cwd?: string; files?: string[] }): string[] {
  const args = ['test', '--list', '--reporter=json'];
  if (options.configFile) {
    args.push('--config', options.configFile);
  }
  for (const file of options.files ?? []) {
    args.push(playwrightFileFilter(file, options.cwd));
  }
  return args;
}

/** Arguments for launching Playwright's interactive UI, optionally scoped. */
export function buildUiArguments(selection: RunSelection, options: UiArgumentOptions): string[] {
  const args = buildInteractiveArguments('--ui', selection, options);
  if (options.uiHost) {
    args.push('--ui-host', options.uiHost);
  }
  if (options.uiPort !== undefined) {
    args.push('--ui-port', String(options.uiPort));
  }
  return args;
}

/** Arguments for launching a scoped test in Playwright Inspector. */
export function buildDebugArguments(selection: RunSelection, options: UiArgumentOptions): string[] {
  return buildInteractiveArguments('--debug', selection, options);
}

/** Arguments for an isolated, JSON-reported companion Flake Lab run. */
export function buildFlakeLabArguments(selection: RunSelection, options: FlakeLabOptions): string[] {
  const args = buildCompanionTestArguments(selection, options);
  args.push(
    '--repeat-each', String(options.repeatEach),
    '--workers', String(options.workers),
    '--retries', String(options.retries),
    '--trace', options.trace,
  );
  if (options.failOnFlakyTests) {
    args.push('--fail-on-flaky-tests');
  }
  for (const extra of options.extraOptions ?? []) {
    if (extra) {
      args.push(extra);
    }
  }
  return args;
}

/** Structured non-interactive test arguments used by companion CLI runs. */
export function buildCompanionTestArguments(selection: RunSelection, options: UiArgumentOptions): string[] {
  const args = ['test'];
  if (options.configFile) {
    args.push('--config', options.configFile);
  }
  for (const file of selection.files) {
    const filter = playwrightFileFilter(file, options.cwd);
    args.push(selection.line ? `${filter}:${selection.line}` : filter);
  }
  for (const project of options.projects ?? []) {
    if (project) {
      args.push('--project', project);
    }
  }
  if (selection.titleFilters.length > 0) {
    args.push('--grep', combineFilters(selection.titleFilters));
  }
  return args;
}

/** Target-scoped UI mode for uncommitted changes or a Git comparison ref. */
export function buildChangedUiArguments(options: UiArgumentOptions, ref?: string): string[] {
  const args = buildUiArguments({ files: [], titleFilters: [] }, options);
  args.push('--only-changed');
  if (ref) {
    args.push(ref);
  }
  return args;
}

/** Target-scoped UI mode using Playwright's persisted last-run data. */
export function buildLastFailedUiArguments(options: UiArgumentOptions): string[] {
  const args = buildUiArguments({ files: [], titleFilters: [] }, options);
  args.push('--last-failed');
  return args;
}

/** Tag grep is intentionally a single validated argv token, never shell text. */
export function buildTagArguments(
  mode: 'ui' | 'debug',
  tag: string,
  options: UiArgumentOptions,
): string[] {
  return mode === 'ui'
    ? buildUiArguments({ files: [], titleFilters: [tag] }, options)
    : buildDebugArguments({ files: [], titleFilters: [tag] }, options);
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
  // Keep positional file filters ahead of variadic CLI options such as
  // `--project <project-name...>`, otherwise Playwright can consume a trailing
  // `file:line` filter as another option value.
  for (const file of selection.files) {
    const fileFilter = playwrightFileFilter(file, options.cwd);
    args.push(selection.line ? `${fileFilter}:${selection.line}` : fileFilter);
  }
  if (options.browser) {
    args.push('--browser', options.browser);
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

/** Playwright treats positional file arguments as regular expressions. */
function playwrightFileFilter(file: string, cwd?: string): string {
  const fileFilter = cwd ? relativeOrAbsolute(file, cwd) : file;
  return escapeRegExp(fileFilter.replaceAll('\\', '/'));
}
