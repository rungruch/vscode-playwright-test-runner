import * as vscode from 'vscode';
import { stripVTControlCharacters } from 'node:util';
import { CompanionCliRunner } from './companionRunner';
import { isInventoryTarget } from './configDiscovery';
import { EditorTestSelection } from './core/editorSelections';
import { explorerTree, ExplorerNode, ExplorerTestNode } from './core/explorerTree';
import { ExplorerResult, ExplorerResultProjector, resultDescription } from './core/explorerResults';
import { DiscoveryService, TargetDiscovery } from './discoveryService';
import { RunTarget, targetLabel } from './runTarget';
import { SETTINGS_NAMESPACE, Settings } from './settings';
import { PlaywrightSidebar, RunElement } from './sidebar';

export type ExplorerElement = ExplorerNode
  | { kind: 'runHistory'; id: string; label: string }
  | { kind: 'runItem'; id: string; label: string; runElement: RunElement }
  | { kind: 'workspace'; id: string; label: string; folder: vscode.WorkspaceFolder }
  | { kind: 'config'; id: string; label: string; targetId: string }
  | { kind: 'message'; id: string; label: string; error?: string; loading?: boolean }
  | { kind: 'retry' | 'details'; id: string; label: string; targetId: string };

interface InventoryState {
  target: RunTarget;
  nodes: ExplorerNode[];
  refreshing: boolean;
  error?: string;
  revision: number;
}

