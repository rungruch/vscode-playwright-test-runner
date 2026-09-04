import * as assert from 'assert';
import {
  extractRunningProgress,
  extractRunningTestTitle,
  isTitleMatch,
  lookupTestRunStatus,
  parseCompanionJsonReport,
  withParsedReport,
} from '../../core/companionReport';
import { CompanionRunSummary } from '../../core/companionTypes';

suite('companionReport', () => {
  test('parses totals, failures, duration, and recovered flaky tests', () => {
    const parsed = parseCompanionJsonReport(JSON.stringify({
      suites: [{
        title: 'tests/example.spec.ts',
        file: '/ws/tests/example.spec.ts',
        specs: [
          { title: 'stable', line: 5, tests: [{ results: [{ status: 'passed', duration: 12 }] }] },
          {
            title: 'recovers',
            line: 9,
            tests: [{ results: [
              { status: 'failed', duration: 3, error: { message: 'first failure' } },
              { status: 'passed', duration: 7 },
            ] }],
          },
          {
            title: 'breaks',
            line: 14,
            tests: [{ results: [{ status: 'failed', duration: 8, error: { message: 'expected true' } }] }],
          },
          { title: 'skips', line: 18, tests: [{ results: [{ status: 'skipped', duration: 0 }] }] },
        ],
      }],
    }));
    assert.ok(parsed);
    assert.deepStrictEqual(
      { total: parsed.total, passed: parsed.passed, failed: parsed.failed, skipped: parsed.skipped, flaky: parsed.flaky, durationMs: parsed.durationMs },
      { total: 4, passed: 2, failed: 1, skipped: 1, flaky: 1, durationMs: 30 },
    );
    assert.strictEqual(parsed.failures[0].file, '/ws/tests/example.spec.ts');
    assert.strictEqual(parsed.failures[0].line, 14);
    assert.match(parsed.failures[0].message ?? '', /expected true/);
    assert.strictEqual(parsed.tests.length, 4);
    assert.deepStrictEqual(
      parsed.tests.map((t) => ({ title: t.title, status: t.status })),
      [
        { title: 'tests/example.spec.ts › stable', status: 'passed' },
        { title: 'tests/example.spec.ts › recovers', status: 'flaky' },
        { title: 'tests/example.spec.ts › breaks', status: 'failed' },
        { title: 'tests/example.spec.ts › skips', status: 'skipped' },
      ],
    );
  });

  test('parses top-level stats and global errors from Playwright JSON report', () => {
    const parsed = parseCompanionJsonReport(JSON.stringify({
      stats: {
        expected: 5,
        unexpected: 1,
        flaky: 2,
        skipped: 1,
        duration: 1250,
      },
      errors: [
        { message: 'Global teardown failed' },
      ],
      suites: [{
        title: 'suite.spec.ts',
        specs: [
          {
            title: 'direct flaky',
            tests: [{
              status: 'flaky',
              results: [
                { status: 'failed', duration: 10 },
                { status: 'passed', duration: 15 },
              ],
            }],
          },
        ],
      }],
    }));
    assert.ok(parsed);
    assert.strictEqual(parsed.flaky, 2);
    assert.strictEqual(parsed.durationMs, 1250);
    assert.strictEqual(parsed.failures.length, 1);
    assert.strictEqual(parsed.failures[0].message, 'Global teardown failed');
    assert.strictEqual(parsed.tests[0].status, 'flaky');
  });

  test('tolerates malformed or incomplete output', () => {
    assert.strictEqual(parseCompanionJsonReport('not json'), undefined);
    assert.deepStrictEqual(parseCompanionJsonReport('{"suites":[]}'), {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      durationMs: 0,
      failures: [],
      tests: [],
    });
  });
});

