import * as path from 'path';
import * as vscode from 'vscode';
import { ForcedInspectorBrowser, resolveInspectorBrowser } from './core/inspectorBrowser';
import { EditorTestSelection, editorSelectionsForFile } from './core/editorSelections';
import {
  buildDebugArguments,
  buildUiArguments,
} from './core/runArguments';
import { cliSelectionForEditor } from './core/selectionArguments';
import { environmentForCli } from './core/cliResolution';
import { quoteForTerminal } from './core/terminalQuote';
import { DiscoveryService } from './discoveryService';
import { OfficialPlaywrightBridge } from './officialPlaywrightBridge';
import { ProjectPicker } from './projectPicker';
import { RunTarget, targetLabel } from './runTarget';
import { Settings } from './settings';

export interface CommandDeps {
  context: vscode.ExtensionContext;
  discovery: DiscoveryService;
  bridge: OfficialPlaywrightBridge;
  projects: ProjectPicker;
}

export function registerCommands(deps: CommandDeps): void {
  const { context } = deps;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const register = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register('playwrightCodeLensRunner.refreshTests', async () => {
    await Promise.all([deps.bridge.refresh(), deps.discovery.refreshAll()]);
  });
  register('playwrightCodeLensRunner.configureProjects', () => deps.projects.configure());
  register('playwrightCodeLensRunner.openOfficialSettings', () => deps.bridge.openOfficialSettings());
  register('playwrightCodeLensRunner.rerunLast', () => deps.bridge.rerunLast());

  register('playwrightCodeLensRunner.runTest', (selection?: EditorTestSelection) => delegatedTestCommand(deps, selection, 'run'));
  register('playwrightCodeLensRunner.debugTest', (selection?: EditorTestSelection) => delegatedTestCommand(deps, selection, 'debug'));
  register('playwrightCodeLensRunner.runFile', (arg?: EditorTestSelection | vscode.Uri) => delegatedFileCommand(deps, arg, 'run'));
  register('playwrightCodeLensRunner.debugFile', (arg?: EditorTestSelection | vscode.Uri) => delegatedFileCommand(deps, arg, 'debug'));
  register('playwrightCodeLensRunner.inspectTest', (arg?: EditorTestSelection | vscode.Uri) => interactiveCliCommand(deps, arg, 'debug'));
  register('playwrightCodeLensRunner.openUi', (arg?: EditorTestSelection | vscode.Uri) => interactiveCliCommand(deps, arg, 'ui'));
  register('playwrightCodeLensRunner.more', (selection?: EditorTestSelection) => moreCommand(deps, selection));
  register('playwrightCodeLensRunner.pickCase', (selection?: EditorTestSelection) => pickCaseCommand(deps, selection));
  register('playwrightCodeLensRunner.showDiscoveryDetails', (selection?: EditorTestSelection) => showDiscoveryDetailsCommand(deps, selection));
  register('playwrightCodeLensRunner.retryDiscovery', (selection?: EditorTestSelection) => retryDiscoveryCommand(deps, selection));
  register('playwrightCodeLensRunner.selectConfig', (selection?: EditorTestSelection) => selectConfigCommand(deps, selection));

  register('playwrightCodeLensRunner.showReport', () => showReportCommand(deps));
  register('playwrightCodeLensRunner.showTrace', (uri?: vscode.Uri) => showTraceCommand(deps, uri));
  register('playwrightCodeLensRunner.recordTest', (uri?: vscode.Uri) => recordTestCommand(deps, uri));
}

async function delegatedTestCommand(
  deps: CommandDeps,
  selection: EditorTestSelection | undefined,
  mode: 'run' | 'debug',
): Promise<void> {
  if (isEditorSelection(selection)) {
    await deps.bridge.run(selection, mode);
    return;
  }
  await deps.bridge.runAtActiveCursor(mode);
}

async function delegatedFileCommand(
  deps: CommandDeps,
  arg: EditorTestSelection | vscode.Uri | undefined,
  mode: 'run' | 'debug',
): Promise<void> {
  if (isEditorSelection(arg)) {
    await deps.bridge.run({ ...arg, kind: 'file', position: { line: 0, character: 0 }, fullTitle: undefined }, mode);
    return;
  }
  const uri = isUri(arg) ? arg : vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    void vscode.window.showInformationMessage('Open a Playwright test file first.');
    return;
  }
  await deps.bridge.runUri(uri, mode);
}

