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
import { migrateSettings } from './migrate';
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

  register('playwrightCliRunner.refreshTests', async () => {
    await Promise.all([deps.bridge.refresh(), deps.discovery.refreshAll()]);
  });
  register('playwrightCliRunner.configureProjects', () => deps.projects.configure());
  register('playwrightCliRunner.openOfficialSettings', () => deps.bridge.openOfficialSettings());
  register('playwrightCliRunner.rerunLast', () => deps.bridge.rerunLast());
  register('playwrightCliRunner.migrateSettings', () => migrateSettings());

  register('playwrightCliRunner.runTest', (selection?: EditorTestSelection) => delegatedTestCommand(deps, selection, 'run'));
  register('playwrightCliRunner.debugTest', (selection?: EditorTestSelection) => delegatedTestCommand(deps, selection, 'debug'));
  register('playwrightCliRunner.runFile', (arg?: EditorTestSelection | vscode.Uri) => delegatedFileCommand(deps, arg, 'run'));
  register('playwrightCliRunner.debugFile', (arg?: EditorTestSelection | vscode.Uri) => delegatedFileCommand(deps, arg, 'debug'));
  register('playwrightCliRunner.inspectTest', (arg?: EditorTestSelection | vscode.Uri) => interactiveCliCommand(deps, arg, 'debug'));
  register('playwrightCliRunner.openUi', (arg?: EditorTestSelection | vscode.Uri) => interactiveCliCommand(deps, arg, 'ui'));

  register('playwrightCliRunner.showReport', () => showReportCommand(deps));
  register('playwrightCliRunner.showTrace', (uri?: vscode.Uri) => showTraceCommand(deps, uri));
  register('playwrightCliRunner.recordTest', (uri?: vscode.Uri) => recordTestCommand(deps, uri));
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
  const selection = await fileSelectionForUri(deps, uri);
  if (selection) {
    await deps.bridge.run(selection, mode);
  }
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
        `${resolved.error} Choose "config" in playwrightCliRunner.inspector.browser or add the matching project.`,
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
  const target = await targetForFile(deps, zip.fsPath, { silent: true })
    ?? await pickTarget(deps, 'Show trace with which Playwright config?');
  if (target) {
    runInTerminal(target, 'Playwright Trace', ['show-trace', zip.fsPath]);
  }
}

async function recordTestCommand(deps: CommandDeps, folder: vscode.Uri | undefined): Promise<void> {
  const target = folder
    ? await targetForFile(deps, folder.fsPath, { silent: true }) ?? await pickTarget(deps)
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
  const targets = deps.discovery.currentTargets.length > 0
    ? deps.discovery.currentTargets
    : await deps.discovery.refreshTargets();
  const best = targets
    .filter((target) => containsPath(target.configDir, fsPath))
    .sort((a, b) => b.configDir.length - a.configDir.length)[0]
    ?? targets[0];
  if (!best && !options.silent) {
    void vscode.window.showInformationMessage('No Playwright configs found in this workspace.');
  }
  return best;
}

function containsPath(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
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
