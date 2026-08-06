import * as path from 'path';
import { JsonReport, JsonSpec, JsonSuite } from './jsonReport';
import {
  DiscoveredConfig,
  DiscoveredFile,
  DiscoveredSuite,
  DiscoveredTest,
  isSkippedStatus,
} from './model';

/**
 * Parses the stdout of `playwright test --list --reporter=json` into the
 * internal discovery model. Tolerant of malformed output: the CLI may print
 * non-JSON noise (npm banners, warnings) before the JSON document, so the
 * first '{' is located before parsing.
 */
export function parseDiscoveryOutput(
  stdout: string,
  base: { id: string; cwd: string; configFile?: string },
): DiscoveredConfig {
  const report = extractJson(stdout);
  const config: DiscoveredConfig = {
    id: base.id,
    cwd: base.cwd,
    configFile: base.configFile,
    rootDir: base.cwd,
    projects: [],
    files: [],
    errors: [],
  };
  if (!report) {
    config.errors.push('Playwright did not produce a JSON report.');
    return config;
  }

  const rootDir = report.config?.rootDir;
  if (typeof rootDir === 'string' && rootDir.length > 0) {
    config.rootDir = path.normalize(rootDir);
  }

  const projectNames = new Set<string>();
  for (const project of report.config?.projects ?? []) {
    if (project?.name) {
      projectNames.add(project.name);
    }
  }

  const files = new Map<string, DiscoveredFile>();

  for (const suite of report.suites ?? []) {
    collectSuite(suite, config, files, projectNames, []);
  }

  // Dynamic tests (e.g. generated in loops inside test.describe.configure or
  // non-standard helpers) may surface only as specs without a file suite.
  config.projects = [...projectNames].sort();
  config.files = [...files.values()].sort((a, b) => a.relativeFile.localeCompare(b.relativeFile));
  for (const error of report.errors ?? []) {
    if (error?.message) {
      config.errors.push(error.message);
    }
  }
  return config;
}

function collectSuite(
  suite: JsonSuite,
  config: DiscoveredConfig,
  files: Map<string, DiscoveredFile>,
  projectNames: Set<string>,
  titlePath: string[],
): void {
  if (!suite || typeof suite !== 'object') {
    return;
  }
  const file = normalizeFile(suite.file, config);
  const title = typeof suite.title === 'string' ? suite.title : '';
  const fileEntry = file ? ensureFile(config, files, file) : undefined;

  const isFileSuite = titlePath.length === 0 && file && title === path.basename(file);
  const suitePath = isFileSuite ? titlePath : title ? [...titlePath, title] : titlePath;

  let node: DiscoveredSuite | undefined;
  if (!isFileSuite && fileEntry && title) {
    node = {
      id: suiteId(config, file!, suitePath, suite.line),
      title,
      location: {
        file: file!,
        line: suite.line ?? 0,
        column: suite.column ?? 0,
      },
      suites: [],
      tests: [],
    };
    fileEntry.suites.push(node);
  }

  for (const spec of suite.specs ?? []) {
    const test = convertSpec(spec, config, suitePath, projectNames);
    if (!test) {
      continue;
    }
    if (node) {
      node.tests.push(test);
    } else if (fileEntry) {
      fileEntry.tests.push(test);
    }
  }

  for (const child of suite.suites ?? []) {
    const before = fileEntry?.suites.length ?? 0;
    collectSuite(child, config, files, projectNames, suitePath);
    // Nest child suites that were appended as top-level entries of the file.
    if (node && fileEntry && fileEntry.suites.length > before) {
      const nested = fileEntry.suites.splice(before);
      node.suites.push(...nested);
    }
  }
}

function convertSpec(
  spec: JsonSpec,
  config: DiscoveredConfig,
  titlePath: string[],
  projectNames: Set<string>,
): DiscoveredTest | undefined {
  if (!spec || typeof spec.title !== 'string') {
    return undefined;
  }
  const file = normalizeFile(spec.file, config);
  if (!file) {
    return undefined;
  }
  const projects = new Set<string>();
  let skipped = false;
  for (const t of spec.tests ?? []) {
    if (t?.projectName) {
      projects.add(t.projectName);
      projectNames.add(t.projectName);
    }
    if (isSkippedStatus(t?.status) || t?.expectedStatus === 'skipped') {
      skipped = true;
    }
  }
  const specId = typeof spec.id === 'string' && spec.id.length > 0 ? spec.id : fallbackSpecId(file, spec, titlePath);
  return {
    id: `${config.id}:${specId}`,
    title: spec.title,
    fullTitle: [...titlePath, spec.title].join(' '),
    location: {
      file,
      line: spec.line ?? 0,
      column: spec.column ?? 0,
    },
    projects: [...projects].sort(),
    tags: Array.isArray(spec.tags) ? spec.tags.filter((t): t is string => typeof t === 'string') : [],
    skipped,
  };
}

function ensureFile(config: DiscoveredConfig, files: Map<string, DiscoveredFile>, file: string): DiscoveredFile {
  let entry = files.get(file);
  if (!entry) {
    entry = {
      id: `${config.id}:file:${path.relative(config.rootDir, file) || path.basename(file)}`,
      file,
      relativeFile: path.relative(config.rootDir, file) || path.basename(file),
      suites: [],
      tests: [],
    };
    files.set(file, entry);
  }
  return entry;
}

function suiteId(config: DiscoveredConfig, file: string, titlePath: string[], line?: number): string {
  return `${config.id}:suite:${path.relative(config.rootDir, file)}:${titlePath.join('>')}:${line ?? 0}`;
}

function fallbackSpecId(file: string, spec: JsonSpec, titlePath: string[]): string {
  return `spec:${file}:${spec.line ?? 0}:${[...titlePath, spec.title].join('>')}`;
}

function normalizeFile(file: string | undefined, config: DiscoveredConfig): string | undefined {
  if (typeof file !== 'string' || file.length === 0) {
    return undefined;
  }
  const absolute = path.isAbsolute(file) ? file : path.resolve(config.rootDir, file);
  return path.normalize(absolute);
}

/**
 * Locates and parses the first JSON document in the output. Returns undefined
 * when no parseable document exists.
 */
export function extractJson(stdout: string): JsonReport | undefined {
  if (typeof stdout !== 'string') {
    return undefined;
  }
  let start = stdout.indexOf('{');
  while (start !== -1) {
    const candidate = stdout.slice(start);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed as JsonReport;
      }
      return undefined;
    } catch {
      start = stdout.indexOf('{', start + 1);
    }
  }
  return undefined;
}
