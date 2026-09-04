import {
  COMPANION_REPORTER_EVENT_PREFIX,
  COMPANION_REPORTER_EVENT_VERSION,
  COMPANION_REPORTER_RUN_ID_ENV,
  CompanionReporterEvent,
  CompanionReporterTest,
} from './core/companionLive';

interface ReporterProject {
  name: string;
}

interface ReporterSuite {
  allTests(): ReporterTestCase[];
}

interface ReporterTestCase {
  id: string;
  title: string;
  location?: { file?: string; line?: number };
  parent: { project(): ReporterProject | undefined };
  repeatEachIndex?: number;
  retries: number;
  results: unknown[];
  titlePath(): string[];
  outcome(): string;
}

interface ReporterTestResult {
  retry?: number;
  workerIndex?: number;
  status?: string;
  duration?: number;
  error?: { message?: string; stack?: string; value?: string };
  errors?: Array<{ message?: string; stack?: string; value?: string }>;
}

/** Playwright-side reporter that emits private lifecycle events for managed sidebar runs. */
export default class CompanionReporter {
  private readonly runId = process.env[COMPANION_REPORTER_RUN_ID_ENV];

  onBegin(_config: unknown, suite: ReporterSuite): void {
    if (!this.runId) {
      return;
    }
    const tests = suite.allTests().map((test) => reporterTest(test));
    this.emit({
      version: COMPANION_REPORTER_EVENT_VERSION,
      runId: this.runId,
      type: 'plan',
      total: tests.length,
      tests,
    });
  }

  onTestBegin(test: ReporterTestCase, result: ReporterTestResult): void {
    if (!this.runId) {
      return;
    }
    this.emit({
      version: COMPANION_REPORTER_EVENT_VERSION,
      runId: this.runId,
      type: 'testBegin',
      test: reporterTest(test),
      retry: result.retry ?? 0,
      workerIndex: result.workerIndex ?? -1,
    });
  }

  onTestEnd(test: ReporterTestCase, result: ReporterTestResult): void {
    if (!this.runId) {
      return;
    }
    this.emit({
      version: COMPANION_REPORTER_EVENT_VERSION,
      runId: this.runId,
      type: 'testEnd',
      test: reporterTest(test),
      retry: result.retry ?? 0,
      workerIndex: result.workerIndex ?? -1,
      status: result.status ?? 'unknown',
      outcome: test.outcome(),
      durationMs: result.duration ?? 0,
      error: reporterError(result),
      willRetry: test.outcome() === 'unexpected' && test.results.length <= test.retries,
    });
  }

  printsToStdio(): boolean {
    return false;
  }

  private emit(event: CompanionReporterEvent): void {
    process.stdout.write(`${COMPANION_REPORTER_EVENT_PREFIX}${JSON.stringify(event)}\n`);
  }
}

function reporterTest(test: ReporterTestCase): CompanionReporterTest {
  const titlePath = test.titlePath();
  const titleParts = titlePath.length >= 4 ? titlePath.slice(3) : [test.title];
  return {
    id: test.id,
    title: titleParts.join(' › ') || test.title,
    file: test.location?.file,
    line: test.location?.line,
    project: test.parent.project()?.name,
    repeatEachIndex: test.repeatEachIndex,
    retries: test.retries,
  };
}

function reporterError(result: ReporterTestResult): string | undefined {
  const error = result.error ?? result.errors?.[0];
  return error?.message ?? error?.stack ?? error?.value;
}
