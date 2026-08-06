import * as path from 'path';
import * as vscode from 'vscode';
import {
  containsPath,
  discoveryPickerCandidates,
  isBenignNoTestsFailure,
  rankDiscoveryTargets,
} from './core/discoveryPolicy';
import { buildDiscoveryArguments } from './core/runArguments';
import { parseDiscoveryOutput } from './core/discoveryParser';
import { DiscoveredConfig } from './core/model';
import { targetsForChangedPath } from './core/refreshRouting';
import { ScopedTaskQueue } from './core/scopedTaskQueue';
import { isSupportedPlaywrightVersion } from './core/version';
import { discoverRunTargets, isConfigFile, isTestFile, PLAYWRIGHT_CONFIG_GLOB } from './configDiscovery';
import { probeCliVersion, spawnCommand } from './executor';
import { RunTarget } from './runTarget';
import { SETTINGS_NAMESPACE, Settings } from './settings';

const DISCOVERY_CONFIGURATION_KEYS = [
  'configFiles',
  'cli.executable',
  'cli.arguments',
  'workingDirectory',
  'runOptions',
  'environment',
] as const;
const TEST_DISCOVERY_TIMEOUT_MS = 60_000;
const CLI_PROBE_TIMEOUT_SECONDS = 15;

export interface TargetDiscovery {
  target: RunTarget;
  model?: DiscoveredConfig;
  error?: string;
}

export interface DiscoveryDiagnostics {
  targetId: string;
  startedAt: number;
  durationMs: number;
  cwd: string;
  configFile?: string;
  cliVersion?: string;
  projects: string[];
  commandPreview: string;
  scopeFile?: string;
  error?: string;
}

/**
 * Owns Playwright CLI discovery: lazily runs `playwright test --list
 * --reporter=json` per config, caches the parsed tree, and refreshes when
 * test or config files are saved or changed externally.
 */
