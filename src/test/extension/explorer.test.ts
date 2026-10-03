import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CompanionCliRunRequest } from '../../core/companionTypes';
import { ExplorerTestNode } from '../../core/explorerTree';
import { DiscoveredConfig } from '../../core/model';
import { TargetDiscovery } from '../../discoveryService';
import type { ExtensionApi } from '../../extension';
import { RunTarget } from '../../runTarget';
import { ExplorerElement } from '../../testExplorer';

suite('Playwright Test Explorer', () => {
  let api: ExtensionApi;
  let fixture: vscode.WorkspaceFolder;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<ExtensionApi>('rungruch.playwright-codelens-runner');
    assert.ok(extension);
    api = await extension.activate();
    fixture = vscode.workspace.workspaceFolders![0];
    await waitUntil('automatic complete inventory', () => tests().some((node) => node.label === 'dynamic case 2')
      && !elements().some((node) => node.kind === 'message' && node.loading));
  });

  test('loads every config without requiring its tests to be opened', () => {
    const configs = elements().filter((node) => node.kind === 'config');
    assert.strictEqual(configs.length, api.discovery.currentTargets.length);
    for (const target of api.discovery.currentTargets) {
      const model = api.discovery.cachedModel(target.id);
      assert.ok(model, `complete discovery is available for ${target.configFile}`);
      const countSuite = (suite: DiscoveredConfig['files'][number]): number => suite.tests.length
        + suite.suites.reduce((count, child) => count + countSuite({ ...child, file: '', relativeFile: '' }), 0);
      assert.strictEqual(tests().filter((node) => node.targetId === target.id).length,
        model.files.reduce((count, file) => count + countSuite(file), 0));
    }
    const generated = tests().filter((node) => node.label.startsWith('dynamic case '));
    assert.deepStrictEqual(generated.map((node) => node.label), ['dynamic case 1', 'dynamic case 2', 'dynamic case 3']);
    assert.ok(generated.every((node) => node.sharedDeclaration));
    assert.ok(elements().some((node) => node.kind === 'suite' && node.label === 'nested suite'));
  });

  test('opens the selected test at its source location', async () => {
    const node = tests().find((node) => node.label === 'dynamic case 2')!;
    await vscode.commands.executeCommand('playwrightCodeLensRunner.openExplorerItem', node);
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), node.selection?.uri);
    assert.strictEqual(vscode.window.activeTextEditor?.selection.start.line, node.selection?.position.line);
  });

  test('shows workspace-relative folders with filename labels and no execution actions', () => {
    const target = api.discovery.currentTargets.find((target) => target.configFile === path.join(fixture.uri.fsPath, 'playwright.config.ts'))!;
    const config = elements().find((node) => node.kind === 'config' && node.targetId === target.id)!;
    const folder = api.explorer.getChildren(config).find((node) => node.kind === 'folder' && node.label === 'tests');
    assert.ok(folder && folder.kind === 'folder');
    const item = api.explorer.getTreeItem(folder);
    assert.strictEqual(item.contextValue, 'playwrightExplorer.folder');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.strictEqual(item.resourceUri?.fsPath, path.join(fixture.uri.fsPath, 'tests'));
    assert.strictEqual(item.command, undefined);
    assert.strictEqual(api.explorer.selectionFor(folder), undefined);
    const children = api.explorer.getChildren(folder);
    const labels = children.map((node) => node.label);
    assert.deepStrictEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
    const nested = children.find((node) => node.kind === 'folder' && node.label === 'nested');
    assert.ok(nested);
    const file = children.find((node) => node.kind === 'file' && node.label === 'dynamic.spec.ts');
    assert.ok(file);
    assert.ok(api.explorer.getChildren(file).some((node) => node.label === 'dynamic case 2'));
    const ids = elements().filter((node) => node.kind === 'folder').map((node) => node.id);
    const model = api.discovery.cachedModel(target.id)!;
    discoveryInternals().emitter.fire({ target, model });
    assert.deepStrictEqual(elements().filter((node) => node.kind === 'folder').map((node) => node.id), ids);
  });

  test('runs exactly one generated case through the companion backend', async () => {
    const restoreSettings = await configure({ 'run.backend': 'companion', 'sidebar.autoFocus': false });
    const originalRun = api.runner.run;
    const captured: Array<{ target: RunTarget; request: CompanionCliRunRequest }> = [];
    api.runner.run = async (target, request) => {
      captured.push({ target, request });
      return { ...request, id: 'explorer-captured', startedAt: Date.now(), status: 'passed', durationMs: 1,
        total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, failures: [] };
    };
    try {
      const node = tests().find((node) => node.label === 'dynamic case 2')!;
      assert.ok(api.explorer.selectionFor(node));
      await vscode.commands.executeCommand('playwrightCodeLensRunner.runExplorerItem', node);
      assert.strictEqual(captured.length, 1);
      assert.strictEqual(captured[0].target.id, node.targetId);
      assert.deepStrictEqual(captured[0].request.initialTests?.map((test) => test.titlePath), [['dynamic case 2']]);
      assert.strictEqual(captured[0].request.selection.titleFilters.length, 1);
      const summary = await originalRun.call(api.runner, captured[0].target, captured[0].request);
      assert.strictEqual(summary.total, 1);
      assert.strictEqual(summary.passed, 1);
      assert.deepStrictEqual(summary.tests?.map((test) => test.titlePath), [['dynamic case 2']]);
      const item = api.explorer.getTreeItem(node);
      assert.ok(item.iconPath instanceof vscode.ThemeIcon);
      assert.strictEqual(item.iconPath.id, 'pass');
      assert.strictEqual(item.iconPath.color?.id, 'testing.iconPassed');
      assert.match(String(item.description), /^Passed/);
      const untouched = tests().find((test) => test.label === 'dynamic case 1')!;
      assert.ok(!String(api.explorer.getTreeItem(untouched).description).startsWith('Passed'));
      const history = api.explorer.getChildren().find((node) => node.kind === 'runHistory');
      assert.ok(history);
      const latest = api.explorer.getChildren(history).find((node) => node.kind === 'runItem' && node.runElement.type === 'run');
      assert.ok(latest);
      const show = api.runner.showOutput;
      let shown: string | undefined;
      api.runner.showOutput = async (id) => { shown = id; };
      try {
        await vscode.commands.executeCommand('playwrightCodeLensRunner.showCompanionOutput', latest);
        assert.strictEqual(shown, summary.id, 'history inline output resolves the selected run');
        shown = undefined;
        await vscode.commands.executeCommand('playwrightCodeLensRunner.showExplorerOutput', node);
        assert.strictEqual(shown, summary.id, 'test output resolves its own run');
      } finally { api.runner.showOutput = show; }
    } finally {
      api.runner.run = originalRun;
      await restoreSettings();
    }
  });

  test('delegates official Run and Debug and labels shared declarations', async () => {
    const restoreSettings = await configure({ 'run.backend': 'official', 'sidebar.autoFocus': false });
    const originalRun = api.bridge.run;
    const modes: string[] = [];
    api.bridge.run = async (selection, mode) => {
      modes.push(mode);
      assert.deepStrictEqual(selection.titlePaths, [['dynamic case 2']]);
    };
    try {
      const node = tests().find((node) => node.label === 'dynamic case 2')!;
      assert.match(api.explorer.getTreeItem(node).contextValue ?? '', /^playwrightExplorer\.executable\.generated\.official(?:\.result)?$/);
      await vscode.commands.executeCommand('playwrightCodeLensRunner.runExplorerDeclaration', node);
      await vscode.commands.executeCommand('playwrightCodeLensRunner.debugExplorerDeclaration', node);
      assert.deepStrictEqual(modes, ['run', 'debug']);
      const tooltip = api.explorer.getTreeItem(node).tooltip;
      assert.ok((typeof tooltip === 'string' ? tooltip : tooltip?.value)?.replace(/&nbsp;/g, ' ').includes('source declaration'));
    } finally {
      api.bridge.run = originalRun;
      await restoreSettings();
    }
  });

  test('keeps test inventory available when managed run results are disabled', async () => {
    const restore = await configure({ 'sidebar.runsEnabled': false });
    try {
      await waitUntil('hidden run history', () => !api.explorer.getChildren().some((node) => node.kind === 'runHistory'));
      const node = tests().find((node) => node.label === 'dynamic case 2')!;
      assert.ok(node && api.explorer.selectionFor(node));
      const item = api.explorer.getTreeItem(node);
      assert.ok(!item.contextValue?.endsWith('.result'));
      assert.ok(!String(item.description).startsWith('Passed'));
    } finally { await restore(); }
  });

  test('scopes file and suite runs through the same companion dispatch', async () => {
    const restoreSettings = await configure({ 'run.backend': 'companion', 'sidebar.autoFocus': false });
    const originalRun = api.runner.run;
    const calls: CompanionCliRunRequest[] = [];
    api.runner.run = async (_target, request) => {
      calls.push(request);
      return { ...request, id: 'explorer-scope', startedAt: Date.now(), status: 'passed', durationMs: 1,
        total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, failures: [] };
    };
    try {
      const suite = elements().find((node) => node.kind === 'suite' && node.label === 'nested suite')!;
      assert.ok('selection' in suite && suite.selection);
      const file = elements().find((node) => node.kind === 'file' && node.selection?.file === suite.selection!.file
        && node.targetId === suite.targetId)!;
      await vscode.commands.executeCommand('playwrightCodeLensRunner.runExplorerItem', file);
      await vscode.commands.executeCommand('playwrightCodeLensRunner.runExplorerItem', suite);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].targetId, suite.targetId);
      assert.deepStrictEqual(calls[0].selection.titleFilters, []);
      assert.strictEqual(calls[0].selection.line, undefined);
      assert.strictEqual(calls[1].selection.titleFilters.length, 1);
      assert.strictEqual(calls[1].selection.line, suite.selection!.position.line + 1);
    } finally {
      api.runner.run = originalRun;
      await restoreSettings();
    }
  });

  test('keeps complete snapshots for scoped reports and disables stale selections', () => {
    const node = tests().find((node) => node.label === 'dynamic case 2')!;
    const target = api.discovery.currentTargets.find((target) => target.id === node.targetId)!;
    const model = api.discovery.cachedModel(target.id)!;
    const emitter = discoveryInternals().emitter;
    const ids = tests().map((node) => node.id);
    let refreshes = 0;
    const listener = api.explorer.onDidChangeTreeData(() => { refreshes++; });
    try {
      emitter.fire({ target, model: { ...model, files: [] }, scopeFile: node.selection!.file });
      assert.deepStrictEqual(tests().map((node) => node.id), ids);
      assert.strictEqual(refreshes, 0, 'file-scoped reports do not refresh the complete inventory');
      emitter.fire({ target, invalidated: true });
      assert.strictEqual(refreshes, 1, 'invalidations still disable stale selections immediately');
      assert.deepStrictEqual(tests().map((node) => node.id), ids);
      assert.strictEqual(api.explorer.selectionFor(node), undefined);
      assert.strictEqual(api.explorer.getTreeItem(node).description, 'Outdated');
      emitter.fire({ target, model: { ...model, files: [] }, error: 'Broken fixture import' });
      assert.deepStrictEqual(tests().map((node) => node.id), ids);
      assert.strictEqual(api.explorer.selectionFor(node), undefined);
      assert.ok(elements().some((node) => node.kind === 'retry'));
      assert.ok(elements().some((node) => node.kind === 'details'));
      assert.ok(tests().some((other) => other.targetId !== target.id && api.explorer.selectionFor(other)));
    } finally {
      listener.dispose();
      emitter.fire({ target, model });
    }
  });

  test('routes discovery Details and Retry to the clicked config', async () => {
    const target = api.discovery.currentTargets[0];
    const originalRefresh = api.discovery.refreshInventory;
    const originalDetails = api.discovery.showDiagnostics;
    const calls: string[] = [];
    api.discovery.refreshInventory = async (id) => { calls.push(`retry:${id}`); };
    api.discovery.showDiagnostics = (id) => { calls.push(`details:${id}`); };
    try {
      const node = elements().find((node) => node.kind === 'config' && node.targetId === target.id);
      assert.ok(node);
      await vscode.commands.executeCommand('playwrightCodeLensRunner.explorerDiscoveryDetails', node);
      await vscode.commands.executeCommand('playwrightCodeLensRunner.retryExplorerDiscovery', node);
      assert.deepStrictEqual(calls, [`details:${target.id}`, `retry:${target.id}`]);
    } finally {
      api.discovery.refreshInventory = originalRefresh;
      api.discovery.showDiagnostics = originalDetails;
    }
  });

  test('refreshes creation, saved changes, and deletion without losing unrelated tests', async () => {
    const directory = vscode.Uri.joinPath(fixture.uri, 'tests', 'explorer-added');
    const uri = vscode.Uri.joinPath(directory, 'nested', 'explorer-change.spec.ts');
    const before = tests().find((node) => node.label === 'dynamic case 2')!.id;
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(directory, 'nested'));
      await vscode.workspace.fs.writeFile(uri, Buffer.from("import { test } from '@playwright/test';\ntest('explorer created', async () => {});\n"));
      await waitUntil('created test', () => tests().some((node) => node.label === 'explorer created' && api.explorer.selectionFor(node)));
      assert.ok(elements().some((node) => node.kind === 'folder' && node.label === 'explorer-added'));
      await vscode.workspace.fs.writeFile(uri, Buffer.from("import { test } from '@playwright/test';\ntest('explorer changed', async () => {});\n"));
      await waitUntil('changed test', () => tests().some((node) => node.label === 'explorer changed' && api.explorer.selectionFor(node)));
      assert.ok(!tests().some((node) => node.label === 'explorer created'));
      assert.ok(tests().some((node) => node.id === before));
      await vscode.workspace.fs.delete(uri);
      await waitUntil('deleted test', () => !tests().some((node) => node.selection?.uri === uri.toString()));
      assert.ok(!elements().some((node) => node.kind === 'folder' && node.label === 'explorer-added'));
      assert.ok(tests().some((node) => node.id === before));
    } finally {
      await vscode.workspace.fs.delete(directory, { recursive: true }).then(() => undefined, () => undefined);
    }
  });

  test('adds and removes configs and treats a genuine empty inventory as success', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'playwright.explorer-empty.config.ts');
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from("export default { testDir: './tests', testMatch: 'explorer-nonexistent.spec.ts' };\n"));
      await waitUntil('empty config discovery', () => {
        const target = api.discovery.currentTargets.find((target) => target.configFile === uri.fsPath);
        return Boolean(target && api.discovery.cachedModel(target.id));
      });
      const target = api.discovery.currentTargets.find((target) => target.configFile === uri.fsPath)!;
      assert.strictEqual(api.discovery.errorFor(target.id), undefined);
      const config = elements().find((node) => node.kind === 'config' && node.targetId === target.id)!;
      assert.ok(api.explorer.getChildren(config).some((node) => node.label === 'No Playwright tests found.'));
      await vscode.workspace.fs.delete(uri);
      await waitUntil('removed config', () => !elements().some((node) => node.kind === 'config' && node.targetId === target.id));
    } finally {
      await vscode.workspace.fs.delete(uri).then(() => undefined, () => undefined);
    }
  });

  test('saves a dirty selection and rejects its stale payload after deletion', async () => {
    // A different path per host prevents restored editor buffers from reusing this fixture.
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', `explorer-dirty-${vscode.version}.spec.ts`);
    const source = "import { test } from '@playwright/test';\ntest('explorer dirty', async () => {});\n";
    const restoreSettings = await configure({ 'run.backend': 'companion', 'sidebar.autoFocus': false });
    const originalRun = api.runner.run;
    const originalNativeRun = api.bridge.run;
    let nativeCalls = 0;
    api.bridge.run = async () => { nativeCalls++; };
    const calls: CompanionCliRunRequest[] = [];
    api.runner.run = async (_target, request) => {
      calls.push(request);
      return { ...request, id: 'explorer-dirty', startedAt: Date.now(), status: 'passed', durationMs: 1,
        total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, failures: [] };
    };
    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
      await waitUntil('dirty test discovered', () => tests().some((node) => node.label === 'explorer dirty' && api.explorer.selectionFor(node)));
      const node = tests().find((node) => node.label === 'explorer dirty')!;
      const document = await vscode.workspace.openTextDocument(uri);
      assert.strictEqual(document.getText(), source, 'the host opens a fresh fixture document');
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(1, 0), '// inserted before the declaration\n');
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(document.isDirty);
      await vscode.commands.executeCommand('playwrightCodeLensRunner.runExplorerItem', node);
      assert.strictEqual(document.isDirty, false);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].selection.line, 3);
      await vscode.workspace.fs.delete(uri);
      await waitUntil('dirty file removed', () => !tests().some((node) => node.selection?.uri === uri.toString()));
      await vscode.commands.executeCommand('playwrightCodeLensRunner.runExplorerItem', node);
      await vscode.commands.executeCommand('playwrightCodeLensRunner.debugExplorerItem', node);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(nativeCalls, 0);
    } finally {
      api.runner.run = originalRun;
      api.bridge.run = originalNativeRun;
      await vscode.workspace.fs.delete(uri).then(() => undefined, () => undefined);
      await restoreSettings();
    }
  });

  test('watches custom filenames independently of the CodeLens pattern', async () => {
    const configUri = vscode.Uri.joinPath(fixture.uri, 'playwright.explorer-custom.config.ts');
    const directory = vscode.Uri.joinPath(fixture.uri, 'tests', 'explorer-custom');
    const testUri = vscode.Uri.joinPath(directory, 'alpha.case.ts');
    try {
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(configUri, Buffer.from("export default { testDir: './tests/nested', projects: [{ name: 'custom', testDir: './tests/explorer-custom', testMatch: '**/*.case.ts' }] };\n"));
      await waitUntil('custom config and empty directory', () => {
        const target = api.discovery.currentTargets.find((target) => target.configFile === configUri.fsPath);
        return Boolean(target && api.discovery.cachedModel(target.id));
      });
      await vscode.workspace.fs.writeFile(testUri, Buffer.from("import { test } from '@playwright/test';\ntest('custom explorer test', async () => {});\n"));
      await waitUntil('new custom test', () => tests().some((node) => node.label === 'custom explorer test' && api.explorer.selectionFor(node)));
      await vscode.workspace.fs.writeFile(testUri, Buffer.from("import { test } from '@playwright/test';\ntest('changed custom explorer test', async () => {});\n"));
      await waitUntil('saved custom test', () => tests().some((node) => node.label === 'changed custom explorer test' && api.explorer.selectionFor(node)));
      await vscode.workspace.fs.delete(testUri);
      await waitUntil('removed custom test', () => !tests().some((node) => node.selection?.uri === testUri.toString()));
    } finally {
      await vscode.workspace.fs.delete(configUri).then(() => undefined, () => undefined);
      await vscode.workspace.fs.delete(directory, { recursive: true }).then(() => undefined, () => undefined);
      await api.explorer.refresh();
    }
  });

  test('recovers automatically when an initially broken custom test is repaired', async () => {
    const configUri = vscode.Uri.joinPath(fixture.uri, 'playwright.explorer-recovery.config.ts');
    // Keep the custom project outside the other configs' test directories so
    // their inventory watchers cannot hide a missing watcher on this target.
    const directory = vscode.Uri.joinPath(fixture.uri, 'explorer-recovery');
    const testUri = vscode.Uri.joinPath(directory, 'broken.case.ts');
    try {
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(testUri, Buffer.from('const broken = ;\n'));
      await vscode.workspace.fs.writeFile(configUri, Buffer.from("export default { testDir: './tests/nested', projects: [{ name: 'recovery', testDir: './explorer-recovery', testMatch: '**/*.case.ts' }] };\n"));
      await waitUntil('initial custom test discovery failure', () => {
        const target = api.discovery.currentTargets.find((target) => target.configFile === configUri.fsPath);
        return Boolean(target && api.discovery.errorFor(target.id));
      });
      const target = api.discovery.currentTargets.find((target) => target.configFile === configUri.fsPath)!;
      assert.strictEqual(api.discovery.cachedModel(target.id), undefined);
      const config = elements().find((node) => node.kind === 'config' && node.targetId === target.id)!;
      assert.ok(api.explorer.getChildren(config).some((node) => node.kind === 'retry'));

      await vscode.workspace.fs.writeFile(testUri, Buffer.from("import { test } from '@playwright/test';\ntest('repaired custom explorer test', async () => {});\n"));
      await waitUntil('automatic recovery after custom test repair', () => tests().some((node) =>
        node.targetId === target.id && node.label === 'repaired custom explorer test' && api.explorer.selectionFor(node)));
      assert.strictEqual(api.discovery.errorFor(target.id), undefined);
      assert.ok(!api.explorer.getChildren(config).some((node) => node.kind === 'retry'));
    } finally {
      await vscode.workspace.fs.delete(configUri).then(() => undefined, () => undefined);
      await vscode.workspace.fs.delete(directory, { recursive: true }).then(() => undefined, () => undefined);
      await api.explorer.refresh();
    }
  });

  test('surfaces a broken config and recovers after it is repaired', async () => {
    const configUri = vscode.Uri.joinPath(fixture.uri, 'playwright.explorer-broken.config.ts');
    try {
      await vscode.workspace.fs.writeFile(configUri, Buffer.from('export default {\n'));
      await waitUntil('broken config error', () => {
        const target = api.discovery.currentTargets.find((target) => target.configFile === configUri.fsPath);
        return Boolean(target && api.discovery.errorFor(target.id));
      });
      const target = api.discovery.currentTargets.find((target) => target.configFile === configUri.fsPath)!;
      const config = elements().find((node) => node.kind === 'config' && node.targetId === target.id)!;
      assert.ok(api.explorer.getChildren(config).some((node) => node.kind === 'retry'));
      assert.ok(tests().some((node) => node.label === 'dynamic case 2' && api.explorer.selectionFor(node)));
      await vscode.workspace.fs.writeFile(configUri, Buffer.from("export default { testDir: './tests', testMatch: 'dynamic.spec.ts' };\n"));
      await waitUntil('repaired config tests', () => tests().filter((node) => node.targetId === target.id && api.explorer.selectionFor(node)).length === 3);
      assert.strictEqual(api.discovery.errorFor(target.id), undefined);
    } finally {
      await vscode.workspace.fs.delete(configUri).then(() => undefined, () => undefined);
      await api.explorer.refresh();
    }
  });

  test('removes the final target and ignores unrelated configless folders', () => {
    const internals = discoveryInternals();
    try {
      internals.targetsEmitter.fire([]);
      assert.deepStrictEqual(api.explorer.getChildren().filter((node) => node.kind !== 'runHistory').map((node) => node.label), ['No Playwright projects found.']);
      const target: RunTarget = { ...api.discovery.currentTargets[0], id: 'unrelated', configFile: undefined,
        cwd: path.join(fixture.uri.fsPath, '..', '..', '..', '..', '..', '..', 'nonexistent-explorer-project'),
        cli: { executable: 'npx', argsPrefix: ['--no-install', 'playwright'], source: 'package-manager' } };
      internals.targetsEmitter.fire([target]);
      assert.deepStrictEqual(api.explorer.getChildren().filter((node) => node.kind !== 'runHistory').map((node) => node.label), ['No Playwright projects found.']);
      internals.targetsEmitter.fire([{ ...target, configFile: '/missing/playwright.config.ts' }]);
      internals.emitter.fire({ target, error: 'Playwright CLI not found' });
      assert.ok(elements().some((node) => node.kind === 'message' && node.error === 'Playwright CLI not found'));
    } finally {
      internals.targetsEmitter.fire(api.discovery.currentTargets);
      for (const target of api.discovery.currentTargets) {
        internals.emitter.fire({ target, model: api.discovery.cachedModel(target.id), error: api.discovery.errorFor(target.id) });
      }
    }
  });

  function elements(parent?: ExplorerElement): ExplorerElement[] {
    return api.explorer.getChildren(parent).flatMap((node) => [node, ...elements(node)]);
  }

  function tests(): ExplorerTestNode[] {
    return elements().filter((node): node is ExplorerTestNode => node.kind === 'test');
  }

  function discoveryInternals() {
    return api.discovery as unknown as {
      emitter: vscode.EventEmitter<TargetDiscovery>;
      targetsEmitter: vscode.EventEmitter<readonly RunTarget[]>;
    };
  }

  async function configure(values: Record<string, unknown>): Promise<() => Promise<void>> {
    const config = vscode.workspace.getConfiguration('playwrightCodeLensRunner', fixture.uri);
    const previous = Object.keys(values).map((key) => [key, config.inspect(key)?.globalValue] as const);
    for (const [key, value] of Object.entries(values)) {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
    return async () => {
      for (const [key, value] of previous) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    };
  }
});

async function waitUntil(description: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
