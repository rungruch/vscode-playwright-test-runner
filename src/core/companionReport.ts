import * as path from 'path';
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
  for (const parsedTest of parsedTests) {
    let aggregate = aggregatedParsed.find((test) => isSameTest(test, parsedTest));
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
  if (aggregatedParsed.length > 0) {
    for (const aggTest of aggregatedParsed) {
      const idx = mergedTests.findIndex((t) => isSameTest(t, aggTest));
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

function stripTags(title: string): string {
  return title
    .replace(/(?:\s*\(retry\s*#\d+\))$/gi, '')
    .replace(/(?:\s+@\S+)+$/g, '')
    .trim();
}

function stripFilePrefix(title: string): string {
  const parts = title.split(' › ');
  if (parts.length > 1) {
    const first = parts[0];
    if (/\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(first) || first.endsWith('.ts') || first.endsWith('.js') || first.includes('/') || first.includes('\\')) {
      return parts.slice(1).join(' › ');
    }
  }
  return title;
}

function isSameTest(a: CompanionTestItem, b: CompanionTestItem): boolean {
  if (a.file && b.file) {
    if (path.normalize(a.file) !== path.normalize(b.file)) {
      return false;
    }
    if (a.line !== undefined && b.line !== undefined && a.line !== b.line) {
      return false;
    }
  }
  return isTitleMatch(a.title, b.title);
}

export function isTitleMatch(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const cleanA = stripTags(a);
  const cleanB = stripTags(b);
  if (cleanA === cleanB) {
    return true;
  }
  const strippedA = stripTags(stripFilePrefix(cleanA));
  const strippedB = stripTags(stripFilePrefix(cleanB));
  if (strippedA === strippedB) {
    return true;
  }
  return false;
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
    const isFlaky = test.status === 'flaky' || recovered;
    if (isFlaky) {
      summary.flaky++;
    }
    const testTitle = titlePath.join(' › ') || 'Unnamed Playwright test';
    const isExpected = test.status === 'expected';
    const isUnexpected = test.status === 'unexpected';
    const testStatus: CompanionTestStatus = isFlaky
      ? 'flaky'
      : test.status === 'skipped' || final.status === 'skipped'
        ? 'skipped'
        : isExpected
          ? 'passed'
          : isUnexpected
            ? 'failed'
            : final.status === 'passed'
              ? 'passed'
              : 'failed';
    const diagnosticResult = isFlaky
      ? results.find((result) => isFailure(result.status ?? 'unknown')) ?? final
      : final;
    summary.tests.push({
      id: `${file ?? ''}:${line ?? 1}:${testTitle}${test.projectName ? `:${test.projectName}` : ''}`,
      title: testTitle,
      file,
      line,
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
        titlePath,
        file,
        line,
        message: errorMessage(final),
      });
    }
  }
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
export function lookupTestRunStatus(
  summary: CompanionRunSummary | undefined,
  hasActiveRun: boolean,
  file: string,
  line: number,
  titlePath?: string[],
): TestRunStatus | undefined {
  if (!summary) {
    return undefined;
  }
  const normalizedFile = path.normalize(file);
  const testItem = summary.tests?.find((test) => (
    (!test.file || path.normalize(test.file) === normalizedFile)
    && (test.line === line + 1 || isTitlePathMatch(test.title, titlePath))
  ));

  // Persisted running summaries are stale after extension reload. Live runs can
  // safely expose both active and already-completed status from reporter events.
  if (summary.status === 'running') {
    if (!hasActiveRun) {
      return undefined;
    }
    if (testItem?.status === 'running') {
      return { status: 'running' };
    }
    if (!testItem && summary.currentTest && isTitlePathMatch(summary.currentTest, titlePath)) {
      return { status: 'running' };
    }
  }

  // Check the exact test status, including tests completed while other workers run.
  if (testItem) {
    if (testItem.status === 'flaky') {
      return { status: 'flaky', durationMs: testItem.durationMs };
    }
    if (testItem.status === 'failed') {
      const failure = summary.failures.find((f) => (
        (!f.file || path.normalize(f.file) === normalizedFile)
        && (f.line === line + 1 || isTitlePathMatch(f.title, titlePath) || isArrayMatch(f.titlePath, titlePath))
      ));
      return { status: 'failed', durationMs: testItem.durationMs, failure };
    }
    if (testItem.status === 'passed') {
      return { status: 'passed', durationMs: testItem.durationMs };
    }
  }

  // Fallback: check failures
  const failure = summary.failures.find((f) => (
    (!f.file || path.normalize(f.file) === normalizedFile)
    && (f.line === line + 1 || isTitlePathMatch(f.title, titlePath) || isArrayMatch(f.titlePath, titlePath))
  ));
  if (failure) {
    return { status: 'failed', failure };
  }

  return undefined;
}

function isTitlePathMatch(title: string, titlePath?: string[]): boolean {
  if (!titlePath || titlePath.length === 0) {
    return false;
  }
  const joined = titlePath.join(' › ');
  const last = titlePath[titlePath.length - 1];
  return title === joined || title === last || title.endsWith(` › ${last}`) || isTitleMatch(title, joined);
}

function isArrayMatch(a?: string[], b?: string[]): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return a.every((val, i) => val === b[i]);
}
