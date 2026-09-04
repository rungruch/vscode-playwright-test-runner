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
  suites?: JsonSuite[];
  errors?: JsonResultError[];
  stats?: JsonStats;
}

export interface ParsedCompanionReport {
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

  // Aggregate multiple runs/repetitions of the same test definition (e.g. Flake Lab repeatEach)
  const aggregatedParsed: CompanionTestItem[] = [];
  let detectedFlakeTests = 0;

  for (const parsedTest of parsed.tests) {
    const existing = aggregatedParsed.find((t) => isSameTest(t, parsedTest));
    if (!existing) {
      const isPassed = parsedTest.status === 'passed';
      const isFailed = parsedTest.status === 'failed';
      const isFlaky = parsedTest.status === 'flaky';
      aggregatedParsed.push({
        ...parsedTest,
        totalRuns: 1,
        passedRuns: isPassed ? 1 : 0,
        failedRuns: isFailed ? 1 : 0,
      });
      if (isFlaky) {
        detectedFlakeTests++;
      }
    } else {
      existing.totalRuns = (existing.totalRuns ?? 1) + 1;
      if (parsedTest.status === 'passed') {
        existing.passedRuns = (existing.passedRuns ?? 0) + 1;
      } else if (parsedTest.status === 'failed') {
        existing.failedRuns = (existing.failedRuns ?? 0) + 1;
      }
      existing.durationMs = (existing.durationMs ?? 0) + (parsedTest.durationMs ?? 0);
      if (parsedTest.message && !existing.message) {
        existing.message = parsedTest.message;
      }
      if (parsedTest.status === 'flaky' || (existing.passedRuns && existing.failedRuns)) {
        if (existing.status !== 'flaky') {
          detectedFlakeTests++;
        }
        existing.status = 'flaky';
      } else if (existing.failedRuns && !existing.passedRuns) {
        existing.status = 'failed';
      } else if (existing.passedRuns && !existing.failedRuns) {
        existing.status = 'passed';
      }
    }
  }

  const mergedTests = run.tests ? run.tests.map((t) => ({ ...t })) : [];
  if (aggregatedParsed.length > 0) {
    for (const aggTest of aggregatedParsed) {
      const idx = mergedTests.findIndex((t) => isSameTest(t, aggTest));
      if (idx >= 0) {
        mergedTests[idx] = { ...mergedTests[idx], ...aggTest };
      } else {
        mergedTests.push(aggTest);
      }
    }
  }

  const totalFlaky = Math.max(parsed.flaky, detectedFlakeTests);

