import { CompanionRunSummary, CompanionTestItem } from './companionTypes';

/** Keep one history entry while exact rerun scopes execute sequentially. */
export function combineRunBatches(
  base: CompanionRunSummary,
  completed: readonly CompanionRunSummary[],
  current: CompanionRunSummary,
  queued: readonly CompanionTestItem[],
): CompanionRunSummary {
  if (completed.length === 0 && queued.length === 0) { return { ...current, selection: base.selection, args: base.args }; }
  const batches = [...completed, current];
  const sum = (key: 'total' | 'passed' | 'failed' | 'skipped' | 'flaky') => batches.reduce((total, batch) => total + batch[key], 0);
  return { ...base, total: sum('total') + queued.length, passed: sum('passed'), failed: sum('failed'),
    skipped: sum('skipped'), flaky: sum('flaky'), failures: batches.flatMap((batch) => batch.failures),
    tests: [...batches.flatMap((batch) => batch.tests ?? []), ...queued],
    activeTests: current.activeTests, currentTest: current.currentTest,
    completedTests: batches.reduce((total, batch) => total + (batch.completedTests ?? 0), 0),
    durationMs: current.durationMs };
}
