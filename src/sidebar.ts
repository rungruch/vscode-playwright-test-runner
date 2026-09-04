import * as path from 'path';
import * as vscode from 'vscode';
import { ArtifactService } from './artifactService';
import { CompanionCliRunner } from './companionRunner';
import { ArtifactRecord, CompanionFailure, CompanionRunSummary, CompanionTestItem } from './core/companionTypes';
import { InteractiveSession, InteractiveSessionManager } from './interactiveSessions';
import { ReportSession, ReportSessionManager } from './reportSession';
import { RunTarget } from './runTarget';

type RunElement =
  | { type: 'run'; run: CompanionRunSummary; isLatest?: boolean }
  | { type: 'historyGroup'; runs: readonly CompanionRunSummary[] }
  | { type: 'testCase'; test: CompanionTestItem }
  | { type: 'failure'; failure: CompanionFailure }
  | { type: 'session'; session: InteractiveSession }
  | { type: 'reportSession'; session: ReportSession }
  | { type: 'action'; label: string; command: string; icon: string; args?: unknown[] };

/** Tree providers for the companion-only run summary and local artifacts. */
export class PlaywrightSidebar implements vscode.Disposable {
  private readonly runEmitter = new vscode.EventEmitter<RunElement | undefined>();
  private readonly artifactEmitter = new vscode.EventEmitter<ArtifactRecord | undefined>();
  private readonly disposables: vscode.Disposable[];

  constructor(
    context: vscode.ExtensionContext,
    private readonly runner: CompanionCliRunner,
    private readonly artifacts: ArtifactService,
    private readonly sessions: InteractiveSessionManager,
    private readonly reportSession: ReportSessionManager,
  ) {
    this.disposables = [
      this.runEmitter,
      this.artifactEmitter,
      vscode.window.registerTreeDataProvider('playwrightCodeLensRunner.runsView', {
        onDidChangeTreeData: this.runEmitter.event,
        getTreeItem: (element) => this.runTreeItem(element),
        getChildren: (element) => this.runChildren(element),
      }),
      vscode.window.registerTreeDataProvider('playwrightCodeLensRunner.artifactsView', {
        onDidChangeTreeData: this.artifactEmitter.event,
        getTreeItem: (element) => this.artifactTreeItem(element),
        getChildren: () => [...this.artifacts.artifacts],
      }),
      this.runner.onDidChange(() => this.runEmitter.fire(undefined)),
      this.sessions.onDidChange(() => this.runEmitter.fire(undefined)),
      this.reportSession.onDidChange(() => {
        this.runEmitter.fire(undefined);
        this.artifactEmitter.fire(undefined);
      }),
      this.artifacts.onDidChange(() => this.artifactEmitter.fire(undefined)),
    ];
    context.subscriptions.push(this);
  }

  async refreshArtifacts(targets: readonly RunTarget[]): Promise<void> {
    await this.artifacts.scan(targets);
  }

