import * as path from 'path';
import * as vscode from 'vscode';
import { ArtifactService } from './artifactService';
import { CompanionCliRunner } from './companionRunner';
import { ArtifactRecord, CompanionFailure, CompanionRunSummary, CompanionTestItem, UiProfile } from './core/companionTypes';
import { ForcedInspectorBrowser, resolveInspectorBrowser } from './core/inspectorBrowser';
import { EditorTestSelection, editorSelectionsForFile } from './core/editorSelections';
import { buildShowReportArguments } from './core/reportServer';
import {
  buildChangedUiArguments,
  buildCompanionTestArguments,
  buildDebugArguments,
  buildFlakeLabArguments,
  buildLastFailedUiArguments,
  buildTagArguments,
  buildUiArguments,
  fullTitleFilter,
  UiArgumentOptions,
} from './core/runArguments';
import { cliSelectionForEditor } from './core/selectionArguments';
import { environmentForCli } from './core/cliResolution';
import { quoteForTerminal } from './core/terminalQuote';
import { supportsFailOnFlakyTests } from './core/version';
import { DiscoveryService } from './discoveryService';
import { probeCliVersion } from './executor';
import { InteractiveSessionManager } from './interactiveSessions';
import { OfficialPlaywrightBridge } from './officialPlaywrightBridge';
import { ProjectPicker } from './projectPicker';
import { RunTarget, targetLabel } from './runTarget';
import { Settings } from './settings';
import { PlaywrightSidebar } from './sidebar';

export interface CommandDeps {
  context: vscode.ExtensionContext;
  discovery: DiscoveryService;
  bridge: OfficialPlaywrightBridge;
  projects: ProjectPicker;
  runner: CompanionCliRunner;
  artifacts: ArtifactService;
  sessions: InteractiveSessionManager;
  sidebar: PlaywrightSidebar;
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

  register('playwrightCodeLensRunner.flakeLab', (selection?: EditorTestSelection | vscode.Uri) => flakeLabCommand(deps, selection));
  register('playwrightCodeLensRunner.runCompanion', (selection?: EditorTestSelection | vscode.Uri) => companionRunCommand(deps, selection));
  register('playwrightCodeLensRunner.openChangedUi', (selection?: EditorTestSelection) => changedUiCommand(deps, selection));
  register('playwrightCodeLensRunner.openLastFailedUi', (selection?: EditorTestSelection) => lastFailedUiCommand(deps, selection));
  register('playwrightCodeLensRunner.tagActions', (selection?: EditorTestSelection) => tagActionsCommand(deps, selection));
  register('playwrightCodeLensRunner.openRunsView', () => focusCompanionView());
  register('playwrightCodeLensRunner.rerunFailedCli', () => rerunFailedCommand(deps));
  register('playwrightCodeLensRunner.openArtifactCenter', () => artifactCenterCommand(deps));
  register('playwrightCodeLensRunner.openLatestReport', () => openLatestReportCommand(deps));
  register('playwrightCodeLensRunner.openLatestTrace', () => openLatestTraceCommand(deps));
  register('playwrightCodeLensRunner.mergeBlobReports', () => mergeBlobReportsCommand(deps));
  register('playwrightCodeLensRunner.openUiProfile', (selection?: EditorTestSelection) => openUiProfileCommand(deps, selection));
  register('playwrightCodeLensRunner.openArtifact', (artifact: ArtifactRecord) => openArtifactCommand(deps, artifact));
  register('playwrightCodeLensRunner.revealArtifact', (artifact: ArtifactRecord) => revealArtifactCommand(artifact));
  register('playwrightCodeLensRunner.openFailure', (failure: CompanionFailure) => openFailureCommand(failure));
  register('playwrightCodeLensRunner.showCompanionOutput', () => deps.runner.showOutput());
  register('playwrightCodeLensRunner.openMicrosoftTesting', () => vscode.commands.executeCommand('workbench.view.extension.test'));

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
    await focusNativeResults(selection.file);
    return;
  }
  await deps.bridge.runAtActiveCursor(mode);
  await focusNativeResults(vscode.window.activeTextEditor?.document.uri.fsPath);
}