export class DiscoveryService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly testWatcherDisposables: vscode.Disposable[] = [];
  private readonly targetConfigWatcherDisposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<TargetDiscovery>();
  private readonly output = vscode.window.createOutputChannel('Playwright CodeLens Runner');
  private readonly context: vscode.ExtensionContext;
  private targets: RunTarget[] = [];
  private readonly cache = new Map<string, DiscoveredConfig>();
  private readonly fileCache = new Map<string, DiscoveredConfig>();
  /** Target-wide failures only: CLI resolution, version, or full discovery. */
  private readonly errors = new Map<string, string>();
  private readonly cliErrors = new Map<string, string>();
  /** File-scoped discovery failures must not poison the complete target. */
  private readonly fileErrors = new Map<string, string>();
  private readonly unsupported = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<DiscoveredConfig | undefined>>();
  private readonly fileInflight = new Map<string, Promise<DiscoveredConfig | undefined>>();
  private readonly versions = new Map<string, string>();
  private readonly versionInflight = new Map<string, Promise<{ output: string; ok: boolean; timedOut: boolean }>>();
  private readonly forcedDiscoveries = new ScopedTaskQueue<DiscoveredConfig | undefined>();
  private readonly diagnostics = new Map<string, DiscoveryDiagnostics>();
  private readonly latestDiagnosticKeys = new Map<string, string>();
  private readonly targetRevisions = new Map<string, number>();
  private readonly targetCancellation = new Map<string, vscode.CancellationTokenSource>();
  private readonly retiredTargetIds = new Set<string>();
  private readonly limiter = new AsyncLimiter(4);
  private readonly pendingRefreshes = new Map<string, { rescan: boolean; broad: boolean }>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private queuedFullRefresh: Promise<void> = Promise.resolve();
  private targetRefreshSequence = 0;
  private disposed = false;

  readonly onDidDiscover = this.emitter.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    const configWatcher = vscode.workspace.createFileSystemWatcher(PLAYWRIGHT_CONFIG_GLOB);
    this.disposables.push(
      configWatcher,
      configWatcher.onDidCreate((uri) => this.scheduleRefresh(uri.fsPath, true)),
      configWatcher.onDidChange((uri) => this.scheduleRefresh(uri.fsPath, true)),
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
        this.rebuildTestWatchers();
        this.invalidateAllTargets(true);
        this.queueRefreshAll();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SETTINGS_NAMESPACE}.codeLens.pattern`)) {
          this.rebuildTestWatchers();
        }
        if (!DISCOVERY_CONFIGURATION_KEYS.some((key) => event.affectsConfiguration(`${SETTINGS_NAMESPACE}.${key}`))) {
          return;
        }
        this.invalidateAllTargets(true);
        this.queueRefreshAll();
      }),
    );
    this.rebuildTestWatchers();
  }

  get currentTargets(): RunTarget[] {
    return this.targets;
  }

  cachedModel(targetId: string): DiscoveredConfig | undefined {
    return this.cache.get(targetId);
  }

  diagnosticsFor(targetId: string, scopeFile?: string): DiscoveryDiagnostics | undefined {
    if (scopeFile) {
      return this.diagnostics.get(discoveryKey(targetId, scopeFile));
    }
    return this.diagnostics.get(targetId)
      ?? this.diagnostics.get(this.latestDiagnosticKeys.get(targetId) ?? '');
  }

  showDiagnostics(targetId: string, scopeFile?: string): void {
    const diagnostic = this.diagnosticsFor(targetId, scopeFile);
    if (!diagnostic) {
      const target = this.targets.find((candidate) => candidate.id === targetId);
      const displayId = target ? this.sanitize(target, targetId) : targetId;
      this.output.appendLine(`No discovery attempt has been recorded for ${displayId}.`);
      this.output.show(true);
      return;
    }
    this.output.appendLine('');
    this.output.appendLine(`Selected discovery details for ${diagnostic.targetId}:`);
    this.appendDiagnostic(diagnostic);
    this.output.show(true);
  }

  errorFor(targetId: string, scopeFile?: string): string | undefined {
    const targetError = this.cliErrors.get(targetId) ?? this.unsupported.get(targetId) ?? this.errors.get(targetId);
    return scopeFile
      ? this.fileErrors.get(discoveryKey(targetId, scopeFile)) ?? targetError
      : targetError;
  }

  async refreshTargets(): Promise<RunTarget[]> {
    if (this.disposed) {
      return [];
    }
    const sequence = ++this.targetRefreshSequence;
    const nextTargets = await discoverRunTargets();
    if (this.disposed || sequence !== this.targetRefreshSequence) {
      return this.targets;
    }

    const previous = new Map(this.targets.map((target) => [target.id, target]));
    const next = new Map(nextTargets.map((target) => [target.id, target]));
    for (const [id, target] of previous) {
      const replacement = next.get(id);
      if (!replacement || targetFingerprint(replacement) !== targetFingerprint(target)) {
        this.invalidateTarget(id, !replacement);
      }
    }
    this.targets = nextTargets;
    this.rebuildTargetConfigWatchers();
    for (const target of this.targets) {
      this.retiredTargetIds.delete(target.id);
    }
    for (const target of this.targets) {
      this.emitter.fire({ target, model: this.cache.get(target.id), error: this.errorFor(target.id) });
    }
    return this.targets;
  }

  /** Runs CLI discovery for a target, unless a valid cache entry exists. */
  async discover(target: RunTarget, token?: vscode.CancellationToken, force = false): Promise<DiscoveredConfig | undefined> {
    return this.discoverScoped(target, undefined, token, force);
  }

  /** Discovers only one file so CodeLens can appear before a monorepo-wide scan completes. */
  async discoverForFile(
    target: RunTarget,
    filePath: string,
    token?: vscode.CancellationToken,
    force = false,
  ): Promise<DiscoveredConfig | undefined> {
    return this.discoverScoped(target, filePath, token, force);
  }

  async refreshAll(token?: vscode.CancellationToken): Promise<void> {
    if (this.disposed || token?.isCancellationRequested) {
      return;
    }
    await this.refreshTargets();
    if (this.disposed || token?.isCancellationRequested) {
      return;
    }
    await runWithConcurrency(this.targets, 4, (target) => this.discover(target, token, true));
  }

  /** Returns the nearest target by filesystem topology without executing Playwright. */
  async nearestTargetForPath(fsPath: string): Promise<RunTarget | undefined> {
    if (this.disposed) {
      return undefined;
    }
    const targets = this.targets.length > 0 ? this.targets : await this.refreshTargets();
    const nearest = this.rankTargetsForPath(targets, fsPath)[0];
    const cachedRootDir = nearest ? this.cachedRootDirFor(nearest, fsPath) : undefined;
    return nearest && (
      Boolean(cachedRootDir && containsPath(cachedRootDir, fsPath))
      ||
      containsPath(nearest.configDir, fsPath)
      || containsPath(nearest.workspaceFolder.uri.fsPath, fsPath)
    ) ? nearest : undefined;
  }

  /** Resolves an owning config and persists explicit choices when requested. */
  async resolveTargetForFile(
    fsPath: string,
    options: { prompt?: boolean; forcePrompt?: boolean; token?: vscode.CancellationToken } = {},
  ): Promise<RunTarget | undefined> {
    if (this.disposed || options.token?.isCancellationRequested) {
      return undefined;
    }
    const targets = this.targets.length > 0 ? this.targets : await this.refreshTargets();
    const orderedTargets = this.rankTargetsForPath(targets, fsPath);
    if (orderedTargets.length === 0) {
      return undefined;
    }
    const localTargets = orderedTargets.filter((target) => containsPath(target.workspaceFolder.uri.fsPath, fsPath));
    const fallbackTargets = localTargets.length > 0 ? localTargets : orderedTargets;

    const ownerKey = configOwnerKey(fsPath);
    const stored = this.context.workspaceState.get<string>(ownerKey);
    if (!options.forcePrompt && stored) {
      const persisted = orderedTargets.find((target) => target.id === stored);
      if (persisted) {
        const model = await this.discoverForFile(persisted, fsPath, options.token);
        if (options.token?.isCancellationRequested) {
          return undefined;
        }
        if (!model || modelContainsFile(model, path.normalize(fsPath))) {
          // Keep an explicit owner when its CLI failed: returning it surfaces
          // Details/Retry instead of silently switching execution settings.
          return persisted;
        }
      }
      await this.context.workspaceState.update(ownerKey, undefined);
    }

    const normalizedFile = path.normalize(fsPath);
    const cachedOwners = orderedTargets.filter((target) => {
      const scoped = this.fileCache.get(discoveryKey(target.id, fsPath));
      return scoped
        ? modelContainsFile(scoped, normalizedFile)
        : modelContainsFile(this.cache.get(target.id), normalizedFile);
    });
    const scanAll = options.forcePrompt || options.prompt === true;
    if (!scanAll && cachedOwners.length > 0) {
      return cachedOwners[0];
    }

    if (!scanAll) {
      let firstFailure: RunTarget | undefined;
      for (const target of orderedTargets) {
        const model = await this.discoverForFile(target, fsPath, options.token);
        if (options.token?.isCancellationRequested) {
          return undefined;
        }
        if (modelContainsFile(model, normalizedFile)) {
          return target;
        }
        if (!model && this.errorFor(target.id, fsPath)) {
          firstFailure ??= target;
        }
      }
      return firstFailure ?? fallbackTargets[0];
    }

    const discovered = await Promise.all(orderedTargets.map(async (target) => ({
      target,
      model: await this.discoverForFile(target, fsPath, options.token),
    })));
    if (options.token?.isCancellationRequested) {
      return undefined;
    }
    const owning = discovered.filter(({ model }) => modelContainsFile(model, normalizedFile)).map(({ target }) => target);
    const failed = discovered
      .filter(({ target, model }) => !model && Boolean(this.errorFor(target.id, fsPath)))
      .map(({ target }) => target);
    const candidates = discoveryPickerCandidates(owning, fallbackTargets, failed);
    if (candidates.length === 1 || options.prompt === false) {
      return candidates[0];
    }

    const picked = await vscode.window.showQuickPick(
      candidates.map((target) => ({
        label: targetLabelForResolver(target),
        description: targetDescriptionForResolver(target),
        detail: this.errorFor(target.id, fsPath) ? 'Discovery failed — select for Details/Retry' : undefined,
        target,
      })),
      {
        title: `Select the Playwright config that owns ${path.basename(fsPath)}`,
        placeHolder: 'This choice is remembered for the file',
      },
    );
    if (!picked) {
      return undefined;
    }
    await this.context.workspaceState.update(ownerKey, picked.target.id);
    if (this.disposed) {
      return undefined;
    }
    this.emitter.fire({
      target: picked.target,
      model: this.fileCache.get(discoveryKey(picked.target.id, fsPath)) ?? this.cache.get(picked.target.id),
      error: this.errorFor(picked.target.id, fsPath),
    });
    return picked.target;
  }

  async selectTargetForFile(fsPath: string): Promise<RunTarget | undefined> {
    return this.resolveTargetForFile(fsPath, { forcePrompt: true });
  }

  private queueRefreshAll(): void {
    this.queuedFullRefresh = this.queuedFullRefresh
      .catch(() => undefined)
      .then(() => this.disposed ? undefined : this.refreshAll())
      .catch((error: unknown) => {
        this.output.appendLine(`Automatic discovery refresh failed: ${errorMessage(error)}`);
      });
  }

  /** Drops cached data for the target containing the given file. */
  private scheduleRefresh(fsPath: string, rescanTargets = false, broad = false): void {
    if (this.disposed) {
      return;
    }
    const pending = this.pendingRefreshes.get(fsPath);
    this.pendingRefreshes.set(fsPath, {
      rescan: (pending?.rescan ?? false) || rescanTargets,
      broad: (pending?.broad ?? false) || broad,
    });
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      const changes = [...this.pendingRefreshes].map(([path, flags]) => ({ path, ...flags }));
      this.pendingRefreshes.clear();
      void this.refreshForFiles(changes).catch((error: unknown) => {
        this.output.appendLine(`File-triggered discovery refresh failed: ${errorMessage(error)}`);
      });
    }, 300);
  }

  private rebuildTestWatchers(): void {
    for (const disposable of this.testWatcherDisposables.splice(0)) {
      disposable.dispose();
    }
    if (this.disposed) {
      return;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, new Settings(folder.uri).codeLensPattern),
      );
      const refresh = (uri: vscode.Uri, created: boolean) => {
        const configChanged = isConfigFile(uri.fsPath)
          || this.targets.some((target) => target.configFile === uri.fsPath);
        this.scheduleRefresh(uri.fsPath, configChanged, created && !configChanged);
      };
      this.testWatcherDisposables.push(
        watcher,
        watcher.onDidCreate((uri) => refresh(uri, true)),
        watcher.onDidChange((uri) => refresh(uri, false)),
        watcher.onDidDelete((uri) => refresh(uri, false)),
      );
    }
  }

  private rebuildTargetConfigWatchers(): void {
    for (const disposable of this.targetConfigWatcherDisposables.splice(0)) {
      disposable.dispose();
    }
    if (this.disposed) {
      return;
    }
    const watched = new Set<string>();
    for (const target of this.targets) {
      const coveredByConfigWatcher = target.configFile
        && isConfigFile(target.configFile)
        && (vscode.workspace.workspaceFolders ?? []).some((folder) => containsPath(folder.uri.fsPath, target.configFile ?? ''));
      if (
        !target.configFile
        || coveredByConfigWatcher
        || watched.has(target.configFile)
      ) {
        continue;
      }
      watched.add(target.configFile);
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(target.configFile), path.basename(target.configFile)),
      );
      const refresh = (uri: vscode.Uri) => this.scheduleRefresh(uri.fsPath, true);
      this.targetConfigWatcherDisposables.push(
        watcher,
        watcher.onDidCreate(refresh),
        watcher.onDidChange(refresh),
        watcher.onDidDelete(refresh),
      );
    }
  }

  private async refreshForFiles(changes: { path: string; rescan: boolean; broad?: boolean }[]): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (changes.some((change) => change.rescan)) {
      await this.refreshTargets();
    }
    if (this.disposed) {
      return;
    }
    let targets = this.changedTargets(changes);
    if (targets.length === 0 && !changes.some((change) => change.rescan)) {
      await this.refreshTargets();
      targets = this.changedTargets(changes);
    }
    await Promise.all(targets.map((target) => this.discover(target, undefined, true)));
  }

  private changedTargets(changes: { path: string; rescan: boolean; broad?: boolean }[]): RunTarget[] {
    const selected = new Map<string, RunTarget>();
    for (const change of changes) {
      if (change.broad) {
        for (const target of this.targets) {
          selected.set(target.id, target);
        }
        continue;
      }
      const knownOwners = change.rescan ? [] : this.knownOwnersForFile(change.path);
      for (const target of targetsForChangedPath(this.targets, change.path, change.rescan, knownOwners)) {
        selected.set(target.id, target);
      }
    }
    return [...selected.values()];
  }

  private async discoverScoped(
    target: RunTarget,
    scopeFile: string | undefined,
    callerToken: vscode.CancellationToken | undefined,
    force: boolean,
  ): Promise<DiscoveredConfig | undefined> {
    if (this.disposed || callerToken?.isCancellationRequested || !this.isCurrentTarget(target)) {
      return undefined;
    }
    if (force) {
      const scope = scopeFile ? path.normalize(scopeFile) : '<full>';
      const forced = this.forcedDiscoveries.run(target.id, scope, async () => {
        if (this.disposed || !this.isCurrentTarget(target)) {
          return undefined;
        }
        // Each force starts a new generation only after the preceding force
        // for this target has settled. This still supersedes ordinary stale
        // work without allowing overlapping refreshes to cancel each other.
        this.invalidateTarget(target.id);
        return this.discoverScoped(target, scopeFile, undefined, false);
      });
      return waitForCaller(forced, callerToken);
    }
    const cache = scopeFile ? this.fileCache : this.cache;
    const inflight = scopeFile ? this.fileInflight : this.inflight;
    const key = discoveryKey(target.id, scopeFile);
    if (!force) {
      const cached = cache.get(key);
      if (cached) {
        return cached;
      }
      if (this.cliErrors.has(target.id) || this.unsupported.has(target.id)) {
        return undefined;
      }
      if (scopeFile ? this.fileErrors.has(key) : this.errors.has(target.id)) {
        return undefined;
      }
    }
    const existing = inflight.get(key);
    if (existing) {
      return waitForCaller(existing, callerToken);
    }

    const revision = this.targetRevisions.get(target.id) ?? 0;
    const cancellation = this.cancellationForTarget(target.id);
    const task = this.limiter.run(() => this.doDiscover(target, scopeFile, revision, cancellation.token));
    const tracked = task.finally(() => {
      if (inflight.get(key) === tracked) {
        inflight.delete(key);
      }
    });
    inflight.set(key, tracked);
    return waitForCaller(tracked, callerToken);
  }

  private async doDiscover(
    target: RunTarget,
    scopeFile: string | undefined,
    revision: number,
    token: vscode.CancellationToken,
  ): Promise<DiscoveredConfig | undefined> {
    if (!this.canCommit(target, revision, token)) {
      return undefined;
    }
    const startedAt = Date.now();
    const args = buildDiscoveryArguments({
      configFile: target.configFile,
      cwd: target.cwd,
      files: scopeFile ? [scopeFile] : undefined,
    });
    const key = discoveryKey(target.id, scopeFile);
    let cliVersion = this.versions.get(target.id);
    if (!this.unsupported.has(target.id)) {
      const probe = cliVersion
        ? { output: cliVersion, ok: true, timedOut: false }
        : await this.probeVersion(target, token);
      if (!this.canCommit(target, revision, token)) {
        return undefined;
      }
      if (!probe.ok) {
        const message = probe.timedOut
          ? this.sanitize(
            target,
            `Playwright CLI version check timed out after ${CLI_PROBE_TIMEOUT_SECONDS} seconds for ${target.configDir}. (tried: ${commandPreview(target, [])})`,
          )
          : this.sanitize(
            target,
            `Playwright CLI not found for ${target.configDir}. Install @playwright/test locally or set playwrightCodeLensRunner.cli.executable. (tried: ${commandPreview(target, [])})`,
          );
        this.cliErrors.set(target.id, message);
        this.recordDiagnostics(target, startedAt, cliVersion, args, scopeFile, [], message);
        this.emitter.fire({ target, error: message });
        return undefined;
      }
      cliVersion = probe.output;
      this.versions.set(target.id, cliVersion);
      this.cliErrors.delete(target.id);
      if (!isSupportedPlaywrightVersion(probe.output)) {
        const message = this.sanitize(target, `Playwright Test >= 1.38 is required (detected: ${probe.output}).`);
        this.unsupported.set(target.id, message);
        this.recordDiagnostics(target, startedAt, cliVersion, args, scopeFile, [], message);
        this.emitter.fire({ target, error: message });
        return undefined;
      }
    } else {
      const message = this.unsupported.get(target.id);
      this.recordDiagnostics(target, startedAt, cliVersion, args, scopeFile, [], message);
      this.emitter.fire({ target, error: message });
      return undefined;
    }

    let stdout = '';
    let stderr = '';
    const running = spawnCommand(target.cli, args, {
      cwd: target.cwd,
      env: target.env,
      cancellation: token,
      timeoutMs: TEST_DISCOVERY_TIMEOUT_MS,
      onStdout: (t) => (stdout += t),
      onStderr: (t) => (stderr += t),
    });
    const result = await running.outcome;
    if (result.cancelled || !this.canCommit(target, revision, token)) {
      return undefined;
    }
    if (result.timedOut) {
      const message = this.sanitize(
        target,
        `Playwright test discovery timed out after ${TEST_DISCOVERY_TIMEOUT_MS / 1000} seconds for ${scopeFile ?? target.configDir}.`,
      );
      if (scopeFile) {
        this.fileErrors.set(key, message);
      } else {
        this.errors.set(target.id, message);
      }
      this.recordDiagnostics(target, startedAt, cliVersion, args, scopeFile, [], message);
      this.emitter.fire({ target, error: message });
      return undefined;
    }
    const model = parseDiscoveryOutput(stdout, {
      id: target.id,
      cwd: target.cwd,
      configFile: target.configFile,
    });
    if (
      scopeFile
      && result.exitCode !== 0
      && model.files.length === 0
      && isBenignNoTestsFailure(stderr, model.errors)
    ) {
      // Ownership probing expects most candidate configs not to include the
      // file. Cache that negative result instead of treating it as target
      // failure and re-running it on every CodeLens refresh.
      model.errors = [];
      this.fileCache.set(key, model);
      this.fileErrors.delete(key);
      this.recordDiagnostics(target, startedAt, cliVersion, args, scopeFile, model.projects, undefined);
      this.emitter.fire({ target, model });
      return model;
    }
    if (result.exitCode !== 0 && model.files.length === 0) {
      const message = this.sanitize(target, stderr.trim() || model.errors.join('\n') || `Playwright discovery failed (exit code ${result.exitCode}).`);
      if (scopeFile) {
        this.fileErrors.set(key, message);
      } else {
        this.errors.set(target.id, message);
      }
      this.recordDiagnostics(target, startedAt, cliVersion, args, scopeFile, model.projects, message);
      this.emitter.fire({ target, error: message });
      return undefined;
    }
    const modelErrors = model.errors.map((error) => this.sanitize(target, error));
    model.errors = modelErrors;
    const modelError = modelErrors.join('\n') || undefined;
    if (scopeFile) {
      this.fileCache.set(key, model);
      updateError(this.fileErrors, key, modelError);
    } else {
      this.cache.set(target.id, model);
      updateError(this.errors, target.id, modelError);
    }
    this.recordDiagnostics(target, startedAt, cliVersion, args, scopeFile, model.projects, modelError);
    this.emitter.fire({ target, model, error: modelError });
    return model;
  }

  private rankTargetsForPath(targets: readonly RunTarget[], fsPath: string): RunTarget[] {
    return rankDiscoveryTargets(targets, fsPath, (target) => ({
      id: target.id,
      configDir: target.configDir,
      workspaceDir: target.workspaceFolder.uri.fsPath,
      cachedRootDir: this.cachedRootDirFor(target, fsPath),
    }));
  }

  private cachedRootDirFor(target: RunTarget, fsPath: string): string | undefined {
    return this.fileCache.get(discoveryKey(target.id, fsPath))?.rootDir
      ?? this.cache.get(target.id)?.rootDir;
  }

  private knownOwnersForFile(fsPath: string): RunTarget[] {
    const normalized = path.normalize(fsPath);
    const selected = new Map<string, RunTarget>();
    const stored = this.context.workspaceState.get<string>(configOwnerKey(fsPath));
    for (const target of this.targets) {
      if (target.id === stored) {
        selected.set(target.id, target);
      }
      const scoped = this.fileCache.get(discoveryKey(target.id, normalized));
      const complete = this.cache.get(target.id);
      if (scoped ? modelContainsFile(scoped, normalized) : modelContainsFile(complete, normalized)) {
        selected.set(target.id, target);
      }
    }
    return [...selected.values()];
  }

  private probeVersion(
    target: RunTarget,
    token: vscode.CancellationToken,
  ): Promise<{ output: string; ok: boolean; timedOut: boolean }> {
    const existing = this.versionInflight.get(target.id);
    if (existing) {
      return existing;
    }
    const probe = probeCliVersion(target.cli, target.cwd, target.env, token).finally(() => {
      if (this.versionInflight.get(target.id) === probe) {
        this.versionInflight.delete(target.id);
      }
    });
    this.versionInflight.set(target.id, probe);
    return probe;
  }

  private isCurrentTarget(target: RunTarget): boolean {
    const current = this.targets.find((candidate) => candidate.id === target.id);
    if (current) {
      return targetFingerprint(current) === targetFingerprint(target);
    }
    // Discovery is part of the exported API, so callers may supply an ad-hoc
    // target (for example, to diagnose an explicit CLI). Removed/stale target
    // IDs remain rejected until target discovery sees them again.
    return !this.retiredTargetIds.has(target.id);
  }

  private canCommit(target: RunTarget, revision: number, token: vscode.CancellationToken): boolean {
    return !this.disposed
      && !token.isCancellationRequested
      && (this.targetRevisions.get(target.id) ?? 0) === revision
      && this.isCurrentTarget(target);
  }

  private cancellationForTarget(targetId: string): vscode.CancellationTokenSource {
    let source = this.targetCancellation.get(targetId);
    if (!source) {
      source = new vscode.CancellationTokenSource();
      this.targetCancellation.set(targetId, source);
    }
    return source;
  }

  private invalidateTarget(targetId: string, retire = false): void {
    if (retire) {
      this.retiredTargetIds.add(targetId);
    }
    this.targetRevisions.set(targetId, (this.targetRevisions.get(targetId) ?? 0) + 1);
    const cancellation = this.targetCancellation.get(targetId);
    cancellation?.cancel();
    cancellation?.dispose();
    this.targetCancellation.delete(targetId);

    this.cache.delete(targetId);
    this.errors.delete(targetId);
    this.cliErrors.delete(targetId);
    this.unsupported.delete(targetId);
    this.versions.delete(targetId);
    this.versionInflight.delete(targetId);
    this.latestDiagnosticKeys.delete(targetId);
    this.inflight.delete(targetId);
    for (const key of [...this.fileCache.keys()]) {
      if (targetIdFromDiscoveryKey(key) === targetId) {
        this.fileCache.delete(key);
      }
    }
    for (const key of [...this.fileErrors.keys()]) {
      if (targetIdFromDiscoveryKey(key) === targetId) {
        this.fileErrors.delete(key);
      }
    }
    for (const key of [...this.fileInflight.keys()]) {
      if (targetIdFromDiscoveryKey(key) === targetId) {
        this.fileInflight.delete(key);
      }
    }
    for (const key of [...this.diagnostics.keys()]) {
      if (targetIdFromDiscoveryKey(key) === targetId) {
        this.diagnostics.delete(key);
      }
    }
  }

  private invalidateAllTargets(clearTargets: boolean): void {
    if (clearTargets) {
      this.targetRefreshSequence++;
    }
    const ids = new Set<string>([
      ...this.targets.map((target) => target.id),
      ...this.cache.keys(),
      ...this.errors.keys(),
      ...this.cliErrors.keys(),
      ...this.unsupported.keys(),
      ...this.versions.keys(),
      ...this.versionInflight.keys(),
      ...this.latestDiagnosticKeys.keys(),
      ...this.targetCancellation.keys(),
      ...this.inflight.keys(),
      ...[...this.fileCache.keys()].map(targetIdFromDiscoveryKey),
      ...[...this.fileErrors.keys()].map(targetIdFromDiscoveryKey),
      ...[...this.fileInflight.keys()].map(targetIdFromDiscoveryKey),
      ...[...this.diagnostics.keys()].map(targetIdFromDiscoveryKey),
    ]);
    for (const id of ids) {
      this.invalidateTarget(id, clearTargets);
    }
    if (clearTargets) {
      this.targets = [];
      for (const disposable of this.targetConfigWatcherDisposables.splice(0)) {
        disposable.dispose();
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.pendingRefreshes.clear();
    this.invalidateAllTargets(true);
    this.limiter.dispose();
    for (const disposable of this.testWatcherDisposables.splice(0)) {
      disposable.dispose();
    }
    for (const disposable of this.targetConfigWatcherDisposables.splice(0)) {
      disposable.dispose();
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.output.dispose();
    this.emitter.dispose();
  }

  private recordDiagnostics(
    target: RunTarget,
    startedAt: number,
    cliVersion: string | undefined,
    args: string[],
    scopeFile: string | undefined,
    projects: string[],
    error: string | undefined,
  ): void {
    const sanitize = (value: string | undefined) => value === undefined ? undefined : this.sanitize(target, value);
    const diagnostic: DiscoveryDiagnostics = {
      targetId: this.sanitize(target, target.id),
      startedAt,
      durationMs: Date.now() - startedAt,
      cwd: this.sanitize(target, target.cwd),
      configFile: sanitize(target.configFile),
      cliVersion: sanitize(cliVersion),
      projects: projects.map((project) => this.sanitize(target, project)),
      commandPreview: commandPreview(target, args),
      scopeFile: sanitize(scopeFile),
      error: sanitize(error),
    };
    const key = discoveryKey(target.id, scopeFile);
    this.diagnostics.set(key, diagnostic);
    this.latestDiagnosticKeys.set(target.id, key);
    this.appendDiagnostic(diagnostic);
  }

  private appendDiagnostic(diagnostic: DiscoveryDiagnostics): void {
    this.output.appendLine(`[${new Date(diagnostic.startedAt).toISOString()}] Discovery${diagnostic.scopeFile ? ` for ${diagnostic.scopeFile}` : ''}`);
    this.output.appendLine(`  Config: ${diagnostic.configFile ?? '(none)'}`);
    this.output.appendLine(`  CWD: ${diagnostic.cwd}`);
    this.output.appendLine(`  CLI version: ${diagnostic.cliVersion ?? '(unavailable)'}`);
    this.output.appendLine(`  Projects: ${diagnostic.projects.length > 0 ? diagnostic.projects.join(', ') : '(none reported)'}`);
    this.output.appendLine(`  Duration: ${diagnostic.durationMs} ms`);
    this.output.appendLine(`  Command: ${diagnostic.commandPreview}`);
    if (diagnostic.error) {
      this.output.appendLine(`  Error: ${diagnostic.error}`);
    }
  }

  private sanitize(target: RunTarget, text: string): string {
    let sanitized = redactSensitiveText(text);
    for (const value of Object.values(target.env)) {
      if (value.length > 0) {
        sanitized = sanitized.split(value).join('<redacted>');
      }
    }
    return sanitized;
  }
}

async function runWithConcurrency<T>(items: readonly T[], limit: number, task: (item: T) => Promise<unknown>): Promise<void> {
  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < items.length) {
      const current = items[index++];
      if (current !== undefined) {
        await task(current);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

function configOwnerKey(fsPath: string): string {
  return `playwrightCodeLensRunner.configOwner:${path.normalize(fsPath)}`;
}

function discoveryKey(targetId: string, scopeFile?: string): string {
  return scopeFile ? `${targetId}\0${path.normalize(scopeFile)}` : targetId;
}

function targetIdFromDiscoveryKey(key: string): string {
  const separator = key.indexOf('\0');
  return separator === -1 ? key : key.slice(0, separator);
}

function modelContainsFile(model: DiscoveredConfig | undefined, normalizedFile: string): boolean {
  return Boolean(model?.files.some((file) => path.normalize(file.file) === normalizedFile));
}

function updateError(map: Map<string, string>, key: string, error: string | undefined): void {
  if (error) {
    map.set(key, error);
  } else {
    map.delete(key);
  }
}

function targetFingerprint(target: RunTarget): string {
  return JSON.stringify({
    id: target.id,
    workspaceFolder: target.workspaceFolder.uri.toString(),
    configFile: target.configFile,
    configDir: target.configDir,
    cwd: target.cwd,
    cli: target.cli,
    env: Object.entries(target.env).sort(([a], [b]) => a.localeCompare(b)),
    runOptions: target.runOptions,
  });
}

function targetLabelForResolver(target: RunTarget): string {
  return target.configFile
    ? path.basename(target.configFile)
    : `${path.basename(target.configDir)} (no config)`;
}

function targetDescriptionForResolver(target: RunTarget): string {
  const base = target.configFile ?? target.configDir;
  const relative = path.relative(target.workspaceFolder.uri.fsPath, base);
  return `${target.workspaceFolder.name}: ${relative || '.'}`;
}

function commandPreview(target: RunTarget, args: string[]): string {
  return sanitizeCommandArguments(target, [target.cli.executable, ...target.cli.argsPrefix, ...args])
    .map(shellQuote)
    .join(' ');
}

const SENSITIVE_OPTION = /^(--?|\/)(password|passwd|token|secret|api[_-]?key|authorization|cookie)(?:=(.*))?$/i;

function sanitizeCommandArguments(target: RunTarget, args: readonly string[]): string[] {
  const result: string[] = [];
  let redactNext = false;
  for (const argument of args) {
    if (redactNext) {
      result.push('<redacted>');
      redactNext = false;
      continue;
    }
    const sensitive = SENSITIVE_OPTION.exec(argument);
    if (sensitive) {
      if (sensitive[3] !== undefined) {
        result.push(`${sensitive[1]}${sensitive[2]}=<redacted>`);
      } else {
        result.push(argument);
        redactNext = true;
      }
      continue;
    }
    let sanitized = argument;
    for (const value of Object.values(target.env)) {
      if (value.length > 0) {
        sanitized = sanitized.split(value).join('<redacted>');
      }
    }
    result.push(sanitized);
  }
  return result;
}

function redactSensitiveText(text: string): string {
  return text.replace(
    /((?:--?|\/)(?:password|passwd|token|secret|api[_-]?key|authorization|cookie)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi,
    '$1<redacted>',
  );
}

function shellQuote(argument: string): string {
  return /^[a-zA-Z0-9_./:=+@%-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForCaller<T>(task: Promise<T>, token?: vscode.CancellationToken): Promise<T | undefined> {
  if (!token) {
    return task;
  }
  if (token.isCancellationRequested) {
    return Promise.resolve(undefined);
  }
  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false;
    const cancellation = token.onCancellationRequested(() => {
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    });
    void task.then(
      (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    ).finally(() => cancellation.dispose());
  });
}

class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<{
    task: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private disposed = false;

  constructor(private readonly limit: number) {}

  run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (this.disposed) {
      return Promise.resolve(undefined);
    }
    return new Promise<T | undefined>((resolve, reject) => {
      this.queue.push({
        task,
        resolve: (value) => resolve(value as T | undefined),
        reject,
      });
      this.pump();
    });
  }

  private pump(): void {
    while (!this.disposed && this.active < this.limit && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) {
        return;
      }
      this.active++;
      void entry.task()
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.queue.splice(0)) {
      entry.resolve(undefined);
    }
  }
}
