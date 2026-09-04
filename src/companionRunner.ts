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

/**
 * Owns non-native execution. It intentionally never touches VS Code's
 * Testing API: Flake Lab and failed reruns are companion CLI sessions only.
 */
export class CompanionCliRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Playwright CodeLens Runner');
  private readonly emitter = new vscode.EventEmitter<CompanionRunSummary | undefined>();
  private readonly active = new Map<string, { cancel(): void }>();
  private readonly reporterPath: string;
  private latest: CompanionRunSummary | undefined;
  private history: CompanionRunSummary[] = [];

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.reporterPath = context.asAbsolutePath(path.join('dist', 'companionReporter.cjs'));
    this.latest = context.workspaceState.get<CompanionRunSummary>(LATEST_RUN_STATE_KEY);
    const saved = context.workspaceState.get<CompanionRunSummary[]>(RUN_HISTORY_STATE_KEY);
    this.history = Array.isArray(saved) ? saved : (this.latest ? [this.latest] : []);
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
  ): TestRunStatus | undefined {
    return lookupTestRunStatus(this.latest, this.hasActiveRun, file, line, titlePath);
  }

  async clearRuns(): Promise<void> {
    this.latest = undefined;
    this.history = [];
    await this.context.workspaceState.update(LATEST_RUN_STATE_KEY, undefined);
    await this.context.workspaceState.update(RUN_HISTORY_STATE_KEY, undefined);
    this.emitter.fire(undefined);
  }

  async run(target: RunTarget, request: CompanionCliRunRequest, cancellation?: vscode.CancellationToken): Promise<CompanionRunSummary> {
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
    await this.persist(summary, settings.sidebarHistorySize);
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
      if (!text) {
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
      this.latest = summary;
      const existingIdx = this.history.findIndex((run) => run.id === summary.id);
      if (existingIdx >= 0) {
        this.history[existingIdx] = summary;
      } else {
        this.history = [summary, ...this.history];
      }
      this.emitter.fire(summary);
    };
    const appendStdout = (text: string) => {
      const decoded = decoder.push(text);
      appendVisible(decoded.output);
      if (decoded.events.length > 0) {
        publishLive(liveTracker.apply(summary, decoded.events, Date.now() - startedAt));
      }
    };
    try {
      tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-codelens-run-'));
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
        cancellation,
        onStdout: appendStdout,
        onStderr: appendVisible,
      });
      this.active.set(id, running);
      const outcome = await running.outcome;
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
      this.output.appendLine(`Companion run ${summary.status}: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.flaky} flaky.`);
      if (settings.companionShowCliOutput === 'on-failure' && (summary.status === 'failed' || summary.status === 'incomplete')) {
        this.showOutput();
      }
      await this.persist(summary, settings.sidebarHistorySize);
      return summary;
    } catch (error) {
      summary = liveTracker.finish(summary, false, Date.now() - startedAt);
      summary = {
        ...summary,
        durationMs: Date.now() - startedAt,
        status: 'incomplete',
        output: `${trimOutput(collectedOutput)}${error instanceof Error ? error.message : String(error)}`,
      };
      this.output.appendLine(`Companion run could not start: ${error instanceof Error ? error.message : String(error)}`);
      if (settings.companionShowCliOutput === 'on-failure') {
        this.showOutput();
      }
      await this.persist(summary, settings.sidebarHistorySize);
      return summary;
    } finally {
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
    this.cancel();
    this.output.dispose();
    this.emitter.dispose();
  }

  private async persist(summary: CompanionRunSummary, maxHistory: number = 3): Promise<void> {
    this.latest = summary;
    const existingIndex = this.history.findIndex((r) => r.id === summary.id);
    if (existingIndex >= 0) {
      this.history[existingIndex] = summary;
    } else {
      this.history = [summary, ...this.history.filter((r) => r.id !== summary.id)].slice(0, Math.max(1, maxHistory));
    }
    await this.context.workspaceState.update(LATEST_RUN_STATE_KEY, summary);
    await this.context.workspaceState.update(RUN_HISTORY_STATE_KEY, this.history);
    this.emitter.fire(summary);
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