  refreshRuns(): void {
    this.runEmitter.fire(undefined);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private runChildren(element?: RunElement): RunElement[] {
    if (!element) {
      const runs = this.runner.runs;
      const report = this.reportSession.currentSession;
      const reportItems: RunElement[] = report ? [{ type: 'reportSession', session: report }] : [];
      const sessionItems: RunElement[] = this.sessions.sessions.map((session) => ({ type: 'session' as const, session }));
      const reportActions: RunElement[] = report
        ? [
            { type: 'action', label: 'Restart Report Server', command: 'playwrightCodeLensRunner.restartReportServer', icon: 'refresh' },
            { type: 'action', label: 'Stop Report Server', command: 'playwrightCodeLensRunner.stopReportServer', icon: 'stop' },
          ]
        : [{ type: 'action', label: 'Open Browser Report', command: 'playwrightCodeLensRunner.openLatestReport', icon: 'globe' }];

      if (runs.length === 0) {
        return [
          ...sessionItems,
          ...reportItems,
          { type: 'action', label: 'No companion CLI runs yet', command: 'playwrightCodeLensRunner.openMicrosoftTesting', icon: 'beaker' },
          ...reportActions,
          { type: 'action', label: 'Open UI Profile…', command: 'playwrightCodeLensRunner.openUiProfile', icon: 'remote' },
          { type: 'action', label: 'Show Companion Output', command: 'playwrightCodeLensRunner.showCompanionOutput', icon: 'output' },
        ];
      }
      const latest = runs[0];
      const previousRuns = runs.slice(1);
      const items: RunElement[] = [
        { type: 'run', run: latest, isLatest: true },
      ];
      if (previousRuns.length > 0) {
        items.push({ type: 'historyGroup', runs: previousRuns });
      }
      items.push(
        ...sessionItems,
        ...reportItems,
        ...reportActions,
        { type: 'action', label: 'Open UI Profile…', command: 'playwrightCodeLensRunner.openUiProfile', icon: 'remote' },
        { type: 'action', label: 'Open Microsoft Testing', command: 'playwrightCodeLensRunner.openMicrosoftTesting', icon: 'beaker' },
        { type: 'action', label: 'Show Companion Output', command: 'playwrightCodeLensRunner.showCompanionOutput', icon: 'output' },
      );
      return items;
    }
    if (element.type === 'historyGroup') {
      return element.runs.map((run) => ({ type: 'run' as const, run, isLatest: false }));
    }
    if (element.type === 'run') {
      const run = element.run;
      const totals: RunElement[] = [];
      const isRunning = run.status === 'running';
      let totalsLabel: string;
      if (isRunning) {
        const completed = run.completedTests ?? 0;
        const progressPart = run.total > 0 ? `${completed}/${run.total} completed` : 'running';
        const statsParts: string[] = [progressPart];
        if (run.passed > 0) {
          statsParts.push(`${run.passed} passed`);
        }
        if (run.failed > 0) {
          statsParts.push(`${run.failed} failed`);
        }
        if (run.flaky > 0) {
          statsParts.push(`${run.flaky} flaky`);
        }
        totalsLabel = statsParts.join(' · ');
      } else {
        const parts = [
          `${run.total} total`,
          `${run.passed} passed`,
          `${run.failed} failed`,
          `${run.skipped} skipped`,
        ];
        if (run.flaky > 0) {
          parts.push(`${run.flaky} flaky`);
        }
        totalsLabel = parts.join(' · ');
      }

      let totalsIcon = 'pass';
      if (isRunning) {
        totalsIcon = 'sync~spin';
      } else if (run.status === 'cancelled') {
        totalsIcon = 'circle-slash';
      } else if (run.failed > 0 || run.status === 'failed') {
        totalsIcon = 'error';
      } else if (run.flaky > 0) {
        totalsIcon = 'warning';
      }

      totals.push({
        type: 'action',
        label: totalsLabel,
        command: 'playwrightCodeLensRunner.openRunsView',
        icon: totalsIcon,
      });
      totals.push({
        type: 'action',
        label: 'View CLI Output',
        command: 'playwrightCodeLensRunner.showCompanionOutput',
        icon: 'output',
      });
      if (run.tests && run.tests.length > 0) {
        totals.push(...run.tests.map((test) => ({ type: 'testCase' as const, test })));
      } else if (run.failures.length > 0) {
        totals.push(...run.failures.map((failure) => ({ type: 'failure' as const, failure })));
      }
      if (run.failed > 0) {
        totals.push({ type: 'action', label: 'Rerun Failed', command: 'playwrightCodeLensRunner.rerunFailedCli', icon: 'refresh' });
      }
      if (run.status === 'running') {
        totals.push({ type: 'action', label: 'Cancel Run', command: 'playwrightCodeLensRunner.cancelCompanionRun', icon: 'stop' });
      }
      return totals;
    }
    return [];
  }

  private runTreeItem(element: RunElement): vscode.TreeItem {
    if (element.type === 'historyGroup') {
      const item = new vscode.TreeItem(`Previous Runs (${element.runs.length})`, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('history');
      item.contextValue = 'playwrightRunHistoryGroup';
      return item;
    }
    if (element.type === 'run') {
      const run = element.run;
      const repeatEach = run.repeatEach;
      const repeatLabel = run.kind === 'flake-lab' && repeatEach && repeatEach > 1 ? ` (${repeatEach}x)` : '';
      const kindLabel = run.kind === 'flake-lab' ? 'Flake Lab' : run.kind === 'companion-run' ? 'Companion run' : 'failed-test rerun';
      const targetFile = run.selection?.files?.[0];
      const fileBasename = targetFile ? ` (${path.basename(targetFile)})` : '';
      const isExpanded = Boolean(element.isLatest !== false && ((run.tests && run.tests.length > 0) || run.failures.length > 0 || run.status === 'running'));
      const prefix = element.isLatest === false ? 'Run' : 'Latest';
      const item = new vscode.TreeItem(
        `${prefix} ${kindLabel}${repeatLabel}${fileBasename}`,
        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );

      if (run.status === 'running') {
        const completed = run.completedTests ?? 0;
        const currentIdx = completed + 1;
        const totalStr = run.total > 0 ? ` [${Math.min(currentIdx, run.total)}/${run.total}]` : '';
        const runSuffix = run.kind === 'flake-lab' && repeatEach && repeatEach > 1
          ? ` (run ${Math.min(currentIdx, run.total)}/${run.total})`
          : '';
        const testName = run.currentTest ? ` · ${run.currentTest}` : '';
        item.description = `running${totalStr}${runSuffix}${testName}`;
      } else if (run.status === 'passed') {
        item.description = run.flaky > 0
          ? `flaky (${run.flaky} flaky) · ${formatDuration(run.durationMs)}`
          : `passed · ${formatDuration(run.durationMs)}`;
      } else if (run.status === 'failed') {
        item.description = run.flaky > 0
          ? `failed (${run.flaky} flaky) · ${formatDuration(run.durationMs)}`
          : `failed · ${formatDuration(run.durationMs)}`;
      } else if (run.status === 'cancelled') {
        item.description = `cancelled · ${formatDuration(run.durationMs)}`;
      } else {
        item.description = `${run.status} · ${formatDuration(run.durationMs)}`;
      }

      const startedStr = new Date(run.startedAt).toLocaleTimeString();
      const statusBadge = run.status === 'running'
        ? '⏳ Running'
        : run.status === 'passed' && run.flaky > 0
          ? '⚠️ Passed with Flakes'
          : run.status === 'passed'
            ? '✅ Passed'
            : run.status === 'cancelled'
              ? '🚫 Cancelled'
              : '❌ Failed';

      item.tooltip = new vscode.MarkdownString(
        `### Playwright ${kindLabel}${repeatLabel}\n\n` +
        `- **Status**: ${statusBadge}\n` +
        `- **Started**: ${startedStr}\n` +
        `- **Duration**: ${formatDuration(run.durationMs)}\n` +
        `- **Passed**: ${run.passed} / ${run.total}\n` +
        `- **Failed**: ${run.failed}\n` +
        `- **Flaky**: ${run.flaky}\n` +
        `- **Skipped**: ${run.skipped}\n` +
        (run.currentTest && run.status === 'running' ? `- **Active Test**: \`${run.currentTest}\`\n` : '') +
        (run.configFile ? `- **Config**: \`${path.basename(run.configFile)}\`\n` : '') +
        (run.projects && run.projects.length > 0 ? `- **Projects**: ${run.projects.join(', ')}\n` : ''),
      );

      if (run.status === 'running') {
        item.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
      } else if (run.status === 'passed') {
        item.iconPath = run.flaky > 0
          ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'))
          : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      } else if (run.status === 'cancelled') {
        item.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconSkipped'));
      } else {
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      }

      item.contextValue = run.status === 'running' ? 'playwrightCompanionRun.running' : 'playwrightCompanionRun';
      return item;
    }
    if (element.type === 'testCase') {
      const test = element.test;
      const item = new vscode.TreeItem(test.title, vscode.TreeItemCollapsibleState.None);
      if (test.status === 'running') {
        item.description = test.totalRuns && test.totalRuns > 1
          ? `running (${(test.passedRuns ?? 0) + (test.failedRuns ?? 0) + 1}/${test.totalRuns})`
          : 'running';
      } else if (test.status === 'flaky') {
        item.description = test.totalRuns && test.totalRuns > 1
          ? `flaky · ${test.passedRuns ?? 0}/${test.totalRuns} passed`
          : 'flaky';
      } else if (test.totalRuns && test.totalRuns > 1) {
        item.description = `${test.passedRuns}/${test.totalRuns} passed · ${formatDuration(test.durationMs ?? 0)}`;
      } else if (test.durationMs !== undefined && test.durationMs > 0) {
        item.description = formatDuration(test.durationMs);
      } else {
        item.description = test.status;
      }

      if (test.status === 'running') {
        item.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
      } else if (test.status === 'passed') {
        item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      } else if (test.status === 'flaky') {
        item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
      } else if (test.status === 'failed') {
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      } else if (test.status === 'skipped') {
        item.iconPath = new vscode.ThemeIcon('dash', new vscode.ThemeColor('testing.iconSkipped'));
      } else {
        item.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconUnset'));
      }

      if (test.file) {
        item.command = {
          command: 'vscode.open',
          title: 'Open test',
          arguments: [
            vscode.Uri.file(test.file),
            { selection: new vscode.Range(Math.max(0, (test.line ?? 1) - 1), 0, Math.max(0, (test.line ?? 1) - 1), 0) },
          ],
        };
      }

      const runsInfo = test.totalRuns && test.totalRuns > 1
        ? `- **Iterations**: ${test.passedRuns ?? 0} passed, ${test.failedRuns ?? 0} failed (of ${test.totalRuns})\n`
        : '';
      item.tooltip = new vscode.MarkdownString(
        `**${test.title}**\n\n` +
        `- **Status**: ${test.status}\n` +
        runsInfo +
        (test.durationMs ? `- **Duration**: ${formatDuration(test.durationMs)}\n` : '') +
        (test.project ? `- **Project**: ${test.project}\n` : '') +
        (test.file ? `- **Location**: \`${path.basename(test.file)}:${test.line ?? 1}\`\n` : '') +
        (test.message ? `\n\`\`\`\n${test.message}\n\`\`\`` : ''),
      );
      item.contextValue = 'playwrightCompanionTestCase';
      return item;
    }
    if (element.type === 'failure') {
      const failure = element.failure;
      const item = new vscode.TreeItem(failure.title, vscode.TreeItemCollapsibleState.None);
      item.description = failure.file ? `${path.basename(failure.file)}:${failure.line ?? 1}` : 'Failure';
      item.tooltip = new vscode.MarkdownString(
        `**Failure**: ${failure.title}\n\n` +
        (failure.file ? `**Location**: \`${failure.file}:${failure.line ?? 1}\`\n\n` : '') +
        (failure.message ? `\`\`\`\n${failure.message}\n\`\`\`` : ''),
      );
      item.command = failure.file ? {
        command: 'playwrightCodeLensRunner.openFailure',
        title: 'Open failure',
        arguments: [failure],
      } : undefined;
      item.iconPath = new vscode.ThemeIcon('error');
      item.contextValue = 'playwrightCompanionFailure';
      return item;
    }
    if (element.type === 'reportSession') {
      const reportPath = element.session.reportPath;
      const reportLabel = reportPath ? `Active: Report (${path.basename(reportPath)})` : 'Active: Playwright Report';
      const item = new vscode.TreeItem(reportLabel, vscode.TreeItemCollapsibleState.None);
      item.description = 'serving';
      item.tooltip = new vscode.MarkdownString(
        `**Playwright Report Server (Active)**\n\n` +
        `- **Target**: \`${element.session.target.configFile ?? element.session.target.cwd}\`\n` +
        (reportPath ? `- **Report**: \`${reportPath}\`\n` : '') +
        `- **Started**: ${new Date(element.session.startedAt).toLocaleTimeString()}\n\n` +
        `Use $(refresh) to restart or $(stop) to cancel the report server CLI.`,
      );
      item.iconPath = new vscode.ThemeIcon('globe');
      item.contextValue = 'playwrightCompanionReportSession';
      return item;
    }
    if (element.type === 'session') {
      const item = new vscode.TreeItem(`Active: ${element.session.name}`, vscode.TreeItemCollapsibleState.None);
      item.description = 'Companion CLI session';
      item.tooltip = new vscode.MarkdownString(
        `**Interactive CLI Session (Active)**\n\n` +
        `- **Name**: ${element.session.name}\n` +
        `- **Started**: ${new Date(element.session.startedAt).toLocaleTimeString()}\n\n` +
        `Use $(stop) to cancel this session.`,
      );
      item.iconPath = new vscode.ThemeIcon('terminal');
      item.contextValue = 'playwrightCompanionInteractiveSession';
      return item;
    }
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.command = { command: element.command, title: element.label, arguments: element.args };
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.contextValue = 'playwrightCompanionAction';
    return item;
  }

  private artifactTreeItem(record: ArtifactRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(record.label, vscode.TreeItemCollapsibleState.None);
    const date = new Date(record.modifiedAt);
    const timeStr = date.toLocaleTimeString();
    const dateStr = date.toLocaleDateString();
    const isServing = Boolean(
      (record.kind === 'report' || record.kind === 'report-zip') &&
      this.reportSession.isRunning &&
      this.reportSession.currentSession?.reportPath === record.path,
    );
    item.description = isServing ? `${dateStr} ${timeStr} · serving` : `${dateStr} ${timeStr}`;
    item.tooltip = new vscode.MarkdownString(
      `**Playwright Artifact**: ${record.label}\n\n` +
      `- **Type**: ${record.kind}\n` +
      (isServing ? `- **Status**: Serving (active report server)\n` : '') +
      `- **Modified**: ${dateStr} ${timeStr}\n` +
      `- **Path**: \`${record.path}\``,
    );
    item.resourceUri = vscode.Uri.file(record.path);
    item.command = {
      command: 'playwrightCodeLensRunner.openArtifact',
      title: 'Open artifact',
      arguments: [record],
    };
    item.iconPath = new vscode.ThemeIcon(isServing ? 'globe' : iconFor(record.kind));
    item.contextValue = isServing ? `playwrightArtifact.${record.kind}.serving` : `playwrightArtifact.${record.kind}`;
    return item;
  }
}

function iconFor(kind: ArtifactRecord['kind']): string {
  return kind === 'trace' ? 'pulse' : kind === 'blob-report' ? 'archive' : kind === 'attachment' ? 'file-media' : 'globe';
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}