async function delegatedFileCommand(
  deps: CommandDeps,
  arg: EditorTestSelection | vscode.Uri | undefined,
  mode: 'run' | 'debug',
): Promise<void> {
  if (isEditorSelection(arg)) {
    await deps.bridge.run({ ...arg, kind: 'file', position: { line: 0, character: 0 }, fullTitle: undefined }, mode);
    scheduleNativeFocus(arg.file);
    return;
  }
  const uri = isUri(arg) ? arg : vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    void vscode.window.showInformationMessage('Open a Playwright test file first.');
    return;
  }
  await deps.bridge.runUri(uri, mode);
  scheduleNativeFocus(uri.fsPath);
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
  const profile = mode === 'ui' ? await defaultUiProfile(target) : undefined;
  const args = mode === 'debug'
    ? buildDebugArguments(runSelection, options)
    : buildUiArguments(runSelection, { ...options, ...profileArguments(profile) });
  const label = mode === 'debug' ? 'Playwright Inspector' : 'Playwright UI';
  if (mode === 'ui' && profile && !(await confirmRemoteProfile(profile))) {
    return;
  }
  const sessionKey = mode === 'ui'
    ? `ui:${target.id}:${profile?.name ?? 'local'}`
    : `inspector:${target.id}`;
  deps.sessions.launch(target, sessionKey, `${label}: ${path.basename(selection.file)}`, args);
  await focusCompanionFor(target);
}

