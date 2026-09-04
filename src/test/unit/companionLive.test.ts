import * as assert from 'assert';
import {
  CompanionLiveRunTracker,
  CompanionReporterEvent,
  CompanionReporterEventDecoder,
  CompanionReporterPlanEvent,
  CompanionReporterTest,
  CompanionReporterTestBeginEvent,
  CompanionReporterTestEndEvent,
  COMPANION_REPORTER_EVENT_PREFIX,
  COMPANION_REPORTER_EVENT_VERSION,
} from '../../core/companionLive';
import { CompanionRunSummary } from '../../core/companionTypes';

const RUN_ID = 'live-run';

suite('companion live reporter events', () => {
  test('decodes partial and multiple frames while preserving ordinary output', () => {
    const decoder = new CompanionReporterEventDecoder(RUN_ID);
    const testCase = reporterTest('test-1', 1);
    const firstEvent = beginEvent(testCase, 0);
    const secondEvent = endEvent(testCase, 'passed', 'expected');
    const firstFrame = frame(firstEvent);
    const splitAt = COMPANION_REPORTER_EVENT_PREFIX.length - 5;

    const first = decoder.push(`before\n${firstFrame.slice(0, splitAt)}`);
    assert.strictEqual(first.output, 'before\n');
    assert.deepStrictEqual(first.events, []);

    const wrongRunFrame = frame({ ...secondEvent, runId: 'another-run' });
    const malformedFrame = `${COMPANION_REPORTER_EVENT_PREFIX}{not-json}\n`;
    const second = decoder.push(`${firstFrame.slice(splitAt)}${frame(secondEvent)}${wrongRunFrame}${malformedFrame}after\n`);
    assert.deepStrictEqual(second.events, [firstEvent, secondEvent]);
    assert.strictEqual(second.output, `${wrongRunFrame}${malformedFrame}after\n`);
    assert.strictEqual(decoder.flush(), '');
  });

  test('tracks five workers without marking another running test passed', () => {
    const tests = Array.from({ length: 10 }, (_, index) => reporterTest(`test-${index + 1}`, index + 1));
    const tracker = new CompanionLiveRunTracker('/workspace');
    let summary = tracker.apply(runSummary(10), [planEvent(tests)], 10);
    summary = tracker.apply(summary, tests.slice(0, 5).map((test, worker) => beginEvent(test, worker)), 20);

    assert.strictEqual(summary.activeTests, 5);
    assert.strictEqual(summary.completedTests, 0);
    assert.strictEqual(summary.passed, 0);
    assert.strictEqual(summary.tests?.filter((test) => test.status === 'running').length, 5);

    summary = tracker.apply(summary, [endEvent(tests[1], 'passed', 'expected', 1)], 30);
    assert.strictEqual(summary.activeTests, 4);
    assert.strictEqual(summary.completedTests, 1);
    assert.strictEqual(summary.passed, 1);
    assert.strictEqual(summary.tests?.find((test) => test.line === 1)?.status, 'running');
    assert.strictEqual(summary.tests?.find((test) => test.line === 2)?.status, 'passed');

    summary = tracker.apply(summary, [beginEvent(tests[5], 1)], 40);
    assert.strictEqual(summary.activeTests, 5);
    assert.strictEqual(summary.completedTests, 1);
  });

  test('aggregates concurrent Flake Lab repetitions and mixed outcomes', () => {
    const tests = Array.from({ length: 10 }, (_, index) => ({
      ...reporterTest(`repeat-${index}`, 5, 'repeated test'),
      repeatEachIndex: index,
    }));
    const tracker = new CompanionLiveRunTracker('/workspace');
    let summary = tracker.apply(runSummary(10, 'flake-lab'), [planEvent(tests)], 10);
    summary = tracker.apply(summary, tests.slice(0, 5).map((test, worker) => beginEvent(test, worker)), 20);
    summary = tracker.apply(summary, [endEvent(tests[0], 'passed', 'expected')], 30);
    summary = tracker.apply(summary, [beginEvent(tests[5], 0)], 40);

    assert.strictEqual(summary.tests?.length, 1);
    assert.strictEqual(summary.tests?.[0].totalRuns, 10);
    assert.strictEqual(summary.tests?.[0].completedRuns, 1);
    assert.strictEqual(summary.tests?.[0].activeRuns, 5);
    assert.strictEqual(summary.tests?.[0].status, 'running');

    const remainingEvents: CompanionReporterEvent[] = [];
    for (let index = 1; index < 10; index++) {
      if (index >= 6) {
        remainingEvents.push(beginEvent(tests[index], index % 5));
      }
      remainingEvents.push(index >= 8
        ? endEvent(tests[index], 'failed', 'unexpected', index % 5)
        : endEvent(tests[index], 'passed', 'expected', index % 5));
    }
    summary = tracker.apply(summary, remainingEvents, 100);

    assert.strictEqual(summary.activeTests, 0);
    assert.strictEqual(summary.completedTests, 10);
    assert.strictEqual(summary.passed, 8);
    assert.strictEqual(summary.failed, 2);
    assert.strictEqual(summary.flaky, 1);
    assert.strictEqual(summary.tests?.[0].status, 'flaky');
    assert.strictEqual(summary.tests?.[0].passedRuns, 8);
    assert.strictEqual(summary.tests?.[0].failedRuns, 2);
  });

  test('publishes passed, failed, and skipped terminal results while another worker remains active', () => {
    const tests = Array.from({ length: 4 }, (_, index) => reporterTest(`terminal-${index}`, index + 1));
    const tracker = new CompanionLiveRunTracker('/workspace');
    let summary = tracker.apply(runSummary(4), [
      planEvent(tests),
      ...tests.map((test, worker) => beginEvent(test, worker)),
    ], 10);
    summary = tracker.apply(summary, [
      endEvent(tests[0], 'passed', 'expected', 0),
      endEvent(tests[1], 'failed', 'unexpected', 1),
      endEvent(tests[2], 'skipped', 'skipped', 2),
    ], 20);

    assert.strictEqual(summary.completedTests, 3);
    assert.strictEqual(summary.activeTests, 1);
    assert.strictEqual(summary.passed, 1);
    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.skipped, 1);
    assert.deepStrictEqual(summary.tests?.map((test) => test.status), ['passed', 'failed', 'skipped', 'running']);
  });

  test('classifies uniform Flake Lab repetitions as passed, failed, or skipped', () => {
    const cases = [
      { status: 'passed', outcome: 'expected', expected: 'passed', passed: 10, failed: 0, skipped: 0 },
      { status: 'failed', outcome: 'unexpected', expected: 'failed', passed: 0, failed: 10, skipped: 0 },
      { status: 'skipped', outcome: 'skipped', expected: 'skipped', passed: 0, failed: 0, skipped: 10 },
    ];

    for (const scenario of cases) {
      const tests = Array.from({ length: 10 }, (_, index) => ({
        ...reporterTest(`${scenario.status}-${index}`, 12, 'uniform test'),
        repeatEachIndex: index,
      }));
      const tracker = new CompanionLiveRunTracker('/workspace');
      let summary = tracker.apply(runSummary(10, 'flake-lab'), [planEvent(tests)], 10);
      summary = tracker.apply(summary, tests.map((test, worker) => beginEvent(test, worker % 5)), 20);
      summary = tracker.apply(summary, tests.map((test, worker) => (
        endEvent(test, scenario.status, scenario.outcome, worker % 5)
      )), 30);

      assert.strictEqual(summary.tests?.[0].status, scenario.expected);
      assert.strictEqual(summary.tests?.[0].passedRuns, scenario.passed);
      assert.strictEqual(summary.tests?.[0].failedRuns, scenario.failed);
      assert.strictEqual(summary.tests?.[0].skippedRuns, scenario.skipped);
      assert.strictEqual(summary.tests?.[0].completedRuns, 10);
    }
  });

  test('does not complete a retrying failure and marks a recovered retry flaky', () => {
    const testCase = { ...reporterTest('retry-test', 8), retries: 1 };
    const tracker = new CompanionLiveRunTracker('/workspace');
    let summary = tracker.apply(runSummary(1), [planEvent([testCase]), beginEvent(testCase, 0)], 10);
    summary = tracker.apply(summary, [endEvent(testCase, 'failed', 'unexpected', 0, true)], 20);

    assert.strictEqual(summary.completedTests, 0);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(summary.tests?.[0].status, 'running');
    assert.strictEqual(summary.tests?.[0].activeRuns, 0);

    summary = tracker.apply(summary, [beginEvent(testCase, 0, 1)], 30);
    assert.strictEqual(summary.tests?.[0].status, 'running');
    summary = tracker.apply(summary, [endEvent(testCase, 'passed', 'flaky', 0, false, 1)], 40);

    assert.strictEqual(summary.completedTests, 1);
    assert.strictEqual(summary.passed, 1);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(summary.flaky, 1);
    assert.strictEqual(summary.tests?.[0].status, 'flaky');
    assert.strictEqual(summary.tests?.[0].flakyRuns, 1);
  });

  test('keeps completed results but clears interrupted work on cancellation', () => {
    const tests = [reporterTest('done', 1), { ...reporterTest('interrupted', 2), retries: 1 }];
    const tracker = new CompanionLiveRunTracker('/workspace');
    let summary = tracker.apply(runSummary(2), [planEvent(tests), ...tests.map((test, worker) => beginEvent(test, worker))], 10);
    summary = tracker.apply(summary, [
      endEvent(tests[0], 'passed', 'expected'),
      endEvent(tests[1], 'interrupted', 'unexpected', 1, true),
    ], 20);
    summary = tracker.finish(summary, true, 30);

    assert.strictEqual(summary.activeTests, 0);
    assert.strictEqual(summary.completedTests, 1);
    assert.strictEqual(summary.passed, 1);
    assert.strictEqual(summary.failed, 0);
    assert.strictEqual(summary.tests?.find((test) => test.line === 1)?.status, 'passed');
    assert.strictEqual(summary.tests?.find((test) => test.line === 2)?.status, 'pending');
  });
});

