import * as path from 'path';
import * as vscode from 'vscode';
import { ArtifactService } from './artifactService';
import { CompanionCliRunner } from './companionRunner';
import { ArtifactRecord, CompanionFailure, CompanionRunSummary } from './core/companionTypes';
import { InteractiveSession, InteractiveSessionManager } from './interactiveSessions';
import { RunTarget } from './runTarget';

type RunElement =
  | { type: 'run'; run: CompanionRunSummary }
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
      const totals: RunElement[] = [{
        type: 'action',
        label: `Total ${run.total} · Passed ${run.passed} · Failed ${run.failed} · Skipped ${run.skipped} · Flaky ${run.flaky}`,
        command: 'playwrightCodeLensRunner.openRunsView',
        icon: run.status === 'passed' ? 'pass' : run.status === 'running' ? 'sync~spin' : 'error',
      }];
      if (run.failures.length > 0) {
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
      const item = new vscode.TreeItem(
        `Latest ${run.kind === 'flake-lab' ? 'Flake Lab' : 'failed-test rerun'}`,
        run.failures.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `${run.status} · ${formatDuration(run.durationMs)}`;
      item.tooltip = 'Companion CLI result. Native Run/Debug results remain in Microsoft Playwright Testing.';
      item.iconPath = new vscode.ThemeIcon(run.status === 'passed' ? 'pass' : run.status === 'running' ? 'sync~spin' : 'error');
      item.contextValue = 'playwrightCompanionRun';
      return item;
    }
    if (element.type === 'failure') {
      const failure = element.failure;
      const item = new vscode.TreeItem(failure.title, vscode.TreeItemCollapsibleState.None);
      item.description = failure.file ? `${path.basename(failure.file)}:${failure.line ?? 1}` : 'Failure';
      item.tooltip = failure.message ?? failure.title;
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
      item.tooltip = 'Long-lived UI/Inspector session reused for this resolved target.';
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
    item.description = new Date(record.modifiedAt).toLocaleString();
    item.tooltip = record.path;
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