async function moreCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const resolved = selection ?? await selectionAtCursor(deps);
  if (!resolved) {
    void vscode.window.showInformationMessage('No Playwright selection found at the current position.');
    return;
  }
  const scopeLabel = resolved.kind === 'file' ? 'File' : resolved.kind === 'suite' ? 'Suite' : 'Test';
  const choices = [
    { label: '$(play) Run', description: 'Microsoft Testing', action: 'run' as const },
    { label: '$(debug) Debug', description: 'Microsoft Testing', action: 'debug' as const },
    { label: `$(play) Run Companion ${scopeLabel}`, description: 'Companion CLI · normal run', action: 'companionRun' as const },
    ...(resolved.kind === 'file' ? [] : [{ label: '$(eye) Inspect', description: 'Companion CLI', action: 'inspect' as const }]),
    { label: '$(browser) Playwright UI', description: 'Companion CLI', action: 'ui' as const },
    { label: '$(beaker) Flake Lab', description: 'Companion CLI · repeat selected scope', action: 'flake' as const },
    { label: '$(git-compare) Open Changed Tests in Playwright UI', description: 'Companion CLI', action: 'changed' as const },
    { label: '$(history) Open Last Failed Tests in Playwright UI', description: 'Companion CLI', action: 'lastFailed' as const },
    { label: '$(tag) Tag actions…', description: 'Companion CLI', action: 'tags' as const },
    { label: '$(remote) Open UI profile…', description: 'Companion CLI', action: 'profile' as const },
    { label: '$(archive) Open Artifact Center', description: 'Companion sidebar', action: 'artifacts' as const },
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
  } else if (picked.action === 'companionRun') {
    await companionRunCommand(deps, resolved);
  } else if (picked.action === 'inspect') {
    await interactiveCliCommand(deps, resolved, 'debug');
  } else if (picked.action === 'ui') {
    await interactiveCliCommand(deps, resolved, 'ui');
  } else if (picked.action === 'flake') {
    await flakeLabCommand(deps, resolved);
  } else if (picked.action === 'changed') {
    await changedUiCommand(deps, resolved);
  } else if (picked.action === 'lastFailed') {
    await lastFailedUiCommand(deps, resolved);
  } else if (picked.action === 'tags') {
    await tagActionsCommand(deps, resolved);
  } else if (picked.action === 'profile') {
    await openUiProfileCommand(deps, resolved);
  } else if (picked.action === 'artifacts') {
    await artifactCenterCommand(deps);
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

async function flakeLabCommand(
  deps: CommandDeps,
  arg: EditorTestSelection | vscode.Uri | undefined,
): Promise<void> {
  const selection = isEditorSelection(arg)
    ? arg
    : isUri(arg)
      ? await fileSelectionForUri(deps, arg)
      : await selectionAtCursor(deps);
  if (!selection) {
    void vscode.window.showInformationMessage('Open a Playwright test file first.');
    return;
  }
  const target = await targetForSelection(deps, selection);
  if (!target) {
    return;
  }
  const settings = settingsFor(target);
  if (settings.flakeLabFailOnFlakyTests) {
    const version = await probeCliVersion(target.cli, target.cwd, target.env);
    if (!version.ok || !supportsFailOnFlakyTests(version.output)) {
      void vscode.window.showErrorMessage(
        'Flake Lab needs Playwright Test 1.52 or newer when failOnFlakyTests is enabled. Disable playwrightCodeLensRunner.flakeLab.failOnFlakyTests to run the compatible subset.',
      );
      return;
    }
  }
  const projects = await deps.projects.getProjects(target);
  const runSelection = cliSelectionForEditor(selection);
  const args = buildFlakeLabArguments(runSelection, {
    configFile: target.configFile,
    cwd: target.cwd,
    projects,
    extraOptions: target.runOptions,
    repeatEach: settings.flakeLabRepeatEach,
    workers: settings.flakeLabWorkers,
    retries: settings.flakeLabRetries,
    trace: settings.flakeLabTrace,
    failOnFlakyTests: settings.flakeLabFailOnFlakyTests,
  });
  const initialTests = await initialTestsForSelection(deps, target, selection);
  void focusCompanionFor(target);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Playwright Flake Lab: ${path.basename(selection.file)}`,
      cancellable: true,
    },
    async (_progress, token) => deps.runner.run(target, {
      kind: 'flake-lab',
      targetId: target.id,
      cwd: target.cwd,
      configFile: target.configFile,
      args,
      env: target.env,
      selection: runSelection,
      projects,
      initialTests,
    }, token),
  );
  await deps.sidebar.refreshArtifacts(await currentTargets(deps));
}

async function companionRunCommand(
  deps: CommandDeps,
  arg: EditorTestSelection | vscode.Uri | undefined,
): Promise<void> {
  const selection = isEditorSelection(arg)
    ? arg
    : isUri(arg)
      ? await fileSelectionForUri(deps, arg)
      : await selectionAtCursor(deps);
  if (!selection) {
    void vscode.window.showInformationMessage('Open a Playwright test file first.');
    return;
  }
  const target = await targetForSelection(deps, selection);
  if (!target) {
    return;
  }
  const projects = await deps.projects.getProjects(target);
  const runSelection = cliSelectionForEditor(selection);
  const args = [
    ...buildCompanionTestArguments(runSelection, {
      configFile: target.configFile,
      cwd: target.cwd,
      projects,
    }),
    ...target.runOptions,
  ];
  const initialTests = await initialTestsForSelection(deps, target, selection);
  void focusCompanionFor(target);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Playwright Companion Run: ${path.basename(selection.file)}`,
      cancellable: true,
    },
    async (_progress, token) => deps.runner.run(target, {
      kind: 'companion-run',
      targetId: target.id,
      cwd: target.cwd,
      configFile: target.configFile,
      args,
      env: target.env,
      selection: runSelection,
      projects,
      initialTests,
    }, token),
  );
  await deps.sidebar.refreshArtifacts(await currentTargets(deps));
}

async function changedUiCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const scope = await targetScopeForCommand(deps, selection, 'Open changed tests for which Playwright CLI config?');
  if (!scope) {
    return;
  }
  const ref = await pickChangedRef();
  if (ref === null) {
    return;
  }
  await launchTargetUi(deps, scope.target, 'changed', (options) => buildChangedUiArguments(options, ref ?? undefined));
}

async function lastFailedUiCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const scope = await targetScopeForCommand(deps, selection, 'Open last failed tests for which Playwright CLI config?');
  if (!scope) {
    return;
  }
  await launchTargetUi(deps, scope.target, 'last-failed', buildLastFailedUiArguments);
}

