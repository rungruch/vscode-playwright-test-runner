import * as path from 'path';
import { isTitleMatch } from './companionReport';
import { CompanionFailure, CompanionRunSummary, CompanionTestItem, CompanionTestStatus } from './companionTypes';

export const COMPANION_REPORTER_EVENT_PREFIX = '\u001ePLAYWRIGHT_CODELENS_EVENT:';
export const COMPANION_REPORTER_EVENT_VERSION = 1;
export const COMPANION_REPORTER_RUN_ID_ENV = 'PLAYWRIGHT_CODELENS_RUN_ID';

export interface CompanionReporterTest {
  id: string;
  title: string;
  file?: string;
  line?: number;
  project?: string;
  repeatEachIndex?: number;
  retries?: number;
}

interface CompanionReporterEventBase {
  version: typeof COMPANION_REPORTER_EVENT_VERSION;
  runId: string;
}

export interface CompanionReporterPlanEvent extends CompanionReporterEventBase {
  type: 'plan';
  total: number;
  tests: CompanionReporterTest[];
}

export interface CompanionReporterTestBeginEvent extends CompanionReporterEventBase {
  type: 'testBegin';
  test: CompanionReporterTest;
  retry: number;
  workerIndex: number;
}

export interface CompanionReporterTestEndEvent extends CompanionReporterEventBase {
  type: 'testEnd';
  test: CompanionReporterTest;
  retry: number;
  workerIndex: number;
  status: string;
  outcome: string;
  durationMs: number;
  error?: string;
  willRetry: boolean;
}

export type CompanionReporterEvent =
  | CompanionReporterPlanEvent
  | CompanionReporterTestBeginEvent
  | CompanionReporterTestEndEvent;

export interface DecodedCompanionOutput {
  events: CompanionReporterEvent[];
  output: string;
}

/** Decodes reporter protocol frames without leaking them into the user-facing CLI output. */
export class CompanionReporterEventDecoder {
  private buffer = '';

  constructor(private readonly runId: string) {}

  push(chunk: string): DecodedCompanionOutput {
    this.buffer += chunk;
    const events: CompanionReporterEvent[] = [];
    let output = '';

    while (this.buffer.length > 0) {
      const frameStart = this.buffer.indexOf(COMPANION_REPORTER_EVENT_PREFIX);
      if (frameStart < 0) {
        const retained = partialPrefixLength(this.buffer, COMPANION_REPORTER_EVENT_PREFIX);
        output += this.buffer.slice(0, this.buffer.length - retained);
        this.buffer = this.buffer.slice(this.buffer.length - retained);
        break;
      }

      output += this.buffer.slice(0, frameStart);
      const lineEnd = this.buffer.indexOf('\n', frameStart + COMPANION_REPORTER_EVENT_PREFIX.length);
      if (lineEnd < 0) {
        this.buffer = this.buffer.slice(frameStart);
        break;
      }

      const framedLine = this.buffer.slice(frameStart, lineEnd + 1);
      const payload = this.buffer
        .slice(frameStart + COMPANION_REPORTER_EVENT_PREFIX.length, lineEnd)
        .trim();
      const event = parseReporterEvent(payload, this.runId);
      if (event) {
        events.push(event);
      } else {
        output += framedLine;
      }
      this.buffer = this.buffer.slice(lineEnd + 1);
    }

    return { events, output };
  }

  flush(): string {
    const output = this.buffer;
    this.buffer = '';
    return output;
  }
}

interface TerminalResult {
  kind: 'passed' | 'failed' | 'flaky' | 'skipped';
  rawStatus: string;
  durationMs: number;
  message?: string;
}

interface LogicalTestState {
  item: CompanionTestItem;
  plannedIds: Set<string>;
  activeAttempts: Set<string>;
  terminalResults: Map<string, TerminalResult>;
  retryFailures: Set<string>;
  durationMs: number;
  projects: Set<string>;
}

