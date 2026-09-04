import * as assert from 'assert';
import { extractRunningTestTitle, parseCompanionJsonReport } from '../../core/companionReport';

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
        { title: 'tests/example.spec.ts › recovers', status: 'passed' },
        { title: 'tests/example.spec.ts › breaks', status: 'failed' },
        { title: 'tests/example.spec.ts › skips', status: 'skipped' },
      ],
    );
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

suite('extractRunningTestTitle', () => {
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