async function tagActionsCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const scope = await targetScopeForCommand(deps, selection, 'Choose a Playwright config for tag actions');
  if (!scope) {
    return;
  }
  const model = deps.discovery.cachedModel(scope.target.id) ?? await deps.discovery.discover(scope.target);
  const tags = model ? discoveredTags(model) : [];
  if (tags.length === 0) {
    void vscode.window.showInformationMessage('No Playwright tags were discovered for this config.');
    return;
  }
  const picked = await vscode.window.showQuickPick(tags.map((tag) => ({ label: tag })), {
    title: `Choose a Playwright tag (${targetLabel(scope.target)})`,
  });
  if (!picked || !isValidTag(picked.label)) {
    return;
  }
  const action = await vscode.window.showQuickPick([
    { label: '$(browser) Open UI for tag', action: 'ui' as const },
    { label: '$(eye) Inspect tag', action: 'debug' as const },
    { label: '$(copy) Copy UI command', action: 'copy-ui' as const },
    { label: '$(copy) Copy Inspector command', action: 'copy-debug' as const },
  ], { title: `Playwright actions for ${picked.label}` });
  if (!action) {
    return;
  }
  const target = scope.target;
  const projects = await deps.projects.getProjects(target);
  if (action.action === 'ui' || action.action === 'copy-ui') {
    const profile = await defaultUiProfile(target);
    const args = buildTagArguments('ui', picked.label, {
      configFile: target.configFile,
      cwd: target.cwd,
      projects,
      extraOptions: target.runOptions,
      ...profileArguments(profile),
    });
    if (action.action === 'copy-ui') {
      await copyTerminalCommand(target, args, `Playwright UI command for ${picked.label}`);
      return;
    }
    if (profile && !(await confirmRemoteProfile(profile))) {
      return;
    }
    deps.sessions.launch(target, `ui:${target.id}:${profile?.name ?? 'local'}`, `Playwright UI: ${picked.label}`, args);
    await focusCompanionFor(target);
    return;
  }
  const args = buildTagArguments('debug', picked.label, {
    configFile: target.configFile,
    cwd: target.cwd,
    projects,
    extraOptions: target.runOptions,
  });
  if (action.action === 'copy-debug') {
    await copyTerminalCommand(target, args, `Playwright Inspector command for ${picked.label}`);
    return;
  }
  deps.sessions.launch(target, `inspector:${target.id}`, `Playwright Inspector: ${picked.label}`, args);
  await focusCompanionFor(target);
}

async function openUiProfileCommand(deps: CommandDeps, selection: EditorTestSelection | undefined): Promise<void> {
  const scope = await targetScopeForCommand(deps, selection, 'Open a UI profile for which Playwright CLI config?');
  if (!scope) {
    return;
  }
  const profile = await pickUiProfile(scope.target);
  if (profile === null) {
    return;
  }
  if (profile && !(await confirmRemoteProfile(profile))) {
    return;
  }
  const projects = await deps.projects.getProjects(scope.target);
  const args = buildUiArguments({ files: [], titleFilters: [] }, {
    configFile: scope.target.configFile,
    cwd: scope.target.cwd,
    projects,
    extraOptions: scope.target.runOptions,
    ...profileArguments(profile ?? undefined),
  });
  deps.sessions.launch(
    scope.target,
    `ui:${scope.target.id}:${profile?.name ?? 'local'}`,
    `Playwright UI${profile ? `: ${profile.name}` : ''}`,
    args,
  );
  await focusCompanionFor(scope.target);
}