/** Reduces exact Playwright reporter lifecycle events into the persisted sidebar model. */
export class CompanionLiveRunTracker {
  private readonly initialTests: CompanionTestItem[];
  private states: LogicalTestState[] = [];
  private readonly stateByTestId = new Map<string, LogicalTestState>();
  private readonly activeAttemptState = new Map<string, LogicalTestState>();
  private readonly endedAttempts = new Set<string>();
  private plannedTotal: number | undefined;
  private lastStartedTitle: string | undefined;

  constructor(private readonly cwd: string, initialTests: readonly CompanionTestItem[] = []) {
    this.initialTests = initialTests.map((test) => ({ ...test }));
    this.states = this.initialTests.map((test) => createLogicalState(test));
  }

  apply(run: CompanionRunSummary, events: readonly CompanionReporterEvent[], durationMs: number): CompanionRunSummary {
    let changed = false;
    for (const event of events) {
      if (event.type === 'plan') {
        this.applyPlan(event);
        changed = true;
      } else if (event.type === 'testBegin') {
        changed = this.applyTestBegin(event) || changed;
      } else {
        changed = this.applyTestEnd(event) || changed;
      }
    }
    return changed ? this.materialize(run, durationMs) : run;
  }

  finish(run: CompanionRunSummary, cancelled: boolean, durationMs: number): CompanionRunSummary {
    this.activeAttemptState.clear();
    for (const state of this.states) {
      state.activeAttempts.clear();
      // Once the process exits, no pending retry can still start. Recovered
      // retries already have a terminal flaky result, so this only prevents an
      // unfinished attempt from remaining visually "running" forever.
      state.retryFailures.clear();
      if (cancelled) {
        for (const [testId, result] of state.terminalResults) {
          if (result.rawStatus === 'interrupted') {
            state.terminalResults.delete(testId);
          }
        }
      }
    }
    return this.materialize(run, durationMs);
  }

  private applyPlan(event: CompanionReporterPlanEvent): void {
    this.plannedTotal = event.total;
    this.states = [];
    this.stateByTestId.clear();
    this.activeAttemptState.clear();
    this.endedAttempts.clear();

    for (const test of event.tests) {
      let state = this.states.find((candidate) => isSameLiveTest(candidate.item, test, this.cwd));
      if (!state) {
        const initial = this.initialTests.find((candidate) => isSameLiveTest(candidate, test, this.cwd));
        state = createLogicalState(initial ?? testItemFromReporter(test, this.cwd));
        this.states.push(state);
      }
      state.plannedIds.add(test.id);
      if (test.project) {
        state.projects.add(test.project);
      }
      this.stateByTestId.set(test.id, state);
    }
  }

  private applyTestBegin(event: CompanionReporterTestBeginEvent): boolean {
    const attemptId = liveAttemptId(event.test.id, event.retry, event.workerIndex);
    if (this.endedAttempts.has(attemptId) || this.activeAttemptState.has(attemptId)) {
      return false;
    }
    const state = this.stateFor(event.test);
    state.activeAttempts.add(attemptId);
    this.activeAttemptState.set(attemptId, state);
    this.lastStartedTitle = state.item.title;
    return true;
  }

  private applyTestEnd(event: CompanionReporterTestEndEvent): boolean {
    const attemptId = liveAttemptId(event.test.id, event.retry, event.workerIndex);
    if (this.endedAttempts.has(attemptId)) {
      return false;
    }
    const state = this.activeAttemptState.get(attemptId) ?? this.stateFor(event.test);
    state.activeAttempts.delete(attemptId);
    this.activeAttemptState.delete(attemptId);
    this.endedAttempts.add(attemptId);
    state.durationMs += Math.max(0, event.durationMs);

    if (event.willRetry) {
      state.retryFailures.add(event.test.id);
      return true;
    }

    if (!state.terminalResults.has(event.test.id)) {
      state.terminalResults.set(event.test.id, terminalResult(event, state.retryFailures.has(event.test.id)));
    }
    return true;
  }

