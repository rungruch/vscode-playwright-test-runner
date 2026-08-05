import * as vscode from 'vscode';
import { buildDiscoveryArguments } from './core/runArguments';
import { parseDiscoveryOutput } from './core/discoveryParser';
import { DiscoveredConfig } from './core/model';
import { targetsForChangedPath } from './core/refreshRouting';
import { isSupportedPlaywrightVersion } from './core/version';
import { discoverRunTargets, isConfigFile, isTestFile } from './configDiscovery';
import { probeCliVersion, spawnCommand } from './executor';
import { RunTarget } from './runTarget';
import { Settings } from './settings';

export interface TargetDiscovery {
  target: RunTarget;
  model?: DiscoveredConfig;
  error?: string;
}

/**
 * Owns Playwright CLI discovery: lazily runs `playwright test --list
 * --reporter=json` per config, caches the parsed tree, and refreshes when
 * test or config files are saved.
 */
export class DiscoveryService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<TargetDiscovery>();
  private targets: RunTarget[] = [];
  private readonly cache = new Map<string, DiscoveredConfig>();
  private readonly errors = new Map<string, string>();
  private readonly unsupported = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<DiscoveredConfig | undefined>>();
  private readonly pendingRefreshes = new Map<string, boolean>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private queuedFullRefresh: Promise<void> = Promise.resolve();

  readonly onDidDiscover = this.emitter.event;

  constructor() {
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/playwright.config.{js,cjs,mjs,ts,cts,mts}');
    this.disposables.push(
      configWatcher,
      configWatcher.onDidCreate((uri) => this.scheduleRefresh(uri.fsPath, true)),
      configWatcher.onDidDelete((uri) => this.scheduleRefresh(uri.fsPath, true)),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme !== 'file') {
          return;
        }
        const configChanged = isConfigFile(doc.uri.fsPath)
          || this.targets.some((target) => target.configFile === doc.uri.fsPath);
        const configuredTest = vscode.languages.match(
          { scheme: 'file', pattern: new Settings(doc.uri).codeLensPattern },
          doc,
        ) > 0;
        if (configChanged || isTestFile(doc.uri.fsPath) || configuredTest) {
          this.scheduleRefresh(doc.uri.fsPath, configChanged);
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.queueRefreshAll();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('playwrightCliRunner') && !event.affectsConfiguration('playwrightrunner')) {
          return;
        }
        this.cache.clear();
        this.errors.clear();
        this.unsupported.clear();
        this.queueRefreshAll();
      }),
    );
  }

  get currentTargets(): RunTarget[] {
    return this.targets;
  }

  cachedModel(targetId: string): DiscoveredConfig | undefined {
    return this.cache.get(targetId);
  }

  errorFor(targetId: string): string | undefined {
    return this.errors.get(targetId) ?? this.unsupported.get(targetId);
  }

  async refreshTargets(): Promise<RunTarget[]> {
    this.targets = await discoverRunTargets();
    const ids = new Set(this.targets.map((t) => t.id));
    for (const key of [...this.cache.keys()]) {
      if (!ids.has(key)) {
        this.cache.delete(key);
        this.errors.delete(key);
        this.unsupported.delete(key);
      }
    }
    for (const target of this.targets) {
      this.emitter.fire({ target, model: this.cache.get(target.id), error: this.errorFor(target.id) });
    }
    return this.targets;
  }

  /** Runs CLI discovery for a target, unless a valid cache entry exists. */
  async discover(target: RunTarget, token?: vscode.CancellationToken, force = false): Promise<DiscoveredConfig | undefined> {
    if (!force) {
      const cached = this.cache.get(target.id);
      if (cached) {
        return cached;
      }
    }
    const existing = this.inflight.get(target.id);
    if (existing) {
      if (!force) {
        return existing;
      }
      try {
        await existing;
      } catch {
        // A forced refresh still gets a fresh attempt after an older failure.
      }
      const refreshed = this.inflight.get(target.id);
      if (refreshed) {
        return refreshed;
      }
    }
    if (force) {
      this.unsupported.delete(target.id);
      this.errors.delete(target.id);
    }
    const task = this.doDiscover(target, token).finally(() => this.inflight.delete(target.id));
    this.inflight.set(target.id, task);
    return task;
  }

  async refreshAll(token?: vscode.CancellationToken): Promise<void> {
    await this.refreshTargets();
    for (const target of this.targets) {
      await this.discover(target, token, true);
    }
  }

  private queueRefreshAll(): void {
    this.queuedFullRefresh = this.queuedFullRefresh
      .catch(() => undefined)
      .then(() => this.refreshAll());
  }

  /** Drops cached data for the target containing the given file. */
  private scheduleRefresh(fsPath: string, rescanTargets = false): void {
    this.pendingRefreshes.set(fsPath, (this.pendingRefreshes.get(fsPath) ?? false) || rescanTargets);
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      const changes = [...this.pendingRefreshes].map(([path, rescan]) => ({ path, rescan }));
      this.pendingRefreshes.clear();
      void this.refreshForFiles(changes);
    }, 300);
  }

  private async refreshForFiles(changes: { path: string; rescan: boolean }[]): Promise<void> {
    if (changes.some((change) => change.rescan)) {
      await this.refreshTargets();
    }
    let targets = this.changedTargets(changes);
    if (targets.length === 0 && !changes.some((change) => change.rescan)) {
      await this.refreshTargets();
      targets = this.changedTargets(changes);
    }
    await Promise.all(targets.map((target) => this.discover(target, undefined, true)));
  }

  private changedTargets(changes: { path: string; rescan: boolean }[]): RunTarget[] {
    const selected = new Map<string, RunTarget>();
    for (const change of changes) {
      for (const target of targetsForChangedPath(this.targets, change.path, change.rescan)) {
        selected.set(target.id, target);
      }
    }
    return [...selected.values()];
  }

  private async doDiscover(target: RunTarget, token?: vscode.CancellationToken): Promise<DiscoveredConfig | undefined> {
    this.errors.delete(target.id);

    if (!this.unsupported.has(target.id)) {
      const probe = await probeCliVersion(target.cli, target.cwd, target.env);
      if (!probe.ok) {
        const message = `Playwright CLI not found for ${target.configDir}. Install @playwright/test locally or set playwrightCliRunner.cli.executable. (tried: ${[target.cli.executable, ...target.cli.argsPrefix].join(' ')})`;
        this.errors.set(target.id, message);
        this.emitter.fire({ target, error: message });
        return undefined;
      }
      if (!isSupportedPlaywrightVersion(probe.output)) {
        const message = `Playwright Test >= 1.38 is required (detected: ${probe.output}).`;
        this.unsupported.set(target.id, message);
        this.emitter.fire({ target, error: message });
        return undefined;
      }
    } else {
      this.emitter.fire({ target, error: this.unsupported.get(target.id) });
      return undefined;
    }

    let stdout = '';
    let stderr = '';
    const running = spawnCommand(target.cli, buildDiscoveryArguments({ configFile: target.configFile }), {
      cwd: target.cwd,
      env: target.env,
      cancellation: token,
      onStdout: (t) => (stdout += t),
      onStderr: (t) => (stderr += t),
    });
    const result = await running.outcome;
    if (result.cancelled) {
      return undefined;
    }
    const model = parseDiscoveryOutput(stdout, {
      id: target.id,
      cwd: target.cwd,
      configFile: target.configFile,
    });
    if (result.exitCode !== 0 && model.files.length === 0) {
      const message = stderr.trim() || model.errors.join('\n') || `Playwright discovery failed (exit code ${result.exitCode}).`;
      this.errors.set(target.id, message);
      this.emitter.fire({ target, error: message });
      return undefined;
    }
    this.cache.set(target.id, model);
    this.emitter.fire({ target, model, error: model.errors.length > 0 ? model.errors.join('\n') : undefined });
    return model;
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.pendingRefreshes.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.emitter.dispose();
  }
}
