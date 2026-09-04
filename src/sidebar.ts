import * as path from 'path';
import * as vscode from 'vscode';
import { ArtifactService } from './artifactService';
import { CompanionCliRunner } from './companionRunner';
import { ArtifactRecord, CompanionFailure, CompanionRunSummary, CompanionTestItem } from './core/companionTypes';
import { InteractiveSession, InteractiveSessionManager } from './interactiveSessions';
import { RunTarget } from './runTarget';

type RunElement =
  | { type: 'run'; run: CompanionRunSummary }
  | { type: 'testCase'; test: CompanionTestItem }
  | { type: 'failure'; failure: CompanionFailure }
  | { type: 'session'; session: InteractiveSession }
  | { type: 'action'; label: string; command: string; icon: string };

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
      const run = this.runner.latestRun;
      if (!run) {
        return [
          ...this.sessions.sessions.map((session) => ({ type: 'session' as const, session })),
          { type: 'action', label: 'No companion CLI runs yet', command: 'playwrightCodeLensRunner.openMicrosoftTesting', icon: 'beaker' },
          { type: 'action', label: 'Open UI Profile…', command: 'playwrightCodeLensRunner.openUiProfile', icon: 'remote' },
          { type: 'action', label: 'Show Companion Output', command: 'playwrightCodeLensRunner.showCompanionOutput', icon: 'output' },
        ];
      }
      return [
        { type: 'run', run },
        ...this.sessions.sessions.map((session) => ({ type: 'session' as const, session })),
        { type: 'action', label: 'Open Browser Report', command: 'playwrightCodeLensRunner.openLatestReport', icon: 'globe' },
        { type: 'action', label: 'Open UI Profile…', command: 'playwrightCodeLensRunner.openUiProfile', icon: 'remote' },
        { type: 'action', label: 'Open Microsoft Testing', command: 'playwrightCodeLensRunner.openMicrosoftTesting', icon: 'beaker' },
        { type: 'action', label: 'Show Companion Output', command: 'playwrightCodeLensRunner.showCompanionOutput', icon: 'output' },
      ];
    }
    if (element.type === 'run') {
      const run = element.run;
      const totals: RunElement[] = [];
      totals.push({
        type: 'action',
        label: `Total ${run.total} · Passed ${run.passed} · Failed ${run.failed} · Skipped ${run.skipped} · Flaky ${run.flaky}`,
        command: 'playwrightCodeLensRunner.openRunsView',
        icon: run.status === 'passed' ? 'pass' : run.status === 'running' ? 'sync~spin' : 'error',
      });
      if (run.tests && run.tests.length > 0) {
        totals.push(...run.tests.map((test) => ({ type: 'testCase' as const, test })));
      } else if (run.failures.length > 0) {
        totals.push(...run.failures.map((failure) => ({ type: 'failure' as const, failure })));
      }
      if (run.failed > 0) {
        totals.push({ type: 'action', label: 'Rerun Failed', command: 'playwrightCodeLensRunner.rerunFailedCli', icon: 'refresh' });
      }
      return totals;
    }
    return [];
  }

  private runTreeItem(element: RunElement): vscode.TreeItem {
    if (element.type === 'run') {
      const run = element.run;
      const kindLabel = run.kind === 'flake-lab' ? 'Flake Lab' : run.kind === 'companion-run' ? 'Companion run' : 'failed-test rerun';
      const targetFile = run.selection?.files?.[0];
      const fileBasename = targetFile ? ` (${path.basename(targetFile)})` : '';
      const isExpanded = Boolean((run.tests && run.tests.length > 0) || run.failures.length > 0 || run.status === 'running');
      const item = new vscode.TreeItem(
        `Latest ${kindLabel}${fileBasename}`,
        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = run.status === 'running' && run.currentTest
        ? `running · ${run.currentTest}`
        : `${run.status} · ${formatDuration(run.durationMs)}`;
      const startedStr = new Date(run.startedAt).toLocaleTimeString();
      item.tooltip = new vscode.MarkdownString(
        `**Playwright ${kindLabel}**\n\n` +
        `- **Status**: ${run.status}\n` +
        `- **Started**: ${startedStr}\n` +
        `- **Duration**: ${formatDuration(run.durationMs)}\n` +
        `- **Passed**: ${run.passed} / ${run.total}\n` +
        `- **Failed**: ${run.failed}\n` +
        `- **Flaky**: ${run.flaky}\n` +
        `- **Skipped**: ${run.skipped}\n` +
        (run.configFile ? `- **Config**: \`${path.basename(run.configFile)}\`` : ''),
      );
      item.iconPath = new vscode.ThemeIcon(run.status === 'passed' ? 'pass' : run.status === 'running' ? 'sync~spin' : 'error');
      item.contextValue = 'playwrightCompanionRun';
      return item;
    }
    if (element.type === 'testCase') {
      const test = element.test;
      const item = new vscode.TreeItem(test.title, vscode.TreeItemCollapsibleState.None);
      item.description = test.status === 'running'
        ? 'running'
        : test.durationMs !== undefined && test.durationMs > 0
          ? formatDuration(test.durationMs)
          : test.status;
      const icon = test.status === 'running'
        ? 'sync~spin'
        : test.status === 'passed'
          ? 'pass'
          : test.status === 'failed'
            ? 'error'
            : test.status === 'skipped'
              ? 'dash'
              : 'circle-outline';
      item.iconPath = new vscode.ThemeIcon(icon);
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
      item.tooltip = new vscode.MarkdownString(
        `**${test.title}**\n\n` +
        `- **Status**: ${test.status}\n` +
        (test.durationMs ? `- **Duration**: ${formatDuration(test.durationMs)}\n` : '') +
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
    if (element.type === 'session') {
      const item = new vscode.TreeItem(`Active: ${element.session.name}`, vscode.TreeItemCollapsibleState.None);
      item.description = 'Companion CLI session';
      item.tooltip = 'The active global UI/Inspector session. Another interactive launch replaces it.';
      item.iconPath = new vscode.ThemeIcon('terminal');
      item.contextValue = 'playwrightCompanionSession';
      return item;
    }
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.command = { command: element.command, title: element.label };
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.contextValue = 'playwrightCompanionAction';
    return item;
  }

  private artifactTreeItem(record: ArtifactRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(record.label, vscode.TreeItemCollapsibleState.None);
    const date = new Date(record.modifiedAt);
    const timeStr = date.toLocaleTimeString();
    const dateStr = date.toLocaleDateString();
    item.description = `${dateStr} ${timeStr}`;
    item.tooltip = new vscode.MarkdownString(
      `**Playwright Artifact**: ${record.label}\n\n` +
      `- **Type**: ${record.kind}\n` +
      `- **Modified**: ${dateStr} ${timeStr}\n` +
      `- **Path**: \`${record.path}\``,
    );
    item.resourceUri = vscode.Uri.file(record.path);
    item.command = {
      command: 'playwrightCodeLensRunner.openArtifact',
      title: 'Open artifact',
      arguments: [record],
    };
    item.iconPath = new vscode.ThemeIcon(iconFor(record.kind));
    item.contextValue = `playwrightArtifact.${record.kind}`;
    return item;
  }
}

function iconFor(kind: ArtifactRecord['kind']): string {
  return kind === 'trace' ? 'pulse' : kind === 'blob-report' ? 'archive' : kind === 'attachment' ? 'file-media' : 'globe';
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}