function reporterTest(id: string, line: number, title: string = `test ${line}`): CompanionReporterTest {
  return {
    id,
    title,
    file: '/workspace/tests/example.spec.ts',
    line,
    project: 'chromium',
    retries: 0,
  };
}

function planEvent(tests: CompanionReporterTest[]): CompanionReporterPlanEvent {
  return {
    version: COMPANION_REPORTER_EVENT_VERSION,
    runId: RUN_ID,
    type: 'plan',
    total: tests.length,
    tests,
  };
}

function beginEvent(test: CompanionReporterTest, workerIndex: number, retry: number = 0): CompanionReporterTestBeginEvent {
  return {
    version: COMPANION_REPORTER_EVENT_VERSION,
    runId: RUN_ID,
    type: 'testBegin',
    test,
    retry,
    workerIndex,
  };
}

function endEvent(
  test: CompanionReporterTest,
  status: string,
  outcome: string,
  workerIndex: number = 0,
  willRetry: boolean = false,
  retry: number = 0,
): CompanionReporterTestEndEvent {
  return {
    version: COMPANION_REPORTER_EVENT_VERSION,
    runId: RUN_ID,
    type: 'testEnd',
    test,
    retry,
    workerIndex,
    status,
    outcome,
    durationMs: 5,
    ...(status === 'passed' ? {} : { error: 'failure' }),
    willRetry,
  };
}

function frame(event: CompanionReporterEvent): string {
  return `${COMPANION_REPORTER_EVENT_PREFIX}${JSON.stringify(event)}\n`;
}

function runSummary(total: number, kind: CompanionRunSummary['kind'] = 'companion-run'): CompanionRunSummary {
  return {
    id: RUN_ID,
    kind,
    targetId: 'target',
    cwd: '/workspace',
    status: 'running',
    startedAt: 1,
    durationMs: 0,
    total,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    failures: [],
    args: [],
    selection: { files: [], titleFilters: [] },
    projects: [],
    completedTests: 0,
    activeTests: 0,
  };
}