async function rerunFailedCommand(deps: CommandDeps): Promise<void> {
  const latest = deps.runner.latestRun;
  if (!latest || latest.failures.length === 0) {
    void vscode.window.showInformationMessage('No failed companion CLI tests are available to rerun.');
    return;
  }
  const target = await targetById(deps, latest.targetId);
  if (!target) {
    void vscode.window.showErrorMessage('The Playwright config for the last companion run is no longer available.');
    return;
  }
  const selection = failedSelection(latest);
  const projects = latest.projects.length > 0 ? latest.projects : await deps.projects.getProjects(target);
  const args = [
    ...buildCompanionTestArguments(selection, {
      configFile: target.configFile,
      cwd: target.cwd,
      projects,
    }),
    ...target.runOptions,
  ];
  const initialTests = latest.failures.map((f) => ({
    id: `${f.file ?? ''}:${f.line ?? 1}:${f.title}`,
    title: f.title,
    file: f.file,
    line: f.line,
    status: 'pending' as const,
  }));
  void focusCompanionFor(target);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Playwright: rerun failed companion tests',
      cancellable: true,
    },
    async (_progress, token) => deps.runner.run(target, {
      kind: 'rerun-failed',
      targetId: target.id,
      cwd: target.cwd,
      configFile: target.configFile,
      args,
      env: target.env,
      selection,
      projects,
      initialTests,
    }, token),
  );
  await deps.sidebar.refreshArtifacts(await currentTargets(deps));
}

async function artifactCenterCommand(deps: CommandDeps): Promise<void> {
  const targets = await currentTargets(deps);
  await deps.sidebar.refreshArtifacts(targets);
  await focusCompanionView();
}

async function openLatestReportCommand(deps: CommandDeps): Promise<void> {
  await artifactCenterCommand(deps);
  const report = deps.artifacts.latest('reportish');
  if (!report) {
    void vscode.window.showInformationMessage('No local Playwright HTML report or report ZIP was found.');
    return;
  }
  await openArtifactCommand(deps, report);
}

async function openLatestTraceCommand(deps: CommandDeps): Promise<void> {
  await artifactCenterCommand(deps);
  const trace = deps.artifacts.latest('trace');
  if (!trace) {
    void vscode.window.showInformationMessage('No local Playwright trace was found.');
    return;
  }
  await openArtifactCommand(deps, trace);
}

async function mergeBlobReportsCommand(deps: CommandDeps): Promise<void> {
  await artifactCenterCommand(deps);
  const blobs = deps.artifacts.artifacts.filter((record) => record.kind === 'blob-report');
  const blob = blobs.length === 1 ? blobs[0] : await pickArtifact(blobs, 'Choose blob report to merge');
  if (!blob) {
    if (blobs.length === 0) {
      void vscode.window.showInformationMessage('No local Playwright blob report ZIP was found.');
    }
    return;
  }
  const target = await targetById(deps, blob.targetId);
  if (!target) {
    return;
  }
  runInTerminal(target, 'Playwright Merge Reports', ['merge-reports', '--reporter', 'html', path.dirname(blob.path)]);
  await focusCompanionFor(target);
}

async function openArtifactCommand(deps: CommandDeps, artifact: ArtifactRecord): Promise<void> {
  const target = await targetById(deps, artifact.targetId);
  if (!target) {
    return;
  }
  if (artifact.kind === 'report' || artifact.kind === 'report-zip') {
    runInTerminal(target, 'Playwright Report', buildShowReportArguments(artifact.path));
  } else if (artifact.kind === 'trace') {
    runInTerminal(target, 'Playwright Trace', ['show-trace', artifact.path]);
  } else {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(artifact.path));
  }
  await focusCompanionFor(target);
}

async function revealArtifactCommand(artifact: ArtifactRecord): Promise<void> {
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(artifact.path));
}

async function openFailureCommand(failure: CompanionFailure): Promise<void> {
  if (!failure.file) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(failure.file));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const line = Math.max(0, (failure.line ?? 1) - 1);
  const position = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function launchTargetUi(
  deps: CommandDeps,
  target: RunTarget,
  reason: string,
  build: (options: UiArgumentOptions) => string[],
): Promise<void> {
  const profile = await defaultUiProfile(target);
  if (profile && !(await confirmRemoteProfile(profile))) {
    return;
  }
  const projects = await deps.projects.getProjects(target);
  const args = build({
    configFile: target.configFile,
    cwd: target.cwd,
    projects,
    extraOptions: target.runOptions,
    ...profileArguments(profile),
  });
  deps.sessions.launch(
    target,
    `ui:${target.id}:${profile?.name ?? 'local'}`,
    `Playwright UI: ${reason}`,
    args,
  );
  await focusCompanionFor(target);
}

