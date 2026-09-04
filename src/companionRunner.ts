import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { extractRunningTestTitle, isTitleMatch, parseCompanionJsonReport, withParsedReport } from './core/companionReport';
import { CompanionCliRunRequest, CompanionRunSummary, CompanionTestItem } from './core/companionTypes';
import { spawnCommand } from './executor';
import { RunTarget } from './runTarget';

const LATEST_RUN_STATE_KEY = 'companion.latestRun';
const OUTPUT_TAIL_LIMIT = 24_000;

/**
 * Owns non-native execution. It intentionally never touches VS Code's
 * Testing API: Flake Lab and failed reruns are companion CLI sessions only.
 */
export class CompanionCliRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Playwright CodeLens Runner');
  private readonly emitter = new vscode.EventEmitter<CompanionRunSummary | undefined>();
  private readonly active = new Map<string, { cancel(): void }>();
  private latest: CompanionRunSummary | undefined;

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.latest = context.workspaceState.get<CompanionRunSummary>(LATEST_RUN_STATE_KEY);
  }

  get latestRun(): CompanionRunSummary | undefined {
    return this.latest;
  }

  async run(target: RunTarget, request: CompanionCliRunRequest, cancellation?: vscode.CancellationToken): Promise<CompanionRunSummary> {
    const startedAt = request.startedAt ?? Date.now();
    const id = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const initialTests = request.initialTests ?? [];
    let summary: CompanionRunSummary = {
      id,
      kind: request.kind,
      targetId: request.targetId,
      configFile: request.configFile,
      cwd: request.cwd,
      status: 'running',
      startedAt,
      durationMs: 0,
      total: initialTests.length,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: [],
      args: request.args,
      selection: request.selection,
      projects: request.projects,
      tests: initialTests.length > 0 ? initialTests.map((t) => ({ ...t })) : undefined,
    };
    await this.persist(summary);
    this.output.appendLine(`\n[${new Date(startedAt).toLocaleTimeString()}] ${request.kind} — ${target.configFile ?? target.cwd}`);
    this.output.appendLine(this.commandPreview(target, request.args));

    let tempDirectory: string | undefined;
    let collectedOutput = '';
    const append = (text: string) => {
      collectedOutput = trimOutput(`${collectedOutput}${text}`);
      this.output.append(text);
      const currentTest = extractRunningTestTitle(text);
      if (currentTest && currentTest !== summary.currentTest) {
        const updatedTests = updateRunningTests(summary.tests ?? [], currentTest);
        summary = {
          ...summary,
          currentTest,
          durationMs: Date.now() - startedAt,
          tests: updatedTests,
        };
        this.latest = summary;
        this.emitter.fire(summary);
      }
    };
    try {
      tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-codelens-run-'));
      const resultFile = path.join(tempDirectory, 'result.json');
      const running = spawnCommand(target.cli, [...request.args, '--reporter=line,json'], {
        cwd: target.cwd,
        env: {
          ...request.env,
          // Playwright's JSON reporter honours this path while stdout remains
          // a compatible fallback for older supported releases.
          PLAYWRIGHT_JSON_OUTPUT_NAME: resultFile,
        },
        cancellation,
        onStdout: append,
        onStderr: append,
      });
      this.active.set(id, running);
      const outcome = await running.outcome;
      const report = await readResult(resultFile) ?? collectedOutput;
      summary = withParsedReport(summary, parseCompanionJsonReport(report));
      if (outcome.cancelled && summary.tests) {
        summary.tests = summary.tests.map((t) => (t.status === 'running' ? { ...t, status: 'pending' as const } : t));
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
      await this.persist(summary);
      return summary;
    } catch (error) {
      summary = {
        ...summary,
        durationMs: Date.now() - startedAt,
        status: 'incomplete',
        output: `${trimOutput(collectedOutput)}${error instanceof Error ? error.message : String(error)}`,
      };
      this.output.appendLine(`Companion run could not start: ${error instanceof Error ? error.message : String(error)}`);
      await this.persist(summary);
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

  private async persist(summary: CompanionRunSummary): Promise<void> {
    this.latest = summary;
    await this.context.workspaceState.update(LATEST_RUN_STATE_KEY, summary);
    this.emitter.fire(summary);
  }

  private commandPreview(target: RunTarget, args: string[]): string {
    return [target.cli.executable, ...target.cli.argsPrefix, ...args, '--reporter=line,json'].join(' ');
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

function updateRunningTests(tests: CompanionTestItem[], runningTitle: string): CompanionTestItem[] {
  const result: CompanionTestItem[] = tests.map((t) => ({ ...t }));
  for (const t of result) {
    if (t.status === 'running') {
      t.status = 'passed';
    }
  }
  let matched = false;
  for (const t of result) {
    if (isTitleMatch(t.title, runningTitle)) {
      t.status = 'running';
      t.title = runningTitle;
      matched = true;
      break;
    }
  }
  if (!matched) {
    result.push({
      id: runningTitle,
      title: runningTitle,
      status: 'running',
    });
  }
  return result;
}
