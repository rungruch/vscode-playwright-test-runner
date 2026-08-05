import * as path from 'path';
import * as vscode from 'vscode';
import { EditorTestSelection, editorSelectionsForFile } from './core/editorSelections';
import { DiscoveryService } from './discoveryService';
import { RunTarget } from './runTarget';
import { Settings } from './settings';

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
export class PlaywrightCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly discovery: DiscoveryService) {
    this.disposables.push(
      this.discovery.onDidDiscover(() => this.emitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('playwrightCliRunner.codeLens') || event.affectsConfiguration('playwrightrunner')) {
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

    const target = await this.targetForDocument(document.uri.fsPath);
    if (!target || token.isCancellationRequested) {
      return [];
    }
    const model = await this.discovery.discover(target, token);
    if (!model || token.isCancellationRequested) {
      return [];
    }

    const selections = editorSelectionsForFile(model, document.uri.fsPath, document.uri.toString());
    const lenses: vscode.CodeLens[] = [];
    for (const selection of selections) {
      const range = rangeFor(selection);
      if (selection.kind === 'file') {
        addLens(lenses, range, '$(play) Run File', 'playwrightCliRunner.runFile', selection);
        addLens(lenses, range, '$(debug) Debug File', 'playwrightCliRunner.debugFile', selection);
        addLens(lenses, range, '$(browser) Playwright UI', 'playwrightCliRunner.openUi', selection);
        continue;
      }

      const label = selection.kind === 'suite' ? 'Suite' : 'Test';
      addLens(lenses, range, `$(play) Run ${label}`, 'playwrightCliRunner.runTest', selection);
      addLens(lenses, range, `$(debug) Debug ${label}`, 'playwrightCliRunner.debugTest', selection);
      addLens(lenses, range, `$(eye) Inspect ${label}`, 'playwrightCliRunner.inspectTest', selection);
      addLens(lenses, range, '$(browser) Playwright UI', 'playwrightCliRunner.openUi', selection);
    }
    return lenses;
  }

  private async targetForDocument(fsPath: string): Promise<RunTarget | undefined> {
    const targets = this.discovery.currentTargets.length > 0
      ? this.discovery.currentTargets
      : await this.discovery.refreshTargets();
    return targets
      .filter((target) => containsPath(target.configDir, fsPath))
      .sort((a, b) => b.configDir.length - a.configDir.length)[0];
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.emitter.dispose();
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

function containsPath(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