suite('extractRunningProgress and extractRunningTestTitle', () => {
  test('extracts progress, project, location and title from line reporter format', () => {
    const line = '[1/5] [browserless] › tests/example.spec.ts:4:7 › Math › adds numbers';
    const progress = extractRunningProgress(line);
    assert.ok(progress);
    assert.strictEqual(progress.index, 1);
    assert.strictEqual(progress.total, 5);
    assert.strictEqual(progress.project, 'browserless');
    assert.strictEqual(progress.file, 'tests/example.spec.ts');
    assert.strictEqual(progress.line, 4);
    assert.strictEqual(progress.column, 7);
    assert.strictEqual(progress.title, 'Math › adds numbers');
    assert.strictEqual(extractRunningTestTitle(line), 'Math › adds numbers');
  });

  test('extracts total announced tests from header', () => {
    const line = 'Running 25 tests using 4 workers';
    const progress = extractRunningProgress(line);
    assert.ok(progress);
    assert.strictEqual(progress.totalAnnounced, 25);
  });

  test('extracts title from line reporter format with location prefix', () => {
    const line = '[chromium] › tests/calendar_single.spec.ts:37:9 › Verify Single Calendar UI › Verify Popover Calendar Container @calendar';
    const title = extractRunningTestTitle(line);
    assert.strictEqual(title, 'Verify Single Calendar UI › Verify Popover Calendar Container @calendar');
  });

  test('extracts title from multi-line terminal chunk', () => {
    const chunk = [
      'Running 20 tests using 1 worker',
      '[chromium] › tests/calendar_single.spec.ts:10:5 › Suite A › Test One',
      '[chromium] › tests/calendar_single.spec.ts:54:9 › Verify Single Calendar UI › Verify Popover Navigation Button',
    ].join('\n');
    const title = extractRunningTestTitle(chunk);
    assert.strictEqual(title, 'Verify Single Calendar UI › Verify Popover Navigation Button');
  });

  test('returns undefined for non-line-reporter text', () => {
    assert.strictEqual(extractRunningTestTitle('Starting Playwright CLI...'), undefined);
    assert.strictEqual(extractRunningTestTitle(''), undefined);
  });
});

suite('lookupTestRunStatus', () => {
  const runningSummary: CompanionRunSummary = {
    id: 'run-1',
    kind: 'companion-run',
    targetId: 't1',
    cwd: '/ws',
    status: 'running',
    startedAt: 1000,
    durationMs: 100,
    total: 2,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    failures: [],
    args: [],
    selection: { files: [], titleFilters: [] },
    projects: [],
    currentTest: 'authentication › logs in',
    tests: [
      { id: '1', title: 'authentication › logs in', file: '/ws/tests/auth.spec.ts', line: 10, status: 'running' },
    ],
  };

  const finishedSummary: CompanionRunSummary = {
    id: 'run-2',
    kind: 'companion-run',
    targetId: 't1',
    cwd: '/ws',
    status: 'failed',
    startedAt: 1000,
    durationMs: 500,
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    flaky: 0,
    failures: [
      { title: 'breaks', file: '/ws/tests/example.spec.ts', line: 25, message: 'assert error', titlePath: ['auth', 'breaks'] },
    ],
    args: [],
    selection: { files: [], titleFilters: [] },
    projects: [],
    tests: [
      { id: '1', title: 'auth › works', file: '/ws/tests/example.spec.ts', line: 15, status: 'passed', durationMs: 42 },
      { id: '2', title: 'auth › breaks', file: '/ws/tests/example.spec.ts', line: 25, status: 'failed', durationMs: 95 },
    ],
  };

  test('returns running status when a matching test is executing', () => {
    const status = lookupTestRunStatus(runningSummary, true, '/ws/tests/auth.spec.ts', 9, ['authentication', 'logs in']);
    assert.deepStrictEqual(status, { status: 'running' });
  });

  test('returns undefined when no matching test is executing in active run', () => {
    const status = lookupTestRunStatus(runningSummary, true, '/ws/tests/auth.spec.ts', 20, ['authentication', 'other']);
    assert.strictEqual(status, undefined);
  });

  test('returns passed status with duration from latest finished run', () => {
    const status = lookupTestRunStatus(finishedSummary, false, '/ws/tests/example.spec.ts', 14, ['auth', 'works']);
    assert.deepStrictEqual(status, { status: 'passed', durationMs: 42 });
  });

  test('returns failed status with failure record from latest finished run', () => {
    const status = lookupTestRunStatus(finishedSummary, false, '/ws/tests/example.spec.ts', 24, ['auth', 'breaks']);
    assert.strictEqual(status?.status, 'failed');
    assert.strictEqual(status?.failure?.message, 'assert error');
  });

  test('returns flaky status with duration from latest finished run', () => {
    const flakySummary: CompanionRunSummary = {
      ...finishedSummary,
      id: 'run-3',
      flaky: 1,
      tests: [
        { id: '1', title: 'auth › flaky test', file: '/ws/tests/example.spec.ts', line: 30, status: 'flaky', durationMs: 88 },
      ],
    };
    const status = lookupTestRunStatus(flakySummary, false, '/ws/tests/example.spec.ts', 29, ['auth', 'flaky test']);
    assert.deepStrictEqual(status, { status: 'flaky', durationMs: 88 });
  });

  test('returns undefined for undefined summary or unrelated file', () => {
    assert.strictEqual(lookupTestRunStatus(undefined, false, '/ws/tests/auth.spec.ts', 10), undefined);
    assert.strictEqual(lookupTestRunStatus(finishedSummary, false, '/ws/tests/other.spec.ts', 10), undefined);
  });
});

