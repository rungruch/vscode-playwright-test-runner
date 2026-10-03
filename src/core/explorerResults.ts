import { CompanionRunSummary, CompanionTestItem, CompanionTestStatus } from './companionTypes';
import { ExplorerNode, ExplorerTestNode } from './explorerTree';
import { SourceTestIndex } from './testIdentity';

export interface ExplorerResult {
  status: CompanionTestStatus | 'cancelled' | 'incomplete';
  durationMs: number;
  completed: number;
  total: number;
  active: number;
  testCount: number;
  testedCount: number;
  message?: string;
  runId?: string;
}

interface RunLookup {
  cwd: string;
  tests: readonly CompanionTestItem[];
  index: SourceTestIndex<number>;
  matches: WeakMap<ExplorerTestNode, number>;
}

const STATUS_PRIORITY: Record<ExplorerResult['status'], number> = {
  running: 0, failed: 1, flaky: 2, pending: 3, cancelled: 4, incomplete: 5, passed: 6, skipped: 7,
};

/**
 * Reuses source matching across immutable runner snapshots. Status-only updates
 * replace the rows, while changes to source identity/order rebuild their index.
 */
export class ExplorerResultProjector {
  private readonly lookups = new Map<string, RunLookup>();

  project(nodes: readonly ExplorerNode[], runs: readonly CompanionRunSummary[]): Map<string, ExplorerResult> {
    const retained = new Set(runs.map((run) => run.id));
    for (const id of this.lookups.keys()) {
      if (!retained.has(id)) { this.lookups.delete(id); }
    }
    const results = new Map<string, ExplorerResult>();
    if (!runs.length || !nodes.length) { return results; }
    const indexes = new Map<string, { run: CompanionRunSummary; lookup?: RunLookup }[]>();
    for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
      const entries = indexes.get(run.targetId) ?? [];
      entries.push({ run });
      indexes.set(run.targetId, entries);
    }
    const visit = (node: ExplorerNode): { result?: ExplorerResult; count: number } => {
      if (node.kind === 'test') {
        const selection = node.selection;
        if (selection) {
          for (const entry of indexes.get(node.targetId) ?? []) {
            const { run } = entry;
            const lookup = entry.lookup ??= this.lookupFor(run);
            let row = lookup.matches.get(node);
            if (row === undefined) {
              row = lookup.index.find({ file: selection.file, line: selection.position.line + 1,
                column: selection.columnMissing ? undefined : selection.position.character + 1,
                titlePath: selection.titlePath, title: selection.titlePath?.join(' › ') ?? node.label }) ?? -1;
              lookup.matches.set(node, row);
            }
            if (row < 0) { continue; }
            const test = lookup.tests[row];
            const unfinished = test.status === 'pending' || test.status === 'running';
            const result: ExplorerResult = {
              status: unfinished && run.status !== 'running' ? (run.status === 'cancelled' ? 'cancelled' : 'incomplete') : test.status,
              durationMs: test.durationMs ?? 0,
              completed: test.completedRuns ?? (unfinished ? 0 : 1), total: test.totalRuns ?? 1,
              active: run.status === 'running' ? test.activeRuns ?? (test.status === 'running' ? 1 : 0) : 0,
              testCount: 1, testedCount: 1, message: test.message, runId: run.id,
            };
            results.set(node.id, result);
            return { result, count: 1 };
          }
        }
        return { count: 1 };
      }
      let count = 0;
      let result: ExplorerResult | undefined;
      for (const child of node.children) {
        const visited = visit(child);
        count += visited.count;
        if (!visited.result) { continue; }
        const found = visited.result;
        if (!result) {
          result = { status: found.status, durationMs: 0, completed: 0, total: 0, active: 0, testCount: 0, testedCount: 0 };
        }
        if (STATUS_PRIORITY[found.status] < STATUS_PRIORITY[result.status]) { result.status = found.status; }
        result.durationMs += found.durationMs;
        result.completed += found.completed;
        result.total += found.total;
        result.active += found.active;
        result.testedCount += found.testedCount;
      }
      if (result) {
        result.testCount = count;
        results.set(node.id, result);
      }
      return { result, count };
    };
    nodes.forEach(visit);
    return results;
  }

  private lookupFor(run: CompanionRunSummary): RunLookup {
    const tests = run.tests ?? [];
    const previous = this.lookups.get(run.id);
    if (previous && previous.cwd === run.cwd && (previous.tests === tests
      || previous.tests.length === tests.length && tests.every((test, row) => sameSource(test, previous.tests[row])))) {
      previous.tests = tests;
      return previous;
    }
    const lookup: RunLookup = {
      cwd: run.cwd, tests, matches: new WeakMap(),
      index: new SourceTestIndex<number>((row) => lookup.tests[row], run.cwd),
    };
    tests.forEach((_test, row) => lookup.index.add(row));
    this.lookups.set(run.id, lookup);
    return lookup;
  }
}

function sameSource(a: CompanionTestItem, b: CompanionTestItem): boolean {
  return a === b || a.file === b.file && a.line === b.line && a.column === b.column && a.title === b.title
    && (a.titlePath === b.titlePath || a.titlePath !== undefined && b.titlePath !== undefined
      && a.titlePath.length === b.titlePath.length && a.titlePath.every((title, index) => title === b.titlePath![index]));
}

/** One-off projection; the live explorer retains its own projector between updates. */
export function explorerResults(nodes: readonly ExplorerNode[], runs: readonly CompanionRunSummary[]): Map<string, ExplorerResult> {
  return new ExplorerResultProjector().project(nodes, runs);
}

export function resultDescription(result: ExplorerResult): string {
  const status = result.status[0].toUpperCase() + result.status.slice(1);
  if (result.status === 'running' || result.status === 'pending') {
    return `${result.completed}/${result.total} completed · ${result.active ? `${result.active} running` : status}`;
  }
  const duration = result.durationMs < 1000 ? `${result.durationMs} ms` : `${(result.durationMs / 1000).toFixed(1)} s`;
  const coverage = result.testCount > 1 ? ` · ${result.testedCount}/${result.testCount} tests` : '';
  const repeats = result.total > result.testedCount ? ` · ${result.completed}/${result.total} runs` : '';
  return `${status}${coverage}${repeats} · ${duration}`;
}
