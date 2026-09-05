import * as vscode from 'vscode';
import { parseTestFileAst } from './core/astParser';
import { DiscoveredConfig } from './core/model';
import { CompanionCliRunner } from './companionRunner';
import { EditorTestSelection, editorSelectionsForFile } from './core/editorSelections';
import { DiscoveryService } from './discoveryService';
import { RunTarget, targetLabel as runTargetLabel } from './runTarget';
import { CodeLensAction, CodeLensDensity, SETTINGS_NAMESPACE, Settings } from './settings';

const TEST_DOCUMENTS: vscode.DocumentSelector = [
  { scheme: 'file', language: 'javascript' },
  { scheme: 'file', language: 'javascriptreact' },
  { scheme: 'file', language: 'typescript' },
  { scheme: 'file', language: 'typescriptreact' },
];

/**
 * Editor-first Playwright actions backed by fast AST and CLI discovery.
 * Run and Debug can be delegated to Microsoft's Playwright extension,
 * or promoted to companion CLI runs with live execution status.
 */
export class PlaywrightCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly documents = new Map<string, {
    version: number;
    targetId: string;
    staticModel?: DiscoveredConfig;
    model?: DiscoveredConfig;
    selections?: EditorTestSelection[];
  }>();
  private readonly ownership = new Map<string, Promise<RunTarget | undefined>>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly runner?: CompanionCliRunner,
  ) {
    this.disposables.push(
      this.discovery.onDidDiscover((event) => {
        if (!event.scopeFile || this.documents.has(vscode.Uri.file(event.scopeFile).toString())) {
          this.emitter.fire();
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.documents.delete(document.uri.toString());
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SETTINGS_NAMESPACE}.codeLens`)) {
          this.emitter.fire();
        }
      }),
    );
    if (this.runner) {
      this.disposables.push(this.runner.onDidChangeTests((event) => {
        if (!event.files || event.files.some((file) => this.documents.has(vscode.Uri.file(file).toString()))) {
          this.emitter.fire();
        }
      }));
    }
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const settings = new Settings(document.uri);
    if (
      !settings.codeLensEnabled
      || vscode.languages.match({ scheme: 'file', pattern: settings.codeLensPattern }, document) === 0
    ) {
      return [];
    }

    const version = document.version;
    const target = settings.codeLensFastStaticDiscovery
      ? await this.discovery.provisionalTargetForFile(document.uri.fsPath)
      : await this.discovery.resolveTargetForFile(document.uri.fsPath, { prompt: false, token });
    if (!target || token.isCancellationRequested || document.version !== version) {
      return [];
    }
    const uri = document.uri.toString();
    let cached = this.documents.get(uri);
    if (!cached || cached.version !== version || cached.targetId !== target.id) {
      cached = { version, targetId: target.id };
      this.documents.set(uri, cached);
    }
    let model = this.discovery.cachedModelForFile(target.id, document.uri.fsPath)
      ?? this.discovery.cachedModel(target.id);
    let source: 'ast' | 'cli' = 'cli';
    if (settings.codeLensFastStaticDiscovery && (document.isDirty || !model)) {
      cached.staticModel ??= parseTestFileAst(document.getText(), document.uri.fsPath, {
        targetId: target.id,
        rootDir: target.configDir,
      });
      model = cached.staticModel;
      source = 'ast';
    } else if (!model) {
      model = await this.discovery.discoverForFile(target, document.uri.fsPath, token);
    }
    if (token.isCancellationRequested || document.version !== version) {
      return [];
    }
    if (settings.codeLensFastStaticDiscovery && !this.ownership.has(uri)) {
      const task = this.discovery.resolveTargetForFile(document.uri.fsPath, { prompt: false }).catch(() => undefined);
      this.ownership.set(uri, task);
      void task.finally(() => {
        if (this.ownership.get(uri) === task) {
          this.ownership.delete(uri);
        }
      });
    }
    if (cached.model !== model) {
      cached.model = model;
      cached.selections = model ? editorSelectionsForFile(model, document.uri.fsPath, uri).map((selection) => ({
        ...selection, discoverySource: source, documentVersion: version,
      })) : [];
    }
    const selections = cached.selections ?? [];
    const lenses: vscode.CodeLens[] = [];
    for (const selection of selections) {
      const range = rangeFor(selection);
      if (selection.kind === 'test') {
        addTestStatusLens(lenses, range, selection, this.runner, settings);
      }
      addActions(lenses, range, selection, settings.codeLensActions(selection.kind), target, settings.codeLensDensity);
    }
    if (this.discovery.errorFor(target.id, document.uri.fsPath)) {
      const selection = fileSelection(target, uri, document.uri.fsPath);
      for (const [title, command] of [
        ['$(warning) Discovery failed', 'showDiscoveryDetails'],
        ['Details', 'showDiscoveryDetails'], ['Retry', 'retryDiscovery'], ['Choose CLI Config…', 'selectConfig'],
      ]) {
        lenses.push(new vscode.CodeLens(rangeFor(selection), {
          title, command: `playwrightCodeLensRunner.${command}`, arguments: [selection],
        }));
      }
    }
    return lenses;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.documents.clear();
    this.emitter.dispose();
  }
}

function addTestStatusLens(
  lenses: vscode.CodeLens[],
  range: vscode.Range,
  selection: EditorTestSelection,
  runner: CompanionCliRunner | undefined,
  settings: Settings,
): void {
  if (!runner) {
    return;
  }
  const statusInfo = runner.testStatusFor(selection.file, selection.position.line, selection.titlePath, selection.targetId, selection.position.character + 1, selection.titlePaths);
  if (!statusInfo) {
    return;
  }

  if (statusInfo.status === 'running' && settings.codeLensShowRunningStatus) {
    lenses.push(new vscode.CodeLens(range, {
      title: '$(sync~spin) Running…',
      command: 'playwrightCodeLensRunner.showCompanionOutput',
    }));
  } else if (statusInfo.status === 'passed' && settings.codeLensShowLastRunStatus) {
    const duration = statusInfo.durationMs !== undefined ? ` (${formatDuration(statusInfo.durationMs)})` : '';
    lenses.push(new vscode.CodeLens(range, {
      title: `$(pass) Passed${duration}`,
      command: 'playwrightCodeLensRunner.showCompanionOutput',
    }));
  } else if (statusInfo.status === 'failed' && settings.codeLensShowLastRunStatus) {
    if (statusInfo.failure) {
      lenses.push(new vscode.CodeLens(range, {
        title: '$(error) Failed (view failure)',
        command: 'playwrightCodeLensRunner.openFailure',
        arguments: [statusInfo.failure],
      }));
    } else {
      lenses.push(new vscode.CodeLens(range, {
        title: '$(error) Failed',
        command: 'playwrightCodeLensRunner.showCompanionOutput',
      }));
    }
  } else if (statusInfo.status === 'flaky' && settings.codeLensShowLastRunStatus) {
    lenses.push(new vscode.CodeLens(range, {
      title: '$(warning) Flaky',
      command: 'playwrightCodeLensRunner.showCompanionOutput',
    }));
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function addActions(
  lenses: vscode.CodeLens[],
  range: vscode.Range,
  selection: EditorTestSelection,
  actions: CodeLensAction[],
  target: RunTarget,
  density: CodeLensDensity = 'standard',
): void {
  for (const action of actions) {
    if (action === 'run') {
      const label = density === 'icon-only'
        ? '$(play)'
        : density === 'short'
          ? '$(play) Run'
          : selection.kind === 'file' ? '$(play) Run File' : `$(play) Run ${selection.kind === 'suite' ? 'Suite' : 'Test'}`;
      addLens(
        lenses,
        range,
        label,
        selection.kind === 'file' ? 'playwrightCodeLensRunner.runFile' : 'playwrightCodeLensRunner.runTest',
        selection,
      );
    } else if (action === 'debug') {
      const label = density === 'icon-only'
        ? '$(debug)'
        : density === 'short'
          ? '$(debug) Debug'
          : selection.kind === 'file' ? '$(debug) Debug File' : `$(debug) Debug ${selection.kind === 'suite' ? 'Suite' : 'Test'}`;
      addLens(
        lenses,
        range,
        label,
        selection.kind === 'file' ? 'playwrightCodeLensRunner.debugFile' : 'playwrightCodeLensRunner.debugTest',
        selection,
      );
    } else if (action === 'companionRun') {
      const label = density === 'icon-only'
        ? '$(play)'
        : density === 'short'
          ? '$(play) Run'
          : selection.kind === 'file'
            ? '$(play) Run Companion File'
            : `$(play) Run Companion ${selection.kind === 'suite' ? 'Suite' : 'Test'}`;
      addLens(lenses, range, label, 'playwrightCodeLensRunner.runCompanion', selection);
    } else if (action === 'flake') {
      const label = density === 'icon-only'
        ? '$(beaker)'
        : '$(beaker) Flake Lab';
      addLens(lenses, range, label, 'playwrightCodeLensRunner.flakeLab', selection);
    } else if (action === 'inspect' && selection.kind !== 'file') {
      const label = density === 'icon-only'
        ? '$(eye)'
        : density === 'short'
          ? '$(eye) Inspect'
          : `$(eye) Inspect ${selection.kind === 'suite' ? 'Suite' : 'Test'}`;
      addLens(
        lenses,
        range,
        label,
        'playwrightCodeLensRunner.inspectTest',
        selection,
      );
    } else if (action === 'ui') {
      const label = density === 'icon-only'
        ? '$(browser)'
        : density === 'short'
          ? '$(browser) UI'
          : '$(browser) Playwright UI';
      addLens(lenses, range, label, 'playwrightCodeLensRunner.openUi', selection);
    } else if (action === 'more') {
      const label = density === 'icon-only' ? '$(ellipsis)' : '$(ellipsis) More…';
      addLens(lenses, range, label, 'playwrightCodeLensRunner.more', selection);
    } else if (action === 'config' && selection.kind === 'file') {
      const label = density === 'icon-only'
        ? '$(settings-gear)'
        : `$(settings-gear) CLI Config: ${runTargetLabel(target)}`;
      addLens(
        lenses,
        range,
        label,
        'playwrightCodeLensRunner.selectConfig',
        selection,
      );
    } else if (action === 'cases' && selection.kind === 'test' && (selection.titlePaths?.length ?? 0) > 1) {
      addLens(
        lenses,
        range,
        `Cases (${selection.titlePaths?.length ?? 0})…`,
        'playwrightCodeLensRunner.pickCase',
        selection,
      );
    }
  }
}

export function registerCodeLensSupport(
  context: vscode.ExtensionContext,
  discovery: DiscoveryService,
  runner?: CompanionCliRunner,
): void {
  const provider = new PlaywrightCodeLensProvider(discovery, runner);
  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider(TEST_DOCUMENTS, provider),
  );
}

function rangeFor(selection: EditorTestSelection): vscode.Range {
  const position = new vscode.Position(selection.position.line, selection.position.character);
  return new vscode.Range(position, position);
}

function addLens(
  lenses: vscode.CodeLens[],
  range: vscode.Range,
  title: string,
  command: string,
  selection: EditorTestSelection,
): void {
  lenses.push(new vscode.CodeLens(range, { title, command, arguments: [selection] }));
}

function fileSelection(target: RunTarget, uri: string, file: string): EditorTestSelection {
  return {
    kind: 'file',
    targetId: target.id,
    uri,
    file,
    position: { line: 0, character: 0 },
  };
}