async function interactiveCliCommand(
  deps: CommandDeps,
  arg: EditorTestSelection | vscode.Uri | undefined,
  mode: 'debug' | 'ui',
): Promise<void> {
  const selection = isEditorSelection(arg)
    ? arg
    : isUri(arg)
      ? await fileSelectionForUri(deps, arg)
      : await selectionAtCursor(deps);
  if (!selection) {
    void vscode.window.showInformationMessage('No Playwright test found at the current position.');
    return;
  }

  const target = await targetForSelection(deps, selection);
  if (!target) {
    return;
  }
  let projects = await deps.projects.getProjects(target);
  let browser: ForcedInspectorBrowser | undefined;
  if (mode === 'debug') {
    const preference = new Settings(vscode.Uri.file(selection.file)).inspectorBrowser;
    const model = preference === 'config'
      ? deps.discovery.cachedModel(target.id)
      : deps.discovery.cachedModel(target.id) ?? await deps.discovery.discover(target);
    const resolved = resolveInspectorBrowser(preference, projects, model?.projects);
    if (resolved.error) {
      void vscode.window.showErrorMessage(
        `${resolved.error} Choose "config" in playwrightCodeLensRunner.inspector.browser or add the matching project.`,
      );
      return;
    }
    projects = resolved.projects;
    browser = resolved.browser;
  }
  const runSelection = cliSelectionForEditor(selection);
  const options = {
    browser,
    configFile: target.configFile,
    cwd: target.cwd,
    projects,
    extraOptions: target.runOptions,
  };
  const args = mode === 'debug'
    ? buildDebugArguments(runSelection, options)
    : buildUiArguments(runSelection, options);
  const label = mode === 'debug' ? 'Playwright Inspector' : 'Playwright UI';
  runInTerminal(target, `${label}: ${path.basename(selection.file)}`, args);
}

async function moreCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const resolved = selection ?? await selectionAtCursor(deps);
  if (!resolved) {
    void vscode.window.showInformationMessage('No Playwright selection found at the current position.');
    return;
  }
  const choices = [
    { label: '$(play) Run', description: 'Microsoft Testing', action: 'run' as const },
    { label: '$(debug) Debug', description: 'Microsoft Testing', action: 'debug' as const },
    ...(resolved.kind === 'file' ? [] : [{ label: '$(eye) Inspect', description: 'Companion CLI', action: 'inspect' as const }]),
    { label: '$(browser) Playwright UI', description: 'Companion CLI', action: 'ui' as const },
    ...(resolved.kind === 'test' && (resolved.titlePaths?.length ?? 0) > 1
      ? [{ label: `Cases (${resolved.titlePaths?.length ?? 0})…`, action: 'case' as const }]
      : []),
    ...(resolved.kind === 'file' ? [{ label: '$(settings-gear) Select CLI Config', action: 'config' as const }] : []),
  ];
  const picked = await vscode.window.showQuickPick(choices, { title: 'Playwright actions' });
  if (!picked) {
    return;
  }
  if (picked.action === 'run') {
    await delegatedTestCommand(deps, resolved, 'run');
  } else if (picked.action === 'debug') {
    await delegatedTestCommand(deps, resolved, 'debug');
  } else if (picked.action === 'inspect') {
    await interactiveCliCommand(deps, resolved, 'debug');
  } else if (picked.action === 'ui') {
    await interactiveCliCommand(deps, resolved, 'ui');
  } else if (picked.action === 'case') {
    await pickCaseCommand(deps, resolved);
  } else {
    await selectConfigCommand(deps, resolved);
  }
}

async function pickCaseCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const resolved = selection ?? await selectionAtCursor(deps);
  if (!resolved || resolved.kind !== 'test' || (resolved.titlePaths?.length ?? 0) <= 1) {
    void vscode.window.showInformationMessage('This selection has no generated cases to choose from.');
    return;
  }
  const exact = await chooseExactCase(resolved);
  if (!exact) {
    return;
  }
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(eye) Inspect exact case', mode: 'debug' as const },
      { label: '$(browser) Open exact case in Playwright UI', mode: 'ui' as const },
    ],
    { title: 'Run selected generated case with' },
  );
  if (action) {
    await interactiveCliCommand(deps, exact, action.mode);
  }
}