  return {
    ...run,
    total: parsed.total,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    flaky: totalFlaky,
    durationMs: Math.max(run.durationMs, parsed.durationMs),
    failures: parsed.failures,
    tests: mergedTests.length > 0 ? mergedTests : run.tests,
  };
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
  if (a.file && b.file && path.normalize(a.file) === path.normalize(b.file)) {
    if (a.line !== undefined && b.line !== undefined && a.line === b.line) {
      return true;
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
    const testStatus: CompanionTestStatus = isFlaky
      ? 'flaky'
      : final.status === 'passed'
        ? 'passed'
        : final.status === 'skipped'
          ? 'skipped'
          : 'failed';
    summary.tests.push({
      id: `${file ?? ''}:${line ?? 1}:${testTitle}${test.projectName ? `:${test.projectName}` : ''}`,
      title: testTitle,
      file,
      line,
      status: testStatus,
      durationMs: totalDuration,
      message: testStatus === 'failed' || testStatus === 'flaky' ? errorMessage(final) : undefined,
      project: test.projectName,
    });
    if (final.status === 'passed') {
      summary.passed++;
    } else if (final.status === 'skipped') {
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

export interface RunningProgressInfo {
  title?: string;
  index?: number;
  total?: number;
  file?: string;
  line?: number;
  column?: number;
  project?: string;
  totalAnnounced?: number;
  failedTitle?: string;
  isRetry?: boolean;
}

/**
 * Structured extraction of progress from Playwright CLI stdout/stderr line reporter text.
 */
export function extractRunningProgress(text: string): RunningProgressInfo | undefined {
  const lines = text.split(/\r?\n/);
  let result: RunningProgressInfo | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    // Header: "Running X tests using Y workers"
    const runningMatch = /^Running\s+(\d+)\s+tests?\b/i.exec(line);
    if (runningMatch) {
      result = { ...result, totalAnnounced: parseInt(runningMatch[1], 10) };
      continue;
    }

    // Line reporter format:
    // [1/5] [browserless] › tests/example.spec.ts:4:7 › Math › adds numbers
    // [12/17] (retries) [chromium] › tests/calendar.spec.ts:631:9 › ... (retry #1)
    // or [browserless] › tests/example.spec.ts:4:7 › Math › adds numbers
    // or [1/5] › tests/example.spec.ts:4:7 › Math › adds numbers
    const isRetry = /\((?:retries|retry(?:\s*#\d+)?)\)/i.test(line);
    const testLineMatch = /^(?:\[(\d+)\/(\d+)\]\s+)?(?:\((?:retries|retry(?:\s*#\d+)?)\)\s+)?(?:\[([^\]]+)\]\s+›\s+)?(?:([^:\s]+):(\d+):(\d+)\s+›\s+)?(.+)$/.exec(line);
    if (testLineMatch) {
      const idx = testLineMatch[1] ? parseInt(testLineMatch[1], 10) : undefined;
      const tot = testLineMatch[2] ? parseInt(testLineMatch[2], 10) : undefined;
      const project = testLineMatch[3]?.trim();
      const file = testLineMatch[4]?.trim();
      const lineNum = testLineMatch[5] ? parseInt(testLineMatch[5], 10) : undefined;
      const col = testLineMatch[6] ? parseInt(testLineMatch[6], 10) : undefined;
      let title = testLineMatch[7]?.trim();

      if (idx !== undefined || project || (file && lineNum !== undefined)) {
        title = title ? title.replace(/^[^:\s]+:\d+:\d+\s+›\s+/, '').trim() : '';
        title = title ? title.replace(/\s*\(retry\s*#\d+\)$/i, '').trim() : '';
        if (title) {
          result = {
            ...result,
            index: idx,
            total: tot,
            project: project || undefined,
            file: file || undefined,
            line: lineNum,
            column: col,
            title,
            isRetry: isRetry || undefined,
          };
        }
      }
    }

    // Failure marker: "  1) [browser] › file:line:col › title ---------------------"
    const failMatch = /^\s*\d+\)\s+(?:\[([^\]]+)\]\s+›\s+)?(?:([^:\s]+):(\d+):(\d+)\s+›\s+)?(.+)$/.exec(line);
    if (failMatch) {
      let rawFail = failMatch[5]?.trim();
      if (rawFail) {
        rawFail = rawFail.replace(/\s*-+$/g, '').trim();
        rawFail = rawFail.replace(/^[^:\s]+:\d+:\d+\s+›\s+/, '').trim();
        if (rawFail) {
          result = {
            ...result,
            failedTitle: rawFail,
          };
        }
      }
    }
  }

  return result;
}

/**
 * Best-effort extraction of the active test title from Playwright CLI stdout/stderr line reporter text.
 * Expects Playwright's standard line reporter format: `[browser] › file.spec.ts:line:col › Suite › Test Title`
 */
export function extractRunningTestTitle(text: string): string | undefined {
  const progress = extractRunningProgress(text);
  if (progress?.title) {
    return progress.title;
  }
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    const match = /\[[^\]]+\]\s+›\s+(.+)$/.exec(line);
    if (match) {
      const raw = match[1].replace(/^[^:]+:\d+:\d+\s+›\s+/, '').trim();
      if (raw) {
        return raw;
      }
    }
  }
  return undefined;
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

  // 1. Check active run execution
  if (hasActiveRun && summary.status === 'running') {
    const activeTest = summary.tests?.find((t) => (
      t.status === 'running'
      && (!t.file || path.normalize(t.file) === normalizedFile)
      && (t.line === line + 1 || isTitlePathMatch(t.title, titlePath))
    ));
    if (activeTest) {
      return { status: 'running' };
    }
    if (summary.currentTest && isTitlePathMatch(summary.currentTest, titlePath)) {
      return { status: 'running' };
    }
  }

  // If still actively running other tests, do not report stale completed statuses
  if (summary.status === 'running') {
    return undefined;
  }

  // 2. Check tests in summary first for exact test status (including flaky and passed)
  const testItem = summary.tests?.find((t) => (
    (!t.file || path.normalize(t.file) === normalizedFile)
    && (t.line === line + 1 || isTitlePathMatch(t.title, titlePath))
  ));
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

  // 3. Fallback: check failures
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