  private stateFor(test: CompanionReporterTest): LogicalTestState {
    const existing = this.stateByTestId.get(test.id)
      ?? this.states.find((candidate) => isSameLiveTest(candidate.item, test, this.cwd));
    if (existing) {
      existing.plannedIds.add(test.id);
      if (test.project) {
        existing.projects.add(test.project);
      }
      this.stateByTestId.set(test.id, existing);
      return existing;
    }

    const created = createLogicalState(testItemFromReporter(test, this.cwd));
    created.plannedIds.add(test.id);
    if (test.project) {
      created.projects.add(test.project);
    }
    this.states.push(created);
    this.stateByTestId.set(test.id, created);
    return created;
  }

  private materialize(run: CompanionRunSummary, durationMs: number): CompanionRunSummary {
    const tests = this.states.map((state) => materializeTest(state));
    const total = this.plannedTotal ?? Math.max(run.total, tests.reduce((sum, test) => sum + (test.totalRuns ?? 1), 0));
    const completedTests = tests.reduce((sum, test) => sum + (test.completedRuns ?? 0), 0);
    const activeTests = tests.reduce((sum, test) => sum + (test.activeRuns ?? 0), 0);
    const passed = tests.reduce((sum, test) => sum + (test.passedRuns ?? 0), 0);
    const failed = tests.reduce((sum, test) => sum + (test.failedRuns ?? 0), 0);
    const skipped = tests.reduce((sum, test) => sum + (test.skippedRuns ?? 0), 0);
    const flaky = tests.filter((test) => isFlakyAggregate(test)).length;
    const failures: CompanionFailure[] = [];
    for (const state of this.states) {
      for (const result of state.terminalResults.values()) {
        if (result.kind === 'failed') {
          failures.push({
            title: state.item.title,
            file: state.item.file,
            line: state.item.line,
            message: result.message,
          });
        }
      }
    }
    const activeTitle = activeTests > 0
      ? tests.find((test) => test.title === this.lastStartedTitle && (test.activeRuns ?? 0) > 0)?.title
        ?? tests.find((test) => (test.activeRuns ?? 0) > 0)?.title
      : undefined;

    return {
      ...run,
      total,
      completedTests,
      activeTests,
      passed,
      failed,
      skipped,
      flaky,
      failures,
      currentTest: activeTitle,
      durationMs: Math.max(run.durationMs, durationMs),
      tests: tests.length > 0 ? tests : undefined,
    };
  }
}

function parseReporterEvent(payload: string, runId: string): CompanionReporterEvent | undefined {
  try {
    const value = JSON.parse(payload) as unknown;
    if (!isRecord(value)
      || value.version !== COMPANION_REPORTER_EVENT_VERSION
      || value.runId !== runId
      || (value.type !== 'plan' && value.type !== 'testBegin' && value.type !== 'testEnd')) {
      return undefined;
    }
    if (value.type === 'plan') {
      if (typeof value.total !== 'number' || !Array.isArray(value.tests) || !value.tests.every(isReporterTest)) {
        return undefined;
      }
    } else if (!isReporterTest(value.test)
      || typeof value.retry !== 'number'
      || typeof value.workerIndex !== 'number') {
      return undefined;
    } else if (value.type === 'testEnd' && (
      typeof value.status !== 'string'
      || typeof value.outcome !== 'string'
      || typeof value.durationMs !== 'number'
      || typeof value.willRetry !== 'boolean'
    )) {
      return undefined;
    }
    return value as unknown as CompanionReporterEvent;
  } catch {
    return undefined;
  }
}

