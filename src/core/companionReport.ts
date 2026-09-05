import * as path from 'path';
import { legacyTitle, SourceTestIndex } from './testIdentity';
import { terminalTestStatus } from './testOutcome';
import { CompanionFailure, CompanionRunSummary, CompanionTestItem, CompanionTestStatus } from './companionTypes';

interface JsonResultError {
  message?: string;
  stack?: string;
  value?: string;
}

interface JsonResult {
  status?: string;
  duration?: number;
  error?: JsonResultError;
  errors?: JsonResultError[];
}

interface JsonTest {
  projectName?: string;
  expectedStatus?: string;
  status?: string;
  results?: JsonResult[];
}

interface JsonSpec {
  id?: string;
  title?: string;
  file?: string;
  line?: number;
  column?: number;
  ok?: boolean;
  tests?: JsonTest[];
}

interface JsonSuite {
  title?: string;
  file?: string;
  line?: number;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

interface JsonStats {
  startTime?: string;
  duration?: number;
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
}

interface JsonReport {
  config?: { rootDir?: string };
  suites?: JsonSuite[];
  errors?: JsonResultError[];
  stats?: JsonStats;
}

export interface ParsedCompanionReport {
  rootDir?: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  durationMs: number;
  failures: CompanionFailure[];
  tests: CompanionTestItem[];
}

/** Parses the stable subset of Playwright's JSON reporter output. */
export function parseCompanionJsonReport(text: string): ParsedCompanionReport | undefined {
  const report = parseJsonObject(text) as JsonReport | undefined;
  if (!report || !Array.isArray(report.suites)) {
    return undefined;
  }
  const summary: ParsedCompanionReport = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    durationMs: 0,
    failures: [],
    tests: [],
  };
  if (typeof report.config?.rootDir === 'string') {
    summary.rootDir = report.config.rootDir;
  }
  for (const suite of report.suites) {
    visitSuite(suite, [], undefined, undefined, summary);
  }
  if (report.stats) {
    if (typeof report.stats.flaky === 'number' && report.stats.flaky > summary.flaky) {
      summary.flaky = report.stats.flaky;
    }
    if (typeof report.stats.duration === 'number' && report.stats.duration > summary.durationMs) {
      summary.durationMs = Math.round(report.stats.duration);
    }
  }
  if (Array.isArray(report.errors) && report.errors.length > 0) {
    for (const err of report.errors) {
      const msg = err.message ?? err.stack ?? err.value;
      if (msg) {
        summary.failures.push({
          title: 'Global error',
          message: msg,
        });
      }
    }
  }
  return summary;
}

