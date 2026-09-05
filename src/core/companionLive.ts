import * as path from 'path';
import { SourceTestIndex } from './testIdentity';
import { terminalTestStatus } from './testOutcome';
import { CompanionFailure, CompanionRunSummary, CompanionTestItem, CompanionTestStatus } from './companionTypes';

export const COMPANION_REPORTER_EVENT_PREFIX = '\u001ePLAYWRIGHT_CODELENS_EVENT:';
export const COMPANION_REPORTER_EVENT_VERSION = 1;
export const COMPANION_REPORTER_RUN_ID_ENV = 'PLAYWRIGHT_CODELENS_RUN_ID';

export interface CompanionReporterTest {
  id: string;
  title: string;
  file?: string;
  line?: number;
  column?: number;
  titlePath?: string[];
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
  retryFailures: Map<string, TerminalResult>;
  durationMs: number;
  projects: Set<string>;
  counts: Record<TerminalResult['kind'], number>;
  failureResults: Map<string, TerminalResult>;
  cached?: CompanionTestItem;
}

/** Reduces exact Playwright reporter lifecycle events into the persisted sidebar model. */
export class CompanionLiveRunTracker {
  private readonly initialIndex: SourceTestIndex<CompanionTestItem>;
  private sourceIndex: SourceTestIndex<LogicalTestState>;
  private dirty = false;
  private states: LogicalTestState[] = [];
  private readonly stateByTestId = new Map<string, LogicalTestState>();
  private readonly activeAttemptState = new Map<string, LogicalTestState>();
  private readonly endedAttempts = new Set<string>();
  private plannedTotal: number | undefined;
  private lastStartedTitle: string | undefined;

  constructor(private readonly cwd: string, initialTests: readonly CompanionTestItem[] = []) {
    this.initialIndex = new SourceTestIndex((test) => test, cwd);
    initialTests.forEach((test) => this.initialIndex.add(test));
    this.states = initialTests.map((test) => createLogicalState(test));
    this.sourceIndex = new SourceTestIndex((state) => state.item, cwd);
    this.states.forEach((state) => this.sourceIndex.add(state));
  }

  apply(run: CompanionRunSummary, events: readonly CompanionReporterEvent[], durationMs: number): CompanionRunSummary {
    this.ingest(events);
    return this.snapshot(run, durationMs);
  }

  ingest(events: readonly CompanionReporterEvent[]): boolean {
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
    this.dirty ||= changed;
    return changed;
  }

  snapshot(run: CompanionRunSummary, durationMs: number): CompanionRunSummary {
    if (!this.dirty) {
      return run;
    }
    this.dirty = false;
    return this.materialize(run, durationMs);
  }

  finish(run: CompanionRunSummary, cancelled: boolean, durationMs: number): CompanionRunSummary {
    this.activeAttemptState.clear();
    for (const state of this.states) {
      state.cached = undefined;
      state.activeAttempts.clear();
      if (cancelled || state.retryFailures.size > 0) {
        for (const [testId, result] of state.terminalResults) {
          if (result.rawStatus === 'interrupted') {
            state.terminalResults.delete(testId);
            state.counts[result.kind]--;
            state.failureResults.delete(testId);
          }
        }
      }
      // A stopped process cannot recover its last failed attempt with a retry.
      for (const [testId, result] of state.retryFailures) {
        if (!state.terminalResults.has(testId)) {
          state.terminalResults.set(testId, result);
          state.counts[result.kind]++;
          state.failureResults.set(testId, result);
        }
      }
      state.retryFailures.clear();
    }
    this.dirty = false;
    return this.materialize(run, durationMs);
  }

  private applyPlan(event: CompanionReporterPlanEvent): void {
    this.plannedTotal = event.total;
    this.states = [];
    this.sourceIndex = new SourceTestIndex((state) => state.item, this.cwd);
    this.stateByTestId.clear();
    this.activeAttemptState.clear();
    this.endedAttempts.clear();

    for (const test of event.tests) {
      let state = this.sourceIndex.find(test);
      if (!state) {
        const initial = this.initialIndex.find(test);
        state = createLogicalState({ ...initial, ...testItemFromReporter(test, this.cwd), id: initial?.id ?? test.id });
        this.states.push(state);
        this.sourceIndex.add(state);
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
    state.cached = undefined;
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
    state.cached = undefined;
    state.activeAttempts.delete(attemptId);
    this.activeAttemptState.delete(attemptId);
    this.endedAttempts.add(attemptId);
    state.durationMs += Math.max(0, event.durationMs);

    if (event.willRetry) {
      if (event.status !== 'interrupted') {
        state.retryFailures.set(event.test.id, terminalResult(event, false));
      }
      return true;
    }

    if (!state.terminalResults.has(event.test.id)) {
      const result = terminalResult(event, state.retryFailures.has(event.test.id));
      state.terminalResults.set(event.test.id, result);
      state.counts[result.kind]++;
      if (result.kind === 'failed' || result.kind === 'flaky') {
        state.failureResults.set(event.test.id, result);
      }
    }
    if (event.status !== 'interrupted') {
      state.retryFailures.delete(event.test.id);
    }
    return true;
  }

  private stateFor(test: CompanionReporterTest): LogicalTestState {
    const existing = this.stateByTestId.get(test.id)
      ?? this.sourceIndex.find(test);
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
    this.sourceIndex.add(created);
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
      for (const result of state.failureResults.values()) {
        if (result.kind === 'failed') {
          failures.push({
            title: state.item.title,
            file: state.item.file,
            line: state.item.line,
            column: state.item.column,
            titlePath: state.item.titlePath,
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
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && (value.file === undefined || typeof value.file === 'string')
    && (value.line === undefined || typeof value.line === 'number')
    && (value.column === undefined || typeof value.column === 'number')
    && (value.titlePath === undefined || (Array.isArray(value.titlePath) && value.titlePath.every((part) => typeof part === 'string')));
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
    retryFailures: new Map<string, TerminalResult>(),
    durationMs: 0,
    projects: new Set<string>(),
    counts: { passed: 0, failed: 0, skipped: 0, flaky: 0 },
    failureResults: new Map(),
  };
}

function testItemFromReporter(test: CompanionReporterTest, cwd: string): CompanionTestItem {
  return {
    id: test.id,
    title: test.title,
    file: normalizedReporterFile(test.file, cwd),
    line: test.line,
    column: test.column,
    titlePath: test.titlePath,
    project: test.project,
    status: 'pending',
  };
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
  const kind = terminalTestStatus(event.outcome, event.status, recovered) as TerminalResult['kind'];
  return {
    kind,
    rawStatus: event.status,
    durationMs: Math.max(0, event.durationMs),
    message: event.error,
  };
}

function materializeTest(state: LogicalTestState): CompanionTestItem {
  if (state.cached) {
    return state.cached;
  }
  const completedRuns = state.terminalResults.size;
  const totalRuns = Math.max(state.plannedIds.size, completedRuns, state.activeAttempts.size, 1);
  const activeRuns = state.activeAttempts.size;
  const passedRuns = state.counts.passed + state.counts.flaky;
  const failedRuns = state.counts.failed;
  const skippedRuns = state.counts.skipped;
  const flakyRuns = state.counts.flaky;
  const aggregate = aggregateStatus(passedRuns, failedRuns, skippedRuns, flakyRuns);
  const retryPending = state.retryFailures.size > 0;
  const status: CompanionTestStatus = activeRuns > 0 || retryPending
    ? 'running'
    : completedRuns < totalRuns
      ? 'pending'
      : aggregate;
  const failure = state.failureResults.values().next().value;

  state.cached = {
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
  return state.cached;
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
