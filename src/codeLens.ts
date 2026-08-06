import * as vscode from 'vscode';
import { EditorTestSelection, editorSelectionsForFile } from './core/editorSelections';
import { DiscoveryService } from './discoveryService';
import { RunTarget, targetLabel as runTargetLabel } from './runTarget';
import { CodeLensAction, SETTINGS_NAMESPACE, Settings } from './settings';

const TEST_DOCUMENTS: vscode.DocumentSelector = [
  { scheme: 'file', language: 'javascript' },
  { scheme: 'file', language: 'javascriptreact' },
  { scheme: 'file', language: 'typescript' },
  { scheme: 'file', language: 'typescriptreact' },
];

/**
 * Editor-first Playwright actions backed by CLI discovery. Run and Debug are
 * delegated to Microsoft's Playwright extension; Inspector and UI stay CLI
 * tools owned by this companion.
 */
class PlaywrightCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly discovery: DiscoveryService) {
    this.disposables.push(
      this.discovery.onDidDiscover(() => this.emitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SETTINGS_NAMESPACE}.codeLens`)) {
          this.emitter.fire();
        }
      }),
    );
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
    const model = await this.discovery.discoverForFile(target, document.uri.fsPath, token);
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
      if (selection.kind === 'file') {
        addActions(lenses, range, selection, settings.codeLensActions('file'), target);
        continue;
      }

      addActions(lenses, range, selection, settings.codeLensActions(selection.kind), target);
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

function addActions(
  lenses: vscode.CodeLens[],
  range: vscode.Range,
  selection: EditorTestSelection,
  actions: CodeLensAction[],
  target: RunTarget,
): void {
  for (const action of actions) {
    if (action === 'run') {
      addLens(
        lenses,
        range,
        selection.kind === 'file' ? '$(play) Run File' : `$(play) Run ${selection.kind === 'suite' ? 'Suite' : 'Test'}`,
        selection.kind === 'file' ? 'playwrightCodeLensRunner.runFile' : 'playwrightCodeLensRunner.runTest',
        selection,
      );
    } else if (action === 'debug') {
      addLens(
        lenses,
        range,
        selection.kind === 'file' ? '$(debug) Debug File' : `$(debug) Debug ${selection.kind === 'suite' ? 'Suite' : 'Test'}`,
        selection.kind === 'file' ? 'playwrightCodeLensRunner.debugFile' : 'playwrightCodeLensRunner.debugTest',
        selection,
      );
    } else if (action === 'inspect' && selection.kind !== 'file') {
      addLens(
        lenses,
        range,
        `$(eye) Inspect ${selection.kind === 'suite' ? 'Suite' : 'Test'}`,
        'playwrightCodeLensRunner.inspectTest',
        selection,
      );
    } else if (action === 'ui') {
      addLens(lenses, range, '$(browser) Playwright UI', 'playwrightCodeLensRunner.openUi', selection);
    } else if (action === 'more') {
      addLens(lenses, range, '$(ellipsis) More…', 'playwrightCodeLensRunner.more', selection);
    } else if (action === 'config' && selection.kind === 'file') {
      addLens(
        lenses,
        range,
        `$(settings-gear) CLI Config: ${runTargetLabel(target)}`,
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
): void {
  const provider = new PlaywrightCodeLensProvider(discovery);
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