async function pickChangedRef(): Promise<string | null | undefined> {
  const picked = await vscode.window.showQuickPick([
    { label: 'Current uncommitted changes', ref: undefined },
    { label: 'Compare with a Git ref…', ref: null },
  ], { title: 'Playwright UI: changed tests' });
  if (!picked) {
    return null;
  }
  if (picked.ref !== null) {
    return undefined;
  }
  const ref = await vscode.window.showInputBox({
    title: 'Git ref for changed tests',
    prompt: 'For example: origin/main, main, or HEAD~1',
    validateInput: (value) => value.trim() ? undefined : 'Enter a Git ref.',
  });
  return ref?.trim() || null;
}

async function defaultUiProfile(target: RunTarget): Promise<UiProfile | undefined> {
  const settings = settingsFor(target);
  const requested = settings.uiDefaultProfile;
  if (!requested) {
    return undefined;
  }
  const profile = settings.uiProfiles.find((candidate) => candidate.name === requested);
  if (!profile) {
    void vscode.window.showWarningMessage(`The configured default Playwright UI profile "${requested}" is not valid.`);
  }
  return profile;
}

/** `null` means picker cancelled; undefined explicitly means local UI. */
async function pickUiProfile(target: RunTarget): Promise<UiProfile | undefined | null> {
  const profiles = settingsFor(target).uiProfiles;
  const picks: Array<{ label: string; description: string; profile?: UiProfile }> = [
    { label: 'Local UI', description: 'Bind to Playwright defaults (loopback)' },
    ...profiles.map((profile) => ({
      label: profile.name,
      description: `${profile.host}:${profile.port}`,
      profile,
    })),
  ];
  const picked = await vscode.window.showQuickPick(picks, { title: 'Choose a Playwright UI profile' });
  return picked ? picked.profile : null;
}

function profileArguments(profile: UiProfile | undefined): Pick<UiArgumentOptions, 'uiHost' | 'uiPort'> {
  return profile ? { uiHost: profile.host, uiPort: profile.port } : {};
}

async function confirmRemoteProfile(profile: UiProfile): Promise<boolean> {
  if (isLoopbackProfile(profile)) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    `Playwright UI will listen on ${profile.host}:${profile.port}, which can expose test data to your network.`,
    { modal: true },
    'Launch UI',
  );
  return choice === 'Launch UI';
}

function isLoopbackProfile(profile: UiProfile): boolean {
  const host = profile.host.toLowerCase();
  return host === 'localhost' || host === '::1' || host === '[::1]' || host === '127.0.0.1' || host.startsWith('127.');
}

function settingsFor(target: RunTarget): Settings {
  return new Settings(vscode.Uri.file(target.configFile ?? target.configDir));
}