/** A complete workspace inventory, independent of editor-scoped CodeLens reports. */
export class PlaywrightTestExplorer implements vscode.TreeDataProvider<ExplorerElement>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ExplorerElement | undefined>();
  private readonly states = new Map<string, InventoryState>();
  private readonly disposables: vscode.Disposable[];
  private initializing = true;
  private startupError: string | undefined;
  private disposed = false;
  private readonly resultProjector = new ExplorerResultProjector();
  private results = new Map<string, ExplorerResult>();
  private readonly view: vscode.TreeView<ExplorerElement>;
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly discovery: DiscoveryService, private readonly runner: CompanionCliRunner, private readonly sidebar: PlaywrightSidebar) {
    this.view = vscode.window.createTreeView('playwrightCodeLensRunner.testsView', { treeDataProvider: this, showCollapseAll: true });
    this.disposables = [
      this.emitter,
      discovery.onDidChangeTargets((targets) => this.updateTargets(targets)),
      discovery.onDidDiscover((event) => this.updateDiscovery(event)),
      discovery.subscribeInventory(),
      this.view,
      sidebar.onDidChangeRuns(() => this.refreshResults()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SETTINGS_NAMESPACE}.run.backend`)
          || event.affectsConfiguration(`${SETTINGS_NAMESPACE}.sidebar.runsEnabled`)) {
          this.refreshResults();
        }
      }),
    ];
    this.updateTargets(discovery.currentTargets);
  }

  async initialize(): Promise<void> {
    await this.refresh(undefined, false);
  }

  async showResultOutput(element?: ExplorerElement): Promise<void> {
    const runId = element && this.results.get(element.id)?.runId;
    if (runId) { await this.runner.showOutput(runId); }
  }

  async showHistory(): Promise<void> {
    await vscode.commands.executeCommand('playwrightCodeLensRunner.testsView.focus');
    const history = this.getChildren().find((element) => element.kind === 'runHistory');
    if (history) { await this.view.reveal(history, { expand: true, select: false, focus: false }); }
  }

  getParent(element: ExplorerElement): ExplorerElement | undefined {
    const find = (parent?: ExplorerElement): ExplorerElement | undefined => {
      const children = this.getChildren(parent);
      if (children.some((child) => child.id === element.id)) { return parent; }
      for (const child of children) {
        const found = find(child);
        if (found) { return found; }
      }
      return undefined;
    };
    return find();
  }

  async refresh(targetId?: string, force = true): Promise<void> {
    this.startupError = undefined;
    try {
      await this.discovery.refreshInventory(targetId, force);
    } catch (error) {
      this.startupError = error instanceof Error ? error.message : String(error);
      for (const [id, state] of this.states) {
        if (!targetId || targetId === id) {
          state.error = this.startupError;
          state.refreshing = false;
        }
      }
    } finally {
      this.initializing = false;
      if (!this.disposed) {
        this.emitter.fire(undefined);
      }
    }
  }

  getChildren(element?: ExplorerElement): ExplorerElement[] {
    if (element?.kind === 'runHistory' || element?.kind === 'runItem') {
      return this.sidebar.runChildren(element.kind === 'runItem' ? element.runElement : undefined).map((runElement, index) => {
        const item = this.sidebar.runTreeItem(runElement);
        return { kind: 'runItem', id: item.id ?? `${element.id}:${index}`, label: typeof item.label === 'string' ? item.label : item.label?.label ?? '', runElement };
      });
    }
    if (!element) {
      const history: ExplorerElement[] = new Settings().sidebarRunsEnabled
        ? [{ kind: 'runHistory', id: 'run-history', label: 'Run History & Sessions' }] : [];
      const folders = new Map<string, vscode.WorkspaceFolder>();
      for (const { target } of this.states.values()) {
        folders.set(target.workspaceFolder.uri.toString(), target.workspaceFolder);
      }
      if (folders.size > 0) {
        return [...[...folders].map(([uri, folder]): ExplorerElement => ({
          kind: 'workspace', id: `workspace:${uri}`, label: folder.name, folder,
        })), ...history];
      }
      return [{ kind: 'message', id: 'empty', loading: this.initializing,
        label: this.initializing ? 'Discovering Playwright tests…' : this.startupError
          ? 'Playwright discovery failed. Use Refresh to retry.' : 'No Playwright projects found.',
        error: this.startupError }, ...history];
    }
    if (element.kind === 'workspace') {
      return [...this.states.values()]
        .filter(({ target }) => target.workspaceFolder.uri.toString() === element.folder.uri.toString())
        .sort((a, b) => targetLabel(a.target).localeCompare(targetLabel(b.target)))
        .map(({ target }) => ({ kind: 'config', id: `config:${target.id}`, label: targetLabel(target), targetId: target.id }));
    }
    if (element.kind === 'config') {
      const state = this.states.get(element.targetId);
      if (!state) {
        return [];
      }
      const entries: ExplorerElement[] = [...state.nodes];
      if (state.refreshing) {
        entries.unshift({ kind: 'message', id: `${element.id}:loading`, label: 'Discovering tests…', loading: true });
      } else if (state.error) {
        entries.unshift(
          { kind: 'message', id: `${element.id}:error`, label: 'Discovery failed', error: state.error },
          { kind: 'retry', id: `${element.id}:retry`, label: 'Retry Discovery', targetId: element.targetId },
          { kind: 'details', id: `${element.id}:details`, label: 'Discovery Details', targetId: element.targetId },
        );
      } else if (entries.length === 0) {
        entries.push({ kind: 'message', id: `${element.id}:empty`, label: 'No Playwright tests found.' });
      }
      return entries;
    }
    return element.kind === 'folder' || isTestNode(element) ? element.children : [];
  }

  getTreeItem(element: ExplorerElement): vscode.TreeItem {
    if (element.kind === 'runItem') {
      const item = this.sidebar.runTreeItem(element.runElement);
      item.id = element.id;
      return item;
    }
    if (element.kind === 'runHistory') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = element.id;
      item.iconPath = new vscode.ThemeIcon('history');
      item.description = `${this.runner.runs.length} runs`;
      return item;
    }
    const expanded = element.kind === 'workspace' || element.kind === 'config';
    const item = new vscode.TreeItem(element.label, expanded ? vscode.TreeItemCollapsibleState.Expanded
      : (element.kind === 'folder' || isTestNode(element)) && element.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    if (element.kind === 'workspace') {
      item.iconPath = new vscode.ThemeIcon('root-folder');
      item.resourceUri = element.folder.uri;
    } else if (element.kind === 'config') {
      const state = this.states.get(element.targetId);
      item.contextValue = 'playwrightExplorer.config';
      item.iconPath = new vscode.ThemeIcon(state?.refreshing ? 'sync~spin' : state?.error ? 'error' : 'settings-gear');
      item.description = state?.refreshing ? 'Refreshing…' : state?.error ? 'Discovery failed' : undefined;
      item.tooltip = state?.error ?? state?.target.configFile ?? state?.target.cwd;
    } else if (element.kind === 'folder') {
      item.iconPath = new vscode.ThemeIcon('folder');
      item.resourceUri = vscode.Uri.file(element.directory);
      item.contextValue = 'playwrightExplorer.folder';
      item.tooltip = element.directory;
    } else if (element.kind === 'message') {
      item.iconPath = new vscode.ThemeIcon(element.loading ? 'sync~spin' : element.error ? 'error' : 'info');
      item.tooltip = element.error ?? element.label;
    } else if (element.kind === 'retry' || element.kind === 'details') {
      item.iconPath = new vscode.ThemeIcon(element.kind === 'retry' ? 'refresh' : 'output');
      item.command = { title: element.label,
        command: element.kind === 'retry' ? 'playwrightCodeLensRunner.retryExplorerDiscovery' : 'playwrightCodeLensRunner.explorerDiscoveryDetails',
        arguments: [element] };
    } else if (isTestNode(element)) {
      item.iconPath = new vscode.ThemeIcon(element.kind === 'file' ? 'file-code' : element.kind === 'suite'
        ? 'symbol-class' : element.skipped ? 'circle-slash' : 'beaker');
      const state = this.states.get(element.targetId);
      const executable = Boolean(this.selectionFor(element));
      const official = element.selection && new Settings(vscode.Uri.parse(element.selection.uri)).runBackend === 'official';
      item.contextValue = executable ? `playwrightExplorer.executable${element.sharedDeclaration ? '.generated' : ''}${official ? '.official' : ''}`
        : 'playwrightExplorer.unavailable';
      if (state?.refreshing || state?.error) {
        item.description = 'Outdated';
      } else if (element.skipped) {
        item.description = 'Skipped';
      }
      const tooltip = [element.label];
      if (element.selection) {
        item.resourceUri = vscode.Uri.file(element.selection.file);
        tooltip.push(`${element.selection.file}:${element.selection.position.line + 1}`);
        item.command = { command: 'playwrightCodeLensRunner.openExplorerItem', title: 'Open Test Source', arguments: [element] };
      }
      if (element.projects.length) {
        tooltip.push(`Projects: ${element.projects.join(', ')}`);
      }
      if (element.tags.length) {
        tooltip.push(`Tags: ${element.tags.join(', ')}`);
      }
      if (element.skipped) {
        tooltip.push('Skipped by Playwright configuration or test declaration.');
      }
      if (element.sharedDeclaration) {
        tooltip.push('Companion Run selects this exact case. Microsoft Run Declaration and Debug Declaration select cases at this source declaration using Microsoft’s configured projects.');
      }
      item.tooltip = tooltip.join('\n');
    }
    const result = this.results.get(element.id);
    if (result && !(isTestNode(element) && item.description === 'Outdated')) {
      item.iconPath = resultIcon(result.status);
      item.description = resultDescription(result);
      const tooltip = new vscode.MarkdownString();
      tooltip.appendText(typeof item.tooltip === 'string' ? item.tooltip : element.label);
      tooltip.appendText(`\n\n${resultDescription(result)}`);
      if (result.message) { tooltip.appendCodeblock(stripVTControlCharacters(result.message)); }
      item.tooltip = tooltip;
      if (result.runId && item.contextValue?.startsWith('playwrightExplorer.executable')) {
        item.contextValue += '.result';
      }
    }
    return item;
  }

  /** Rejects stale menu payloads rather than running another test at their location. */
  selectionFor(element: ExplorerElement): EditorTestSelection | undefined {
    if (!isTestNode(element) || !element.selection) {
      return undefined;
    }
    const state = this.states.get(element.targetId);
    return state && !state.refreshing && !state.error
      && element.selection.discoveryRevision === state.revision
      && state.revision === this.discovery.revisionFor(element.targetId)
      ? element.selection : undefined;
  }

  private updateTargets(targets: readonly RunTarget[]): void {
    const eligible = targets.filter(isInventoryTarget);
    const ids = new Set(eligible.map((target) => target.id));
    for (const id of this.states.keys()) {
      if (!ids.has(id)) {
        this.states.delete(id);
      }
    }
    for (const target of eligible) {
      const state = this.states.get(target.id);
      if (state) {
        state.target = target;
      } else {
        this.states.set(target.id, { target, nodes: [], refreshing: true, revision: this.discovery.revisionFor(target.id) });
      }
    }
    this.refreshResults();
  }

  private updateDiscovery(event: TargetDiscovery): void {
    const state = this.states.get(event.target.id);
    if (!state) {
      return;
    }
    if (event.scopeFile && !event.invalidated) { return; }
    if (event.invalidated) {
      state.refreshing = true;
      state.error = undefined;
    } else if (!event.scopeFile && (event.model || event.error)) {
      state.revision = this.discovery.revisionFor(event.target.id);
      if (event.model && (!event.error || state.nodes.length === 0)) {
        state.nodes = explorerTree(event.model, state.revision, (file) => vscode.Uri.file(file).toString(), state.target.workspaceFolder.uri.fsPath);
      }
      state.error = event.error;
      state.refreshing = false;
    }
    this.refreshResults();
  }

  private refreshResults(): void {
    if (this.disposed) { return; }
    const enabled = new Settings().sidebarRunsEnabled;
    this.results = this.resultProjector.project([...this.states.values()].flatMap((state) => state.nodes), enabled ? this.runner.runs : []);
    const latest = enabled ? this.runner.latestRun : undefined;
    const active = enabled ? this.runner.runs.filter((run) => run.status === 'running') : [];
    this.view.message = active.length ? `${active.length} run${active.length > 1 ? 's' : ''} in progress · ${active.reduce((sum, run) => sum + (run.completedTests ?? 0), 0)}/${active.reduce((sum, run) => sum + run.total, 0)} completed`
      : latest ? `Last run ${latest.status} · ${latest.passed} passed · ${latest.failed} failed · ${latest.flaky} flaky · ${latest.skipped} skipped` : undefined;
    void vscode.commands.executeCommand('setContext', 'playwrightCodeLensRunner.hasActiveRun', active.length > 0);
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.states.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function isTestNode(element: ExplorerElement): element is ExplorerTestNode {
  return element.kind === 'file' || element.kind === 'suite' || element.kind === 'test';
}

function resultIcon(status: ExplorerResult['status']): vscode.ThemeIcon {
  const [icon, color] = status === 'running' ? ['sync~spin', 'testing.iconQueued']
    : status === 'passed' ? ['pass', 'testing.iconPassed']
      : status === 'failed' ? ['error', 'testing.iconFailed']
        : status === 'flaky' || status === 'incomplete' ? ['warning', 'testing.iconQueued']
          : status === 'skipped' || status === 'cancelled' ? ['circle-slash', 'testing.iconSkipped']
            : ['circle-outline', 'testing.iconUnset'];
  return new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
}
