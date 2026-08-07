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
  results?: JsonResult[];
}

interface JsonSpec {
  title?: string;
  file?: string;
  line?: number;
  column?: number;
  tests?: JsonTest[];
}

interface JsonSuite {
  title?: string;
  file?: string;
  line?: number;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

interface JsonReport {
  suites?: JsonSuite[];
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
  return summary;
}

/** Adds a parsed report to a persisted run while retaining execution state. */
export function withParsedReport(
  run: CompanionRunSummary,
  parsed: ParsedCompanionReport | undefined,
): CompanionRunSummary {
  if (!parsed) {
    return run;
  }
  const mergedTests = run.tests ? run.tests.map((t) => ({ ...t })) : [];
  if (parsed.tests.length > 0) {
    for (const parsedTest of parsed.tests) {
      const idx = mergedTests.findIndex((t) => isTitleMatch(t.title, parsedTest.title));
      if (idx >= 0) {
        mergedTests[idx] = { ...mergedTests[idx], ...parsedTest };
      } else {
        mergedTests.push(parsedTest);
      }
    }
  }
  return {
    ...run,
    total: parsed.total,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    flaky: parsed.flaky,
    durationMs: Math.max(run.durationMs, parsed.durationMs),
    failures: parsed.failures,
    tests: mergedTests.length > 0 ? mergedTests : run.tests,
  };
}

function stripTags(title: string): string {
  return title.replace(/(?:\s+@\S+)+$/g, '').trim();
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
  return (
    cleanB.endsWith(` › ${cleanA}`)
    || cleanA.endsWith(` › ${cleanB}`)
    || cleanB.endsWith(` ${cleanA}`)
    || cleanA.endsWith(` ${cleanB}`)
  );
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
    if (recovered) {
      summary.flaky++;
    }
    const testTitle = titlePath.join(' › ') || 'Unnamed Playwright test';
    const testStatus: CompanionTestStatus = final.status === 'passed' ? 'passed' : final.status === 'skipped' ? 'skipped' : 'failed';
    summary.tests.push({
      id: `${file ?? ''}:${line ?? 1}:${testTitle}`,
      title: testTitle,
      file,
      line,
      status: testStatus,
      durationMs: totalDuration,
      message: testStatus === 'failed' ? errorMessage(final) : undefined,
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

/**
 * Best-effort extraction of the active test title from Playwright CLI stdout/stderr line reporter text.
 * Expects Playwright's standard line reporter format: `[browser] › file.spec.ts:line:col › Suite › Test Title`
 */
export function extractRunningTestTitle(text: string): string | undefined {
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