function isReporterTest(value: unknown): value is CompanionReporterTest {
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function partialPrefixLength(value: string, prefix: string): number {
  const maximum = Math.min(value.length, prefix.length - 1);
  for (let length = maximum; length > 0; length--) {
    if (value.endsWith(prefix.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function createLogicalState(item: CompanionTestItem): LogicalTestState {
  return {
    item: { ...item },
    plannedIds: new Set<string>(),
    activeAttempts: new Set<string>(),
    terminalResults: new Map<string, TerminalResult>(),
    retryFailures: new Set<string>(),
    durationMs: 0,
    projects: new Set<string>(),
  };
}

function testItemFromReporter(test: CompanionReporterTest, cwd: string): CompanionTestItem {
  return {
    id: test.id,
    title: test.title,
    file: normalizedReporterFile(test.file, cwd),
    line: test.line,
    project: test.project,
    status: 'pending',
  };
}

function isSameLiveTest(item: CompanionTestItem, test: CompanionReporterTest, cwd: string): boolean {
  const itemFile = normalizedReporterFile(item.file, cwd);
  const testFile = normalizedReporterFile(test.file, cwd);
  if (itemFile && testFile) {
    if (itemFile !== testFile) {
      return false;
    }
    if (item.line !== undefined && test.line !== undefined && item.line !== test.line) {
      return false;
    }
  }
  return isTitleMatch(item.title, test.title);
}

function normalizedReporterFile(file: string | undefined, cwd: string): string | undefined {
  if (!file) {
    return undefined;
  }
  return path.normalize(path.isAbsolute(file) ? file : path.resolve(cwd, file));
}

function liveAttemptId(testId: string, retry: number, workerIndex: number): string {
  return `${testId}\u0000${retry}\u0000${workerIndex}`;
}

function terminalResult(event: CompanionReporterTestEndEvent, recovered: boolean): TerminalResult {
  let kind: TerminalResult['kind'];
  if (event.status === 'skipped' || event.outcome === 'skipped') {
    kind = 'skipped';
  } else if (event.outcome === 'flaky' || recovered) {
    kind = 'flaky';
  } else if (event.outcome === 'expected' || event.status === 'passed') {
    kind = 'passed';
  } else {
    kind = 'failed';
  }
  return {
    kind,
    rawStatus: event.status,
    durationMs: Math.max(0, event.durationMs),
    message: event.error,
  };
}

function materializeTest(state: LogicalTestState): CompanionTestItem {
  const results = [...state.terminalResults.values()];
  const totalRuns = Math.max(state.plannedIds.size, results.length, state.activeAttempts.size, 1);
  const completedRuns = results.length;
  const activeRuns = state.activeAttempts.size;
  const passedRuns = results.filter((result) => result.kind === 'passed' || result.kind === 'flaky').length;
  const failedRuns = results.filter((result) => result.kind === 'failed').length;
  const skippedRuns = results.filter((result) => result.kind === 'skipped').length;
  const flakyRuns = results.filter((result) => result.kind === 'flaky').length;
  const aggregate = aggregateStatus(passedRuns, failedRuns, skippedRuns, flakyRuns);
  const retryPending = [...state.retryFailures].some((testId) => !state.terminalResults.has(testId));
  const status: CompanionTestStatus = activeRuns > 0 || retryPending
    ? 'running'
    : completedRuns < totalRuns
      ? 'pending'
      : aggregate;
  const failure = results.find((result) => result.kind === 'failed' || result.kind === 'flaky');

  return {
    ...state.item,
    project: state.projects.size === 1
      ? [...state.projects][0]
      : state.projects.size > 1
        ? undefined
        : state.item.project,
    status,
    totalRuns,
    completedRuns,
    activeRuns,
    passedRuns,
    failedRuns,
    skippedRuns,
    flakyRuns,
    durationMs: state.durationMs,
    message: failure?.message,
  };
}

function aggregateStatus(
  passedRuns: number,
  failedRuns: number,
  skippedRuns: number,
  flakyRuns: number,
): CompanionTestStatus {
  if (flakyRuns > 0 || (passedRuns > 0 && failedRuns > 0)) {
    return 'flaky';
  }
  if (failedRuns > 0) {
    return 'failed';
  }
  if (passedRuns > 0) {
    return 'passed';
  }
  return skippedRuns > 0 ? 'skipped' : 'pending';
}

function isFlakyAggregate(test: CompanionTestItem): boolean {
  return (test.flakyRuns ?? 0) > 0 || ((test.passedRuns ?? 0) > 0 && (test.failedRuns ?? 0) > 0);
}