async function chooseExactCase(selection: EditorTestSelection): Promise<EditorTestSelection | undefined> {
  const cases = selection.titlePaths ?? [];
  const picked = await vscode.window.showQuickPick(
    cases.map((titlePath, index) => ({
      label: titlePath.join(' › '),
      description: `Case ${index + 1} of ${cases.length}`,
      titlePath,
    })),
    {
      title: `Select an exact generated case (${cases.length})`,
      matchOnDescription: true,
    },
  );
  if (!picked) {
    return undefined;
  }
  return {
    ...selection,
    fullTitle: picked.titlePath.join(' '),
    titlePath: picked.titlePath,
    titlePaths: [picked.titlePath],
  };
}

async function retryDiscoveryCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const scope = await targetScopeForCommand(deps, selection, 'Retry discovery for which Playwright CLI config?');
  if (!scope) {
    return;
  }
  const { target, file } = scope;
  try {
    const model = file
      ? await deps.discovery.discoverForFile(target, file, undefined, true)
      : await deps.discovery.discover(target, undefined, true);
    if (model) {
      void vscode.window.showInformationMessage(`Playwright discovery refreshed for ${targetLabel(target)}.`);
      return;
    }
    void vscode.window.showErrorMessage(
      deps.discovery.errorFor(target.id, file) ?? `Playwright discovery produced no tests for ${targetLabel(target)}.`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Playwright discovery failed: ${errorMessage(error)}`);
  }
}

async function showDiscoveryDetailsCommand(
  deps: CommandDeps,
  selection: EditorTestSelection | undefined,
): Promise<void> {
  const scope = await targetScopeForCommand(deps, selection, 'Show discovery details for which Playwright CLI config?');
  if (!scope) {
    return;
  }
  const { target, file } = scope;
  deps.discovery.showDiagnostics(target.id, file);
  if (!deps.discovery.diagnosticsFor(target.id, file)) {
    void vscode.window.showInformationMessage(`No discovery attempt has been recorded for ${targetLabel(target)} yet.`);
  }
}

async function selectConfigCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const uri = selection ? vscode.Uri.parse(selection.uri) : vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    void vscode.window.showInformationMessage('Open a Playwright test file first.');
    return;
  }
  await deps.discovery.selectTargetForFile(uri.fsPath);
}

async function showReportCommand(deps: CommandDeps): Promise<void> {
  const target = await pickTarget(deps, 'Show HTML report for which Playwright config?');
  if (target) {
    runInTerminal(target, 'Playwright Report', ['show-report']);
  }
}

async function showTraceCommand(deps: CommandDeps, uri: vscode.Uri | undefined): Promise<void> {
  let zip = uri;
  if (!zip) {
    const picked = await vscode.window.showOpenDialog({
      filters: { 'Playwright Trace': ['zip'] },
      canSelectMany: false,
      title: 'Select a Playwright trace',
    });
    zip = picked?.[0];
  }
  if (!zip) {
    return;
  }
  const target = await deps.discovery.nearestTargetForPath(zip.fsPath)
    ?? await pickTarget(deps, 'Show trace with which Playwright config?');
  if (target) {
    runInTerminal(target, 'Playwright Trace', ['show-trace', zip.fsPath]);
  }
}

async function recordTestCommand(deps: CommandDeps, folder: vscode.Uri | undefined): Promise<void> {
  const target = folder
    ? await deps.discovery.nearestTargetForPath(folder.fsPath) ?? await pickTarget(deps)
    : await pickTarget(deps);
  if (!target) {
    return;
  }
  const directory = folder?.fsPath ?? target.configDir;
  let filename = 'sample.spec.ts';
  let counter = 0;
  const fs = await import('fs');
  while (fs.existsSync(path.join(directory, filename))) {
    filename = `sample${++counter}.spec.ts`;
  }
  const input = await vscode.window.showInputBox({
    prompt: 'Filename for the recorded test',
    value: filename,
    placeHolder: 'e.g. sample.spec.ts',
    valueSelection: [0, filename.indexOf('.spec')],
  });
  if (input) {
    runInTerminal(target, 'Playwright Codegen', ['codegen', '--output', path.join(directory, input)]);
  }
}

function runInTerminal(target: RunTarget, name: string, args: string[]): void {
  const terminal = vscode.window.createTerminal({
    name,
    cwd: target.cwd,
    env: environmentForCli(target.cli, target.env),
  });
  terminal.sendText(quoteForTerminal(target.cli.executable, [...target.cli.argsPrefix, ...args]));
  terminal.show(true);
}

async function selectionAtCursor(deps: CommandDeps): Promise<EditorTestSelection | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const target = await targetForFile(deps, editor.document.uri.fsPath, { silent: true });
  if (!target) {
    return undefined;
  }
  const model = await deps.discovery.discover(target);
  if (!model) {
    return undefined;
  }
  const selections = editorSelectionsForFile(model, editor.document.uri.fsPath, editor.document.uri.toString());
  const cursor = editor.selection.active;
  let best = selections.find((selection) => selection.kind === 'file');
  for (const selection of selections) {
    if (selection.kind === 'file') {
      continue;
    }
    const position = new vscode.Position(selection.position.line, selection.position.character);
    if (position.isAfter(cursor)) {
      continue;
    }
    if (!best || selection.position.line > best.position.line
      || (selection.position.line === best.position.line && selection.position.character >= best.position.character)) {
      best = selection;
    }
  }
  return best;
}

async function fileSelectionForUri(deps: CommandDeps, uri: vscode.Uri): Promise<EditorTestSelection | undefined> {
  const target = await targetForFile(deps, uri.fsPath);
  if (!target) {
    return undefined;
  }
  const model = await deps.discovery.discover(target);
  const discovered = model
    ? editorSelectionsForFile(model, uri.fsPath, uri.toString()).find((selection) => selection.kind === 'file')
    : undefined;
  return discovered ?? {
    kind: 'file',
    targetId: target.id,
    uri: uri.toString(),
    file: uri.fsPath,
    position: { line: 0, character: 0 },
  };
}

async function targetForSelection(deps: CommandDeps, selection: EditorTestSelection): Promise<RunTarget | undefined> {
  const targets = deps.discovery.currentTargets.length > 0
    ? deps.discovery.currentTargets
    : await deps.discovery.refreshTargets();
  return targets.find((target) => target.id === selection.targetId)
    ?? targetForFile(deps, selection.file);
}

async function targetScopeForCommand(
  deps: CommandDeps,
  selection: EditorTestSelection | undefined,
  title: string,
): Promise<{ target: RunTarget; file?: string } | undefined> {
  if (isEditorSelection(selection)) {
    const target = await targetForSelection(deps, selection);
    return target ? { target, file: selection.file } : undefined;
  }
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument && isConfiguredPlaywrightDocument(activeDocument)) {
    const activeUri = activeDocument.uri;
    const target = await targetForFile(deps, activeUri.fsPath, { silent: true });
    if (target) {
      return { target, file: activeUri.fsPath };
    }
  }
  const target = await pickTarget(deps, title);
  return target ? { target } : undefined;
}

function isConfiguredPlaywrightDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file'
    && vscode.languages.match(
      { scheme: 'file', pattern: new Settings(document.uri).codeLensPattern },
      document,
    ) > 0;
}

async function pickTarget(deps: CommandDeps, title = 'Select a Playwright config'): Promise<RunTarget | undefined> {
  const targets = deps.discovery.currentTargets.length > 0
    ? deps.discovery.currentTargets
    : await deps.discovery.refreshTargets();
  if (targets.length === 0) {
    void vscode.window.showInformationMessage('No Playwright configs found in this workspace.');
    return undefined;
  }
  if (targets.length === 1) {
    return targets[0];
  }
  const picked = await vscode.window.showQuickPick(
    targets.map((target) => ({ label: targetLabel(target), target })),
    { title },
  );
  return picked?.target;
}

async function targetForFile(
  deps: CommandDeps,
  fsPath: string,
  options: { silent?: boolean } = {},
): Promise<RunTarget | undefined> {
  const best = await deps.discovery.resolveTargetForFile(fsPath);
  if (!best && !options.silent) {
    void vscode.window.showInformationMessage('No Playwright configs found in this workspace.');
  }
  return best;
}

function isEditorSelection(value: EditorTestSelection | vscode.Uri | undefined): value is EditorTestSelection {
  return Boolean(
    value
    && typeof value === 'object'
    && 'kind' in value
    && 'targetId' in value
    && 'position' in value,
  );
}

function isUri(value: EditorTestSelection | vscode.Uri | undefined): value is vscode.Uri {
  return Boolean(value && typeof value === 'object' && 'scheme' in value && 'fsPath' in value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
