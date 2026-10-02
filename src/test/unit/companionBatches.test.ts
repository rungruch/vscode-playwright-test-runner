import * as assert from 'assert';
import { combineRunBatches } from '../../core/companionBatches';
import { CompanionRunSummary } from '../../core/companionTypes';

suite('exact rerun batches', () => {
  test('retains earlier failures, current progress, and queued tests in one run', () => {
    const base: CompanionRunSummary = { id: 'one-run', kind: 'rerun-failed', targetId: 'target', cwd: '/ws',
      startedAt: 1, status: 'running', durationMs: 0, total: 3, passed: 0, failed: 0, skipped: 0, flaky: 0,
      failures: [], args: ['test', 'all'], selection: { files: ['/ws/a.spec.ts'], titleFilters: [] }, projects: [] };
    const failed = { ...base, total: 1, failed: 1, completedTests: 1,
      failures: [{ title: 'first' }], tests: [{ id: 'first', title: 'first', status: 'failed' as const }] };
    const current = { ...base, total: 1, activeTests: 1, currentTest: 'second',
      tests: [{ id: 'second', title: 'second', status: 'running' as const }] };
    const queued = [{ id: 'third', title: 'third', status: 'pending' as const }];
    const run = combineRunBatches(base, [failed], current, queued);
    assert.strictEqual(run.id, base.id);
    assert.strictEqual(run.total, 3);
    assert.strictEqual(run.failed, 1);
    assert.strictEqual(run.activeTests, 1);
    assert.strictEqual(run.completedTests, 1);
    assert.deepStrictEqual(run.tests?.map((test) => test.status), ['failed', 'running', 'pending']);
    assert.deepStrictEqual(run.failures, [{ title: 'first' }]);
    assert.deepStrictEqual(run.args, base.args);
  });
});