function discoveredTags(model: import('./core/model').DiscoveredConfig): string[] {
  const tags = new Set<string>();
  const addTest = (test: { tags: string[] }) => {
    for (const tag of test.tags) {
      if (isValidTag(tag)) {
        tags.add(tag);
      }
    }
  };
  const visitSuite = (suite: import('./core/model').DiscoveredSuite) => {
    for (const test of suite.tests) {
      addTest(test);
    }
    for (const nested of suite.suites) {
      visitSuite(nested);
    }
  };
  for (const file of model.files) {
    for (const test of file.tests) {
      addTest(test);
    }
    for (const suite of file.suites) {
      visitSuite(suite);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function isValidTag(tag: string): boolean {
  return /^@[A-Za-z0-9][A-Za-z0-9_./:-]*$/.test(tag);
}

async function copyTerminalCommand(target: RunTarget, args: string[], message: string): Promise<void> {
  await vscode.env.clipboard.writeText(quoteForTerminal(target.cli.executable, [...target.cli.argsPrefix, ...args]));
  void vscode.window.showInformationMessage(`${message} copied to the clipboard.`);
}

async function currentTargets(deps: CommandDeps): Promise<RunTarget[]> {
  return deps.discovery.currentTargets.length > 0 ? deps.discovery.currentTargets : deps.discovery.refreshTargets();
}

async function targetById(deps: CommandDeps, id: string): Promise<RunTarget | undefined> {
  return (await currentTargets(deps)).find((target) => target.id === id);
}

async function pickArtifact(artifacts: ArtifactRecord[], title: string): Promise<ArtifactRecord | undefined> {
  const picked = await vscode.window.showQuickPick(
    artifacts.map((artifact) => ({ label: artifact.label, description: artifact.path, artifact })),
    { title },
  );
  return picked?.artifact;
}

function failedSelection(run: CompanionRunSummary): import('./core/runArguments').RunSelection {
  const files = [...new Set(run.failures.flatMap((failure) => failure.file ? [failure.file] : []))];
  const effectiveFiles = files.length > 0 ? files : run.selection.files;
  const filters = run.failures.flatMap((failure) => (
    failure.file && failure.titlePath && failure.titlePath.length > 0
      ? [fullTitleFilter(failure.titlePath, failure.file)]
      : []
  ));
  return {
    files: effectiveFiles,
    titleFilters: filters.length > 0 ? filters : run.selection.titleFilters,
  };
}

async function focusCompanionFor(target: RunTarget): Promise<void> {
  if (settingsFor(target).sidebarAutoFocus) {
    await focusCompanionView();
  }
}

async function focusCompanionView(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.playwrightCodeLensRunner');
  await vscode.commands.executeCommand('playwrightCodeLensRunner.runsView.focus').then(undefined, () => undefined);
}

async function focusNativeResults(file: string | undefined): Promise<void> {
  if (new Settings(file ? vscode.Uri.file(file) : undefined).sidebarAutoFocus) {
    await vscode.commands.executeCommand('workbench.view.extension.test');
  }
}

/** Lets Microsoft's asynchronous URI dispatch start before changing views. */
function scheduleNativeFocus(file: string): void {
  setTimeout(() => {
    void focusNativeResults(file);
  }, 5_000);
}

async function showReportCommand(deps: CommandDeps): Promise<void> {
  const target = await pickTarget(deps, 'Show HTML report for which Playwright config?');
  if (target) {
    runInTerminal(target, 'Playwright Report', buildShowReportArguments());
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

async function initialTestsForSelection(
  deps: CommandDeps,
  target: RunTarget,
  selection: EditorTestSelection,
): Promise<CompanionTestItem[] | undefined> {
  try {
    const model = await deps.discovery.discoverForFile(target, selection.file);
    if (!model) {
      return undefined;
    }
    const uri = selection.uri ?? vscode.Uri.file(selection.file).toString();
    const selections = editorSelectionsForFile(model, selection.file, uri).filter((s) => s.kind === 'test');
    const matched = selection.kind === 'file'
      ? selections
      : selections.filter((s) => isSelectionMatch(s, selection));
    const targetSpecs = matched.length > 0 ? matched : selections;
    return targetSpecs.map((s) => {
      const title = s.titlePath ? s.titlePath.join(' › ') : s.fullTitle ?? 'Playwright test';
      const line = s.position.line + 1;
      return {
        id: `${s.file}:${line}:${title}`,
        title,
        file: s.file,
        line,
        status: 'pending',
      };
    });
  } catch {
    return undefined;
  }
}

function isSelectionMatch(candidate: EditorTestSelection, target: EditorTestSelection): boolean {
  if (candidate.file !== target.file) {
    return false;
  }
  if (target.kind === 'test') {
    return candidate.position.line === target.position.line
      || Boolean(candidate.titlePath && target.titlePath && candidate.titlePath.join(' › ') === target.titlePath.join(' › '));
  }
  if (target.kind === 'suite' && candidate.titlePath && target.titlePath) {
    const targetPrefix = target.titlePath.join(' › ');
    return candidate.titlePath.join(' › ').startsWith(targetPrefix);
  }
  return true;
}