/** Adds a parsed report to a persisted run while retaining execution state and aggregating repetitions. */
export function withParsedReport(
  run: CompanionRunSummary,
  parsed: ParsedCompanionReport | undefined,
): CompanionRunSummary {
  if (!parsed) {
    return run;
  }

  const parsedTests = parsed.tests.map((test) => ({
    ...test,
    file: absoluteReportFile(test.file, parsed.rootDir ?? run.cwd),
  }));
  const parsedFailures = parsed.failures.map((failure) => ({
    ...failure,
    file: absoluteReportFile(failure.file, parsed.rootDir ?? run.cwd),
  }));

  // Aggregate multiple projects/repetitions of the same source test.
  const aggregatedParsed: CompanionTestItem[] = [];
  const aggregates = new SourceTestIndex<CompanionTestItem>((test) => test, run.cwd);
  for (const parsedTest of parsedTests) {
    let aggregate = aggregates.find(parsedTest);
    if (!aggregate) {
      aggregate = {
        ...parsedTest,
        status: 'pending',
        durationMs: 0,
        totalRuns: 0,
        completedRuns: 0,
        activeRuns: 0,
        passedRuns: 0,
        failedRuns: 0,
        skippedRuns: 0,
        flakyRuns: 0,
      };
      aggregatedParsed.push(aggregate);
      aggregates.add(aggregate);
    }

    aggregate.totalRuns = (aggregate.totalRuns ?? 0) + 1;
    aggregate.completedRuns = (aggregate.completedRuns ?? 0) + 1;
    aggregate.durationMs = (aggregate.durationMs ?? 0) + (parsedTest.durationMs ?? 0);
    if (parsedTest.status === 'passed') {
      aggregate.passedRuns = (aggregate.passedRuns ?? 0) + 1;
    } else if (parsedTest.status === 'failed') {
      aggregate.failedRuns = (aggregate.failedRuns ?? 0) + 1;
    } else if (parsedTest.status === 'flaky') {
      aggregate.passedRuns = (aggregate.passedRuns ?? 0) + 1;
      aggregate.flakyRuns = (aggregate.flakyRuns ?? 0) + 1;
    } else if (parsedTest.status === 'skipped') {
      aggregate.skippedRuns = (aggregate.skippedRuns ?? 0) + 1;
    }
    if (parsedTest.message && !aggregate.message) {
      aggregate.message = parsedTest.message;
    }
  }

  for (const aggregate of aggregatedParsed) {
    aggregate.status = aggregateStatus(aggregate);
  }

  const mergedTests = run.tests ? run.tests.map((t) => ({ ...t })) : [];
  const mergeIndex = new SourceTestIndex<{ test: CompanionTestItem; index: number }>((entry) => entry.test, run.cwd);
  mergedTests.forEach((test, index) => mergeIndex.add({ test, index }));
  if (aggregatedParsed.length > 0) {
    for (const aggTest of aggregatedParsed) {
      const idx = mergeIndex.find(aggTest)?.index ?? -1;
      if (idx >= 0) {
        const existing = mergedTests[idx];
        mergedTests[idx] = {
          ...existing,
          ...aggTest,
          id: existing.id,
          title: existing.title,
          file: existing.file ?? aggTest.file,
          line: existing.line ?? aggTest.line,
        };
      } else {
        mergedTests.push(aggTest);
      }
    }
  }

  const detectedFlakeTests = aggregatedParsed.filter((test) => test.status === 'flaky').length;
  const totalFlaky = Math.max(parsed.flaky, detectedFlakeTests);

  return {
    ...run,
    total: Math.max(run.total, parsed.total),
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    flaky: totalFlaky,
    durationMs: Math.max(run.durationMs, parsed.durationMs),
    failures: parsedFailures,
    tests: mergedTests.length > 0 ? mergedTests : run.tests,
    currentTest: undefined,
    completedTests: parsed.total,
    activeTests: 0,
  };
}

function absoluteReportFile(file: string | undefined, cwd: string): string | undefined {
  if (!file) {
    return undefined;
  }
  return path.normalize(path.isAbsolute(file) ? file : path.resolve(cwd, file));
}

function aggregateStatus(test: CompanionTestItem): CompanionTestStatus {
  const passed = test.passedRuns ?? 0;
  const failed = test.failedRuns ?? 0;
  if ((test.flakyRuns ?? 0) > 0 || (passed > 0 && failed > 0)) {
    return 'flaky';
  }
  if (failed > 0) {
    return 'failed';
  }
  if (passed > 0) {
    return 'passed';
  }
  return (test.skippedRuns ?? 0) > 0 ? 'skipped' : 'pending';
}

export function isTitleMatch(a: string, b: string): boolean {
  return a === b || legacyTitle(a) === legacyTitle(b);
}

function visitSuite(
  suite: JsonSuite,
  parents: string[],
  inheritedFile: string | undefined,
  inheritedLine: number | undefined,
  summary: ParsedCompanionReport,
): void {
  const titlePath = suite.title ? [...parents, suite.title] : parents;
  const file = suite.file ?? inheritedFile;
  const line = suite.line ?? inheritedLine;
  for (const spec of suite.specs ?? []) {
    visitSpec(spec, titlePath, file, line, summary);
  }
  for (const child of suite.suites ?? []) {
    visitSuite(child, titlePath, file, line, summary);
  }
}