suite('withParsedReport', () => {
  test('aggregates repeat-each Flake Lab repetitions into a single test with flaky status', () => {
    const initialRun: CompanionRunSummary = {
      id: 'flake-1',
      kind: 'flake-lab',
      targetId: 't1',
      cwd: '/ws',
      status: 'running',
      startedAt: 1000,
      durationMs: 0,
      total: 5,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: [],
      args: [],
      selection: { files: ['/ws/tests/example.spec.ts'], titleFilters: [] },
      projects: [],
      repeatEach: 5,
      tests: [
        { id: 'tests/example.spec.ts:4:Math › adds numbers', title: 'Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'pending' },
      ],
    };

    const parsedReport = {
      total: 5,
      passed: 4,
      failed: 1,
      skipped: 0,
      flaky: 0,
      durationMs: 120,
      failures: [
        { title: 'Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, message: 'timeout' },
      ],
      tests: [
        { id: '1', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'passed' as const, durationMs: 20 },
        { id: '2', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'passed' as const, durationMs: 25 },
        { id: '3', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'failed' as const, durationMs: 30, message: 'timeout' },
        { id: '4', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'passed' as const, durationMs: 22 },
        { id: '5', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'passed' as const, durationMs: 23 },
      ],
    };

    const updated = withParsedReport(initialRun, parsedReport);
    assert.strictEqual(updated.total, 5);
    assert.strictEqual(updated.passed, 4);
    assert.strictEqual(updated.failed, 1);
    assert.strictEqual(updated.flaky, 1, 'Overall run detects 1 flaky test');
    assert.strictEqual(updated.tests?.length, 1, 'Aggregates to 1 test item');
    const test = updated.tests?.[0];
    assert.ok(test);
    assert.strictEqual(test.status, 'flaky');
    assert.strictEqual(test.totalRuns, 5);
    assert.strictEqual(test.passedRuns, 4);
    assert.strictEqual(test.failedRuns, 1);
    assert.strictEqual(test.durationMs, 120);
    assert.strictEqual(test.message, 'timeout');
  });

  test('aggregates all passed repeat-each repetitions cleanly', () => {
    const initialRun: CompanionRunSummary = {
      id: 'flake-2',
      kind: 'flake-lab',
      targetId: 't1',
      cwd: '/ws',
      status: 'running',
      startedAt: 1000,
      durationMs: 0,
      total: 3,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: [],
      args: [],
      selection: { files: ['/ws/tests/example.spec.ts'], titleFilters: [] },
      projects: [],
      repeatEach: 3,
    };

    const parsedReport = {
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
      flaky: 0,
      durationMs: 60,
      failures: [],
      tests: [
        { id: '1', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'passed' as const, durationMs: 20 },
        { id: '2', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'passed' as const, durationMs: 20 },
        { id: '3', title: 'tests/example.spec.ts › Math › adds numbers', file: '/ws/tests/example.spec.ts', line: 4, status: 'passed' as const, durationMs: 20 },
      ],
    };

    const updated = withParsedReport(initialRun, parsedReport);
    assert.strictEqual(updated.flaky, 0);
    assert.strictEqual(updated.tests?.[0].status, 'passed');
    assert.strictEqual(updated.tests?.[0].totalRuns, 3);
    assert.strictEqual(updated.tests?.[0].passedRuns, 3);
  });
});

suite('isTitleMatch', () => {
  test('matches identical and tag-stripped titles', () => {
    assert.strictEqual(isTitleMatch('Suite › test @smoke', 'Suite › test'), true);
    assert.strictEqual(isTitleMatch('example.spec.ts › Math › adds', 'Math › adds'), true);
  });

  test('does not cross-match a nested test with a top-level test of the same name', () => {
    assert.strictEqual(isTitleMatch('example.spec.ts › duplicate title', 'example.spec.ts › dup › duplicate title'), false);
    assert.strictEqual(isTitleMatch('duplicate title', 'dup › duplicate title'), false);
  });
});

