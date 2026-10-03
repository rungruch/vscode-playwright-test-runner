import * as assert from 'assert';
import { CompanionRunSummary, CompanionTestItem } from '../../core/companionTypes';
import { explorerResults, ExplorerResultProjector, resultDescription } from '../../core/explorerResults';
import { ExplorerTestNode } from '../../core/explorerTree';

suite('explorer run results', () => {
  const file = '/workspace/tests/generated.spec.ts';
  const node = (title: string, line = 2, targetId = 'config'): ExplorerTestNode => ({
    kind: 'test', id: `${targetId}:${title}:${line}`, label: title, targetId, children: [], projects: [], tags: [], skipped: false,
    sharedDeclaration: true, selection: { kind: 'test', targetId, file, uri: `file://${file}`,
      position: { line: line - 1, character: 0 }, titlePath: ['suite', title] },
  });
  const resultTest = (title: string, status: CompanionTestItem['status'], line = 2): CompanionTestItem => ({
    id: title, title, file, line, column: 1, titlePath: ['suite', title], status, durationMs: 50,
  });
  const run = (tests: CompanionTestItem[], overrides: Partial<CompanionRunSummary> = {}): CompanionRunSummary => ({
    id: 'run', kind: 'companion-run', targetId: 'config', cwd: '/workspace', status: 'passed', startedAt: 1, durationMs: 100,
    total: tests.length, passed: tests.length, failed: 0, skipped: 0, flaky: 0, failures: [], args: [], projects: [],
    selection: { files: [file], titleFilters: [] }, tests, ...overrides,
  });
  const group = (children: ExplorerTestNode[]): ExplorerTestNode => ({ ...node('suite'), kind: 'suite', id: 'suite', children });

  test('keeps generated cases, duplicate titles at other locations, and configs independent', () => {
    const nodes = [node('one'), node('two'), node('one', 8), node('one', 2, 'other')];
    const results = explorerResults(nodes, [run([resultTest('one', 'failed'), resultTest('two', 'passed'), resultTest('one', 'skipped', 8)])]);
    assert.deepStrictEqual(nodes.map((node) => results.get(node.id)?.status), ['failed', 'passed', 'skipped', undefined]);
  });

  test('uses the latest run per test while preserving untouched tests after a narrow rerun', () => {
    const one = node('one');
    const two = node('two');
    const results = explorerResults([group([one, two])], [
      run([resultTest('one', 'failed'), resultTest('two', 'passed')]),
      run([resultTest('one', 'running')], { id: 'rerun', startedAt: 2, status: 'running' }),
    ]);
    assert.strictEqual(results.get(one.id)?.status, 'running');
    assert.strictEqual(results.get(one.id)?.runId, 'rerun');
    assert.strictEqual(results.get(two.id)?.status, 'passed');
    assert.strictEqual(results.get('suite')?.status, 'running');
    assert.strictEqual(results.get('suite')?.active, 1);
  });

  test('aggregates parallel repetitions and distinguishes partial suite coverage', () => {
    const one = node('one');
    const two = node('two');
    const running = run([{ ...resultTest('one', 'running'), totalRuns: 10, completedRuns: 3, activeRuns: 5 }], { status: 'running' });
    const live = explorerResults([group([one, two])], [running]);
    assert.strictEqual(resultDescription(live.get(one.id)!), '3/10 completed · 5 running');
    assert.strictEqual(live.get('suite')?.testCount, 2);
    assert.strictEqual(live.get('suite')?.testedCount, 1);
    const done = explorerResults([group([one, two])], [run([{ ...resultTest('one', 'flaky'), totalRuns: 10, completedRuns: 10 }])]);
    assert.strictEqual(resultDescription(done.get('suite')!), 'Flaky · 1/2 tests · 10/10 runs · 50 ms');
  });

  test('marks interrupted work accurately while retaining completed failures and skipped tests', () => {
    const nodes = [node('one'), node('two'), node('three')];
    const tests = [resultTest('one', 'pending'), resultTest('two', 'failed'), resultTest('three', 'skipped')];
    const cancelled = explorerResults([group(nodes)], [run(tests, { status: 'cancelled' })]);
    assert.deepStrictEqual(nodes.map((node) => cancelled.get(node.id)?.status), ['cancelled', 'failed', 'skipped']);
    assert.strictEqual(cancelled.get('suite')?.status, 'failed');
    const incomplete = explorerResults(nodes, [run(tests, { status: 'incomplete' })]);
    assert.strictEqual(incomplete.get(nodes[0].id)?.status, 'incomplete');
    assert.strictEqual(explorerResults(nodes, []).size, 0, 'clearing history removes all result decorations');
  });

  test('updates cached matches with fresh live rows and run completion', () => {
    const projector = new ExplorerResultProjector();
    const one = node('one');
    const two = node('two');
    const nodes = [group([one, two])];
    const first = Object.freeze(resultTest('one', 'running'));
    const second = Object.freeze(resultTest('two', 'pending'));
    const initial = run([first, second], { status: 'running' });
    assert.strictEqual(projector.project(nodes, [initial]).get(one.id)?.status, 'running');
    const updated = { ...initial, tests: [{ ...first, titlePath: [...first.titlePath!], status: 'failed' as const,
      durationMs: 200, message: 'assertion failed' }, second] };
    const results = projector.project(nodes, [updated]);
    assert.strictEqual(results.get(one.id)?.status, 'failed');
    assert.strictEqual(results.get(one.id)?.message, 'assertion failed');
    assert.strictEqual(results.get('suite')?.durationMs, 250);
    const cancelled = projector.project(nodes, [{ ...updated, status: 'cancelled' }]);
    assert.strictEqual(cancelled.get(two.id)?.status, 'cancelled');
    assert.strictEqual(cancelled.get('suite')?.status, 'failed');
    assert.strictEqual(projector.project(nodes, []).size, 0);
    assert.strictEqual(projector.project(nodes, [run([resultTest('one', 'passed')])]).get(one.id)?.status, 'passed');
  });

  test('rebuilds cached row positions when a plan is reordered, expanded, or reduced', () => {
    const projector = new ExplorerResultProjector();
    const nodes = [node('one'), node('two'), node('three')];
    const initial = [resultTest('one', 'failed'), resultTest('two', 'passed')];
    projector.project(nodes, [run(initial)]);
    const reversed = projector.project(nodes, [run([...initial].reverse())]);
    assert.deepStrictEqual(nodes.map(node => reversed.get(node.id)?.status), ['failed', 'passed', undefined]);
    const expanded = projector.project(nodes, [run([...initial, resultTest('three', 'skipped')])]);
    assert.strictEqual(expanded.get(nodes[2].id)?.status, 'skipped', 'a previously cached miss is discarded');
    const reduced = projector.project(nodes, [run([initial[1]])]);
    assert.deepStrictEqual(nodes.map(node => reduced.get(node.id)?.status), [undefined, 'passed', undefined]);
  });

  test('invalidates cached matches for every source identity field and relative cwd', () => {
    const one = node('one');
    const original = resultTest('one', 'passed');
    for (const changed of [
      { file: '/workspace/other.spec.ts' }, { line: 9 }, { column: 7 }, { titlePath: ['other suite', 'one'] },
    ]) {
      const projector = new ExplorerResultProjector();
      assert.ok(projector.project([one], [run([original])]).has(one.id));
      assert.ok(!projector.project([one], [run([{ ...original, ...changed }])]).has(one.id));
    }
    const projector = new ExplorerResultProjector();
    const legacy = { ...original, title: 'suite › one', titlePath: undefined, file: 'tests/generated.spec.ts' };
    assert.ok(projector.project([one], [run([legacy])]).has(one.id));
    assert.ok(!projector.project([one], [run([{ ...legacy, title: 'suite › renamed' }])]).has(one.id));
    assert.ok(projector.project([one], [run([legacy])]).has(one.id));
    assert.ok(!projector.project([one], [run([legacy], { cwd: '/other' })]).has(one.id));
  });

  test('matches replacement inventory nodes instead of reusing results by node id', () => {
    const projector = new ExplorerResultProjector();
    const one = node('one');
    const summary = run([resultTest('one', 'passed')]);
    assert.ok(projector.project([one], [summary]).has(one.id));
    const moved = { ...one, selection: { ...one.selection!, position: { line: 9, character: 0 } } };
    assert.ok(!projector.project([moved], [summary]).has(one.id));
    assert.ok(projector.project([{ ...one }], [summary]).has(one.id));
  });

  test('keeps older results for cached misses and ambiguous legacy matches', () => {
    const projector = new ExplorerResultProjector();
    const one = node('one');
    one.selection!.columnMissing = true;
    const two = node('two');
    const older = run([resultTest('one', 'failed'), resultTest('two', 'passed')]
      .map(test => ({ ...test, title: test.titlePath!.join(' › ') })));
    const first = { ...resultTest('one', 'running'), title: 'suite › one' };
    const ambiguous = run([first, { ...first, column: 2 }], { id: 'newer', startedAt: 2, status: 'running' });
    for (let attempt = 0; attempt < 2; attempt++) {
      const results = projector.project([one, two], [older, ambiguous]);
      assert.strictEqual(results.get(one.id)?.runId, older.id);
      assert.strictEqual(results.get(two.id)?.runId, older.id);
    }
    const unambiguous = { ...ambiguous, tests: [{ ...first, status: 'passed' as const }] };
    const results = projector.project([one, two], [older, unambiguous]);
    assert.strictEqual(results.get(one.id)?.runId, unambiguous.id);
    assert.strictEqual(results.get(one.id)?.status, 'passed');
    assert.strictEqual(results.get(two.id)?.status, 'passed');
  });
});