function visitSpec(
  spec: JsonSpec,
  parents: string[],
  inheritedFile: string | undefined,
  inheritedLine: number | undefined,
  summary: ParsedCompanionReport,
): void {
  const titlePath = spec.title ? [...parents, spec.title] : parents;
  const file = spec.file ?? inheritedFile;
  const line = spec.line ?? inheritedLine;
  for (const test of spec.tests ?? []) {
    const results = test.results ?? [];
    if (results.length === 0) {
      continue;
    }
    summary.total++;
    const totalDuration = results.reduce((duration, result) => duration + (result.duration ?? 0), 0);
    summary.durationMs += totalDuration;
    const final = results[results.length - 1];
    const statuses = results.map((result) => result.status ?? 'unknown');
    const recovered = final.status === 'passed' && statuses.slice(0, -1).some((status) => isFailure(status));
    const testStatus = terminalTestStatus(test.status, final.status, recovered);
    const isFlaky = testStatus === 'flaky';
    if (isFlaky) {
      summary.flaky++;
    }
    const testTitle = titlePath.join(' › ') || 'Unnamed Playwright test';
    const diagnosticResult = isFlaky
      ? results.find((result) => isFailure(result.status ?? 'unknown')) ?? final
      : final;
    summary.tests.push({
      id: JSON.stringify([file, line, spec.column, sourceTitlePath(titlePath, file), test.projectName]),
      title: testTitle,
      titlePath: sourceTitlePath(titlePath, file),
      file,
      line,
      column: spec.column,
      status: testStatus,
      durationMs: totalDuration,
      message: testStatus === 'failed' || testStatus === 'flaky' ? errorMessage(diagnosticResult) : undefined,
      project: test.projectName,
    });
    if (testStatus === 'passed' || testStatus === 'flaky') {
      summary.passed++;
    } else if (testStatus === 'skipped') {
      summary.skipped++;
    } else {
      summary.failed++;
      summary.failures.push({
        title: testTitle,
        titlePath: sourceTitlePath(titlePath, file),
        file,
        line,
        column: spec.column,
        message: errorMessage(final),
      });
    }
  }
}

function sourceTitlePath(titles: string[], file?: string): string[] {
  if (file && titles.length > 1 && (titles[0] === file || titles[0] === path.basename(file))) {
    return titles.slice(1);
  }
  return titles;
}

function isFailure(status: string): boolean {
  return status === 'failed' || status === 'timedOut' || status === 'interrupted';
}

function errorMessage(result: JsonResult): string | undefined {
  const error = result.error ?? result.errors?.[0];
  return error?.message ?? error?.stack ?? error?.value;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

export interface TestRunStatus {
  status: 'running' | 'passed' | 'failed' | 'flaky';
  durationMs?: number;
  failure?: CompanionFailure;
}

/**
 * Fast in-memory lookup matching a test file and line/title against the latest companion run.
 */
const statusIndexes = new WeakMap<CompanionRunSummary, {
  tests: SourceTestIndex<CompanionTestItem>;
  failures: SourceTestIndex<CompanionFailure>;
}>();

export function lookupTestRunStatus(
  summary: CompanionRunSummary | undefined,
  hasActiveRun: boolean,
  file: string,
  line: number,
  titlePath?: string[],
  column?: number,
  titlePaths?: string[][],
): TestRunStatus | undefined {
  if (!summary || (summary.status === 'running' && !hasActiveRun)) {
    return undefined;
  }
  let indexes = statusIndexes.get(summary);
  if (!indexes) {
    indexes = {
      tests: new SourceTestIndex((test: CompanionTestItem) => test, summary.cwd),
      failures: new SourceTestIndex((failure: CompanionFailure) => failure, summary.cwd),
    };
    for (const test of summary.tests ?? []) {
      indexes.tests.add(test);
    }
    for (const failure of summary.failures) {
      indexes.failures.add(failure);
    }
    statusIndexes.set(summary, indexes);
  }
  const query = { file, line: line + 1, column, titlePath, title: titlePath?.join(' › ') ?? '' };
  const exact = indexes.tests.find(query);
  const candidates = titlePaths && titlePaths.length > 1
    ? titlePaths.flatMap((titles) => {
      const test = indexes.tests.find({ ...query, titlePath: titles, title: titles.join(' › ') });
      return test ? [test] : [];
    })
    : exact ? [exact] : titlePath ? [] : indexes.tests.atLocation(query);
  const locationFailures = indexes.failures.atLocation(query);
  const failure = indexes.failures.find(query)
    ?? (exact && locationFailures.length === 1 && !locationFailures[0].titlePath ? locationFailures[0] : undefined);
  if (candidates.length > 0) {
    const statuses = candidates.map((test) => test.status);
    if (statuses.includes('running') && hasActiveRun) {
      return { status: 'running' };
    }
    const status = statuses.includes('flaky') || (statuses.includes('passed') && statuses.includes('failed'))
      ? 'flaky' : statuses.includes('failed') ? 'failed' : statuses.every((status) => status === 'passed') ? 'passed' : undefined;
    if (status) {
      const durationMs = candidates.every((test) => test.durationMs === undefined)
        ? undefined : candidates.reduce((sum, test) => sum + (test.durationMs ?? 0), 0);
      return status === 'failed' ? { status, durationMs, failure } : { status, durationMs };
    }
  }
  return failure ? { status: 'failed', failure } : undefined;
}
