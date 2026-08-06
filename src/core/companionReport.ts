import { CompanionFailure, CompanionRunSummary } from './companionTypes';

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
  return {
    ...run,
    total: parsed.total,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    flaky: parsed.flaky,
    durationMs: Math.max(run.durationMs, parsed.durationMs),
    failures: parsed.failures,
  };
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
    summary.durationMs += results.reduce((duration, result) => duration + (result.duration ?? 0), 0);
    const final = results[results.length - 1];
    const statuses = results.map((result) => result.status ?? 'unknown');
    const recovered = final.status === 'passed' && statuses.slice(0, -1).some((status) => isFailure(status));
    if (recovered) {
      summary.flaky++;
    }
    if (final.status === 'passed') {
      summary.passed++;
    } else if (final.status === 'skipped') {
      summary.skipped++;
    } else {
      summary.failed++;
      summary.failures.push({
        title: titlePath.join(' › ') || 'Unnamed Playwright test',
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
