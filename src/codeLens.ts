import * as vscode from 'vscode';
import { parseTestFileAst } from './core/astParser';
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
class PlaywrightCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly runner?: CompanionCliRunner,
  ) {
    this.disposables.push(
      this.discovery.onDidDiscover(() => this.emitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SETTINGS_NAMESPACE}.codeLens`)) {
          this.emitter.fire();
        }
      }),
    );
    if (this.runner) {
      this.disposables.push(this.runner.onDidChange(() => this.emitter.fire()));
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

    const target = await this.targetForDocument(document.uri.fsPath, token);
    if (!target || token.isCancellationRequested) {
      return [];
    }

    let model = this.discovery.cachedModelForFile(target.id, document.uri.fsPath)
      ?? this.discovery.cachedModel(target.id);

    if (!model && settings.codeLensFastStaticDiscovery) {
      // Tier-1: Instant static AST discovery (<3ms). Renders immediately without layout shift!
      model = parseTestFileAst(document.getText(), document.uri.fsPath, {
        targetId: target.id,
        rootDir: target.configDir,
      });
      // Trigger background CLI discovery to enrich projects / dynamic cases
      void this.discovery.discoverForFile(target, document.uri.fsPath).then(() => {
        this.emitter.fire();
      }).catch(() => undefined);
    } else if (!model) {
      model = await this.discovery.discoverForFile(target, document.uri.fsPath, token);
    }

    if (!model || token.isCancellationRequested) {
      const error = this.discovery.errorFor(target.id, document.uri.fsPath);
      if (error) {
        const selection = fileSelection(target, document.uri.toString(), document.uri.fsPath);
        const range = rangeFor(selection);
        return [
          new vscode.CodeLens(range, {
            title: '$(warning) Discovery failed',
            command: 'playwrightCodeLensRunner.showDiscoveryDetails',
            arguments: [selection],
          }),
          new vscode.CodeLens(range, {
            title: 'Details',
            command: 'playwrightCodeLensRunner.showDiscoveryDetails',
            arguments: [selection],
          }),
          new vscode.CodeLens(range, {
            title: 'Retry',
            command: 'playwrightCodeLensRunner.retryDiscovery',
            arguments: [selection],
          }),
          new vscode.CodeLens(range, {
            title: 'Choose CLI Config…',
            command: 'playwrightCodeLensRunner.selectConfig',
            arguments: [selection],
          }),
        ];
      }
      return [];
    }

    // Full discovery supplies project metadata in the background while the
    // file-scoped result keeps this editor responsive in large workspaces.
    void this.discovery.discover(target).catch(() => undefined);

    const selections = editorSelectionsForFile(model, document.uri.fsPath, document.uri.toString());
    const lenses: vscode.CodeLens[] = [];
    for (const selection of selections) {
      const range = rangeFor(selection);
      if (selection.kind === 'test') {
        addTestStatusLens(lenses, range, selection, this.runner, settings);
      }
      addActions(lenses, range, selection, settings.codeLensActions(selection.kind), target, settings.codeLensDensity);
    }
    return lenses;
  }

  private async targetForDocument(fsPath: string, token: vscode.CancellationToken): Promise<RunTarget | undefined> {
    return this.discovery.resolveTargetForFile(fsPath, { prompt: false, token });
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
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
  const statusInfo = runner.testStatusFor(selection.file, selection.position.line, selection.titlePath);
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
