import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  lookupTestRunStatus,
  parseCompanionJsonReport,
  TestRunStatus,
  withParsedReport,
} from './core/companionReport';
import {
  CompanionLiveRunTracker,
  CompanionReporterEventDecoder,
  COMPANION_REPORTER_RUN_ID_ENV,
} from './core/companionLive';
import { CompanionCliRunRequest, CompanionRunSummary } from './core/companionTypes';
import { spawnCommand } from './executor';
import { RunTarget } from './runTarget';
import { Settings } from './settings';

export { TestRunStatus };

const LATEST_RUN_STATE_KEY = 'companion.latestRun';
const RUN_HISTORY_STATE_KEY = 'companion.runHistory';
const OUTPUT_TAIL_LIMIT = 24_000;
const LIVE_UPDATE_INTERVAL_MS = 100;

export interface CompanionTestsChange {
  runId?: string;
  targetId?: string;
  files?: readonly string[];
}

/**
 * Owns non-native execution. It intentionally never touches VS Code's
 * Testing API: Flake Lab and failed reruns are companion CLI sessions only.
 */
export class CompanionCliRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Playwright CodeLens Runner');
  private readonly emitter = new vscode.EventEmitter<CompanionRunSummary | undefined>();
  private readonly testsEmitter = new vscode.EventEmitter<CompanionTestsChange>();
  private persistence: Promise<void> = Promise.resolve();
  private readonly liveTimers = new Set<NodeJS.Timeout>();
  private disposed = false;
  private readonly active = new Map<string, { cancel(): void }>();
  private readonly reporterPath: string;
  private latest: CompanionRunSummary | undefined;
  private history: CompanionRunSummary[] = [];

  readonly onDidChange = this.emitter.event;
  readonly onDidChangeTests = this.testsEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.reporterPath = context.asAbsolutePath(path.join('dist', 'companionReporter.cjs'));
    this.latest = context.workspaceState.get<CompanionRunSummary>(LATEST_RUN_STATE_KEY);
    const saved = context.workspaceState.get<CompanionRunSummary[]>(RUN_HISTORY_STATE_KEY);
    this.history = (Array.isArray(saved) ? saved : (this.latest ? [this.latest] : []))
      .sort((a, b) => b.startedAt - a.startedAt).map((run) => run.status === 'running' ? {
        ...run, status: 'incomplete', activeTests: 0, currentTest: undefined,
        tests: run.tests?.map((test) => test.status === 'running' ? { ...test, status: 'pending', activeRuns: 0 } : test),
      } : run);
    this.latest = this.history[0];
  }

  get latestRun(): CompanionRunSummary | undefined {
    return this.latest;
  }

  get runs(): readonly CompanionRunSummary[] {
    return this.history;
  }

  get hasActiveRun(): boolean {
    return this.active.size > 0;
  }

  testStatusFor(
    file: string,
    line: number,
    titlePath?: string[],
    targetId?: string,
    column?: number,
    titlePaths?: string[][],
  ): TestRunStatus | undefined {
    const run = targetId ? this.history.find((run) => run.targetId === targetId) : this.latest;
    return lookupTestRunStatus(run, Boolean(run && this.active.has(run.id)), file, line, titlePath, column, titlePaths);
  }

  async clearRuns(): Promise<void> {
    this.history = this.history.filter((run) => this.active.has(run.id));
    this.latest = this.history[0];
    this.emitter.fire(this.latest);
    this.testsEmitter.fire({});
    await this.persistState();
  }

  async run(target: RunTarget, request: CompanionCliRunRequest, cancellation?: vscode.CancellationToken): Promise<CompanionRunSummary> {
    if (this.disposed) {
      throw new Error('Companion runner has been disposed.');
    }
    const settings = new Settings(target.configFile ? vscode.Uri.file(target.configFile) : undefined);
    const startedAt = request.startedAt ?? Date.now();
    const id = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const initialTests = request.initialTests ?? [];
    const repeatEach = request.repeatEach ?? 1;
    const initialTotal = request.kind === 'flake-lab' && repeatEach > 1
      ? Math.max(initialTests.length * repeatEach, initialTests.length)
      : initialTests.length;
    let summary: CompanionRunSummary = {
      id,
      kind: request.kind,
      targetId: request.targetId,
      configFile: request.configFile,
      cwd: request.cwd,
      status: 'running',
      startedAt,
      durationMs: 0,
      total: initialTotal,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: [],
      args: request.args,
      selection: request.selection,
      projects: request.projects,
      tests: initialTests.length > 0 ? initialTests.map((t) => ({
        ...t,
        totalRuns: request.kind === 'flake-lab' ? repeatEach : 1,
        completedRuns: 0,
        activeRuns: 0,
        passedRuns: 0,
        failedRuns: 0,
        skippedRuns: 0,
        flakyRuns: 0,
      })) : undefined,
      completedTests: 0,
      activeTests: 0,
      repeatEach: request.repeatEach,
    };
    const source = new vscode.CancellationTokenSource();
    const cancellationListener = cancellation?.onCancellationRequested(() => source.cancel());
    if (cancellation?.isCancellationRequested) {
      source.cancel();
    }
    this.active.set(id, { cancel: () => source.cancel() });
    // Publish synchronously; storage is serialized separately from process startup.
    void this.persist(summary, settings.sidebarHistorySize);
    if (settings.companionShowCliOutput === 'on-run') {
      this.showOutput();
    }
    this.output.appendLine(`\n[${new Date(startedAt).toLocaleTimeString()}] ${request.kind} — ${target.configFile ?? target.cwd}`);
    this.output.appendLine(this.commandPreview(target, request.args));

    let tempDirectory: string | undefined;
    let collectedOutput = '';
    const decoder = new CompanionReporterEventDecoder(id);
    const liveTracker = new CompanionLiveRunTracker(target.cwd, summary.tests);
    const appendVisible = (text: string) => {
      if (!text || this.disposed) {
        return;
      }
      collectedOutput = trimOutput(`${collectedOutput}${text}`);
      this.output.append(text);
    };
    const publishLive = (next: CompanionRunSummary) => {
      if (next === summary) {
        return;
      }
      summary = next;
      this.updateSummary(summary, settings.sidebarHistorySize);
      this.publish(summary);
    };
    let liveTimer: NodeJS.Timeout | undefined;
    const clearLiveTimer = () => {
      if (liveTimer) {
        clearTimeout(liveTimer);
        this.liveTimers.delete(liveTimer);
        liveTimer = undefined;
      }
    };
    const scheduleLive = () => {
      if (liveTimer || this.disposed) {
        return;
      }
      liveTimer = setTimeout(() => {
        clearLiveTimer();
        publishLive(liveTracker.snapshot(summary, Date.now() - startedAt));
      }, LIVE_UPDATE_INTERVAL_MS);
      this.liveTimers.add(liveTimer);
    };
    const appendStdout = (text: string) => {
      const decoded = decoder.push(text);
      appendVisible(decoded.output);
      if (decoded.events.length > 0) {
        if (liveTracker.ingest(decoded.events)) {
          scheduleLive();
        }
      }
    };
    try {
      if (source.token.isCancellationRequested || this.disposed) {
        summary = { ...summary, status: 'cancelled' };
        this.active.delete(id);
        await this.persist(summary, settings.sidebarHistorySize);
        return summary;
      }
      tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-codelens-run-'));
      if (source.token.isCancellationRequested || this.disposed) {
        summary = { ...summary, status: 'cancelled' };
        this.active.delete(id);
        await this.persist(summary, settings.sidebarHistorySize);
        return summary;
      }
      const resultFile = path.join(tempDirectory, 'result.json');
      const running = spawnCommand(target.cli, [...request.args, `--reporter=line,json,${this.reporterPath}`], {
        cwd: target.cwd,
        env: {
          ...request.env,
          // Playwright's JSON reporter honours this path while stdout remains
          // a compatible fallback for older supported releases.
          PLAYWRIGHT_JSON_OUTPUT_NAME: resultFile,
          [COMPANION_REPORTER_RUN_ID_ENV]: id,
        },
        cancellation: source.token,
        onStdout: appendStdout,
        onStderr: appendVisible,
      });
      const outcome = await running.outcome;
      clearLiveTimer();
      appendVisible(decoder.flush());
      summary = liveTracker.finish(summary, outcome.cancelled, Date.now() - startedAt);
      const report = await readResult(resultFile) ?? collectedOutput;
      if (!outcome.cancelled) {
        summary = withParsedReport(summary, parseCompanionJsonReport(report));
      }
      summary = {
        ...summary,
        durationMs: Math.max(summary.durationMs, Date.now() - startedAt),
        status: outcome.cancelled
          ? 'cancelled'
          : outcome.exitCode === 0
            ? 'passed'
            : summary.total > 0
              ? 'failed'
              : 'incomplete',
        output: trimOutput(collectedOutput),
      };
      if (!this.disposed) {
        this.output.appendLine(`Companion run ${summary.status}: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.flaky} flaky.`);
      }
      if (!this.disposed && settings.companionShowCliOutput === 'on-failure' && (summary.status === 'failed' || summary.status === 'incomplete')) {
        this.showOutput();
      }
      this.active.delete(id);
      await this.persist(summary, settings.sidebarHistorySize);
      return summary;
    } catch (error) {
      clearLiveTimer();
      summary = liveTracker.finish(summary, source.token.isCancellationRequested, Date.now() - startedAt);
      summary = {
        ...summary,
        durationMs: Date.now() - startedAt,
        status: source.token.isCancellationRequested ? 'cancelled' : 'incomplete',
        output: `${trimOutput(collectedOutput)}${error instanceof Error ? error.message : String(error)}`,
      };
      if (!this.disposed) {
        this.output.appendLine(`Companion run could not start: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!this.disposed && settings.companionShowCliOutput === 'on-failure') {
        this.showOutput();
      }
      this.active.delete(id);
      await this.persist(summary, settings.sidebarHistorySize);
      return summary;
    } finally {
      clearLiveTimer();
      cancellationListener?.dispose();
      source.dispose();
      this.active.delete(id);
      if (tempDirectory) {
        await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  cancel(runId?: string): void {
    if (runId) {
      this.active.get(runId)?.cancel();
      return;
    }
    for (const running of this.active.values()) {
      running.cancel();
    }
  }

  showOutput(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    for (const timer of this.liveTimers) {
      clearTimeout(timer);
    }
    this.liveTimers.clear();
    this.testsEmitter.dispose();
    this.output.dispose();
    this.emitter.dispose();
  }

  private updateSummary(summary: CompanionRunSummary, maxHistory: number): void {
    const existingIndex = this.history.findIndex((run) => run.id === summary.id);
    const updated = existingIndex < 0 ? [summary, ...this.history] : this.history.map((run) => run.id === summary.id ? summary : run);
    let completed = 0;
    this.history = updated.sort((a, b) => b.startedAt - a.startedAt).filter((run) => (
      this.active.has(run.id) || ++completed <= Math.max(1, maxHistory)
    ));
    this.latest = this.history[0];
  }

  private publish(summary: CompanionRunSummary): void {
    if (this.disposed) {
      return;
    }
    this.emitter.fire(summary);
    this.testsEmitter.fire({
      runId: summary.id,
      targetId: summary.targetId,
      files: [...new Set([...(summary.tests ?? []).flatMap((test) => test.file ? [test.file] : []), ...summary.selection.files])],
    });
  }

  private persist(summary: CompanionRunSummary, maxHistory: number = 3): Promise<void> {
    this.updateSummary(summary, maxHistory);
    this.publish(summary);
    return this.persistState();
  }

  private persistState(): Promise<void> {
    const latest = this.latest;
    const history = [...this.history];
    this.persistence = this.persistence.catch(() => undefined).then(async () => {
      await this.context.workspaceState.update(LATEST_RUN_STATE_KEY, latest);
      await this.context.workspaceState.update(RUN_HISTORY_STATE_KEY, history);
    }).catch((error: unknown) => {
      if (!this.disposed) {
        this.output.appendLine(`Could not save companion history: ${String(error)}`);
      }
    });
    return this.persistence;
  }

  private commandPreview(target: RunTarget, args: string[]): string {
    return [target.cli.executable, ...target.cli.argsPrefix, ...args, `--reporter=line,json,${this.reporterPath}`].join(' ');
  }
}

async function readResult(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

function trimOutput(value: string): string {
  return value.length > OUTPUT_TAIL_LIMIT ? value.slice(-OUTPUT_TAIL_LIMIT) : value;
}
