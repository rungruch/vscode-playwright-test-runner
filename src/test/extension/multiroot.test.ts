import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../extension';
import { resolveRunTarget } from '../../runTarget';
import { Settings } from '../../settings';

suite('multi-root workspace discovery', () => {
  let api: ExtensionApi;

  suiteSetup(async () => {
    const official = vscode.extensions.getExtension('ms-playwright.playwright');
    assert.ok(official, 'the required Microsoft Playwright extension is installed');
    await official.activate();

    const extension = vscode.extensions.getExtension<ExtensionApi>('rungruch.playwright-codelens-runner');
    assert.ok(extension, 'extension is installed in the development host');
    api = await extension.activate();
    assert.ok(api, 'extension activates in a trusted workspace');
    assert.strictEqual(vscode.workspace.workspaceFolders?.length, 2, 'both workspace roots are open');
    await api.discovery.refreshTargets();
  });

  test('discovers root, overlapping, sibling-testDir, and second-root configs', async () => {
    await api.discovery.refreshAll();
    const configs = api.discovery.currentTargets
      .map((target) => target.configFile ?? '')
      .filter((configFile) => configFile.length > 0)
      .sort();
    assert.strictEqual(configs.length, 5, `expected five configs, found: ${configs.join(', ')}`);
    assert.ok(configs.some((configFile) => configFile.endsWith('app1/playwright.config.ts')));
    assert.ok(configs.some((configFile) => configFile.endsWith('app1/configs/playwright.config.ts')));
    assert.ok(configs.some((configFile) => configFile.endsWith('app1/cross-root/playwright.config.ts')));
    assert.ok(configs.some((configFile) => configFile.endsWith('app1/tests/playwright.config.ts')));
    assert.ok(configs.some((configFile) => configFile.endsWith('app2/playwright.config.ts')));

    for (const target of api.discovery.currentTargets) {
      assert.strictEqual(api.discovery.errorFor(target.id), undefined, `no discovery error for ${target.id}`);
      const model = await api.discovery.discover(target);
      assert.ok(model, `discovery succeeds for ${target.id}`);
    }
  });

  test('discovers the tests owned by each nested config', async () => {
    await api.discovery.refreshAll();
    for (const target of api.discovery.currentTargets) {
      const model = await api.discovery.discover(target);
      assert.ok(model);
      const titles = model.files.flatMap((file) => file.tests.map((test) => test.title));
      const expected = target.configFile?.includes(`${path.sep}cross-root${path.sep}`)
        || target.configFile?.includes(`${path.sep}app2${path.sep}`)
        ? ['app2 test']
        : ['app1 test'];
      assert.deepStrictEqual(titles, expected, `tests owned by ${target.configFile}`);
    }
  });

  test('scopes target identities by workspace even for one shared config', () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders?.[0] && folders[1]);
    const sharedConfig = vscode.Uri.joinPath(folders[0].uri, 'playwright.config.ts').fsPath;
    const first = resolveRunTarget(folders[0], sharedConfig, new Settings(folders[0].uri));
    const second = resolveRunTarget(folders[1], sharedConfig, new Settings(folders[1].uri));
    assert.notStrictEqual(first.id, second.id);
  });

  test('resolves and remembers an overlapping config with a sibling testDir noninteractively', async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    assert.ok(root, 'app1 workspace folder is open');
    const uri = vscode.Uri.joinPath(root.uri, 'tests', 'app1.spec.ts');
    const targets = app1Targets();
    const nested = targets.find((target) => target.configFile?.includes(`${path.sep}configs${path.sep}`));
    assert.ok(nested, 'nested sibling-testDir config is available');

    const context = discoveryContext();
    const key = configOwnerKey(uri.fsPath);
    try {
      await context.workspaceState.update(key, nested.id);
      const resolved = await api.discovery.resolveTargetForFile(uri.fsPath, { prompt: false });
      assert.strictEqual(resolved?.id, nested.id, 'noninteractive resolution honors persisted ownership');
      const model = await api.discovery.discoverForFile(nested, uri.fsPath);
      assert.ok(model?.files.some((file) => path.normalize(file.file) === path.normalize(uri.fsPath)));
    } finally {
      await context.workspaceState.update(key, undefined);
    }
  });

  test('honors a persisted config whose testDir crosses workspace roots', async () => {
    const app2 = vscode.workspace.workspaceFolders?.[1];
    assert.ok(app2, 'app2 workspace folder is open');
    const uri = vscode.Uri.joinPath(app2.uri, 'tests', 'app2.spec.ts');
    const crossRoot = app1Targets().find((target) => target.configFile?.includes(`${path.sep}cross-root${path.sep}`));
    assert.ok(crossRoot, 'cross-root config is available');

    const context = discoveryContext();
    const key = configOwnerKey(uri.fsPath);
    try {
      await context.workspaceState.update(key, crossRoot.id);
      const resolved = await api.discovery.resolveTargetForFile(uri.fsPath, { prompt: false });
      assert.strictEqual(resolved?.id, crossRoot.id);
      const model = await api.discovery.discoverForFile(crossRoot, uri.fsPath);
      assert.ok(model?.files.some((file) => path.normalize(file.file) === path.normalize(uri.fsPath)));
    } finally {
      await context.workspaceState.update(key, undefined);
    }
  });

  test('drops a persisted owner that no longer includes the file', async () => {
    const app1 = vscode.workspace.workspaceFolders?.[0];
    assert.ok(app1, 'app1 workspace folder is open');
    const uri = vscode.Uri.joinPath(app1.uri, 'tests', 'app1.spec.ts');
    const stale = app1Targets().find((target) => target.configFile === vscode.Uri.joinPath(app1.uri, 'playwright.config.ts').fsPath);
    assert.ok(stale, 'root config is available');
    const scoped = await api.discovery.discoverForFile(stale, uri.fsPath);
    assert.ok(scoped?.files.length, 'the owner starts valid');

    const context = discoveryContext();
    const key = configOwnerKey(uri.fsPath);
    const cacheKey = `${stale.id}\0${path.normalize(uri.fsPath)}`;
    const internals = api.discovery as unknown as { fileCache: Map<string, typeof scoped> };
    try {
      await context.workspaceState.update(key, stale.id);
      internals.fileCache.set(cacheKey, { ...scoped, files: [] });
      const resolved = await api.discovery.resolveTargetForFile(uri.fsPath, { prompt: false });
      assert.ok(resolved && resolved.id !== stale.id, 'another current owner replaces the stale choice');
      assert.strictEqual(context.workspaceState.get<string>(key), undefined, 'the stale persisted choice is cleared');
    } finally {
      internals.fileCache.delete(cacheKey);
      await context.workspaceState.update(key, undefined);
    }
  });

  test('refreshes the persisted owner instead of only the deepest config', async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    assert.ok(root, 'app1 workspace folder is open');
    const uri = vscode.Uri.joinPath(root.uri, 'tests', 'app1.spec.ts');
    const rootTarget = app1Targets().find((target) => target.configFile === vscode.Uri.joinPath(root.uri, 'playwright.config.ts').fsPath);
    assert.ok(rootTarget, 'app1 root config is available');

    const context = discoveryContext();
    const key = configOwnerKey(uri.fsPath);
    try {
      await context.workspaceState.update(key, rootTarget.id);
      await api.discovery.discoverForFile(rootTarget, uri.fsPath, undefined, true);
      const before = api.discovery.diagnosticsFor(rootTarget.id)?.startedAt ?? 0;
      await delay(5);
      const internals = api.discovery as unknown as {
        refreshForFiles(changes: Array<{ path: string; rescan: boolean }>): Promise<void>;
      };
      await internals.refreshForFiles([{ path: uri.fsPath, rescan: false }]);
      const after = api.discovery.diagnosticsFor(rootTarget.id)?.startedAt ?? 0;
      assert.ok(after > before, 'the persisted root owner is refreshed after its test file changes');
    } finally {
      await context.workspaceState.update(key, undefined);
    }
  });

  test('refreshes sibling and cross-root candidates when a new test file appears', async () => {
    await api.discovery.refreshAll();
    const targets = [...api.discovery.currentTargets];
    const before = new Map(targets.map((target) => [target.id, api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0]));
    const app2 = vscode.workspace.workspaceFolders?.[1];
    assert.ok(app2, 'app2 workspace folder is open');
    const uri = vscode.Uri.joinPath(app2.uri, 'tests', `created-${Date.now()}.spec.ts`);
    await delay(5);
    try {
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from("import { test } from '@playwright/test';\ntest('created test', async () => {});\n"),
      );
      await waitUntil(
        'all potential owners to refresh after file creation',
        () => targets.every((target) => (
          (api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0) > (before.get(target.id) ?? 0)
        )),
      );
    } finally {
      try {
        await vscode.workspace.fs.delete(uri);
      } catch {
        // The test file may not exist if creation failed.
      }
    }
  });

  test('provides CodeLens actions in both workspace roots', async () => {
    await api.discovery.refreshAll();
    for (const [app, folder] of [['app1', 0], ['app2', 1]] as const) {
      const root = vscode.workspace.workspaceFolders?.[folder];
      assert.ok(root, `${app} workspace folder is open`);
      const uri = vscode.Uri.joinPath(root.uri, 'tests', `${app}.spec.ts`);
      await vscode.workspace.openTextDocument(uri);

      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
      const titles = new Set((lenses ?? []).map((lens) => lens.command?.title));
      assert.ok(titles.has('$(play) Run File'), `${app} Run File lens is present`);
      assert.ok(titles.has('$(play) Run Test'), `${app} Run Test lens is present`);
      assert.ok(titles.has('$(eye) Inspect Test'), `${app} Inspect Test lens is present`);
      assert.ok(titles.has('$(browser) Playwright UI'), `${app} Playwright UI lens is present`);
    }
  });

  function app1Targets() {
    return api.discovery.currentTargets.filter((target) => target.configFile?.includes(`${path.sep}app1${path.sep}`));
  }

  function discoveryContext(): vscode.ExtensionContext {
    return (api.discovery as unknown as { context: vscode.ExtensionContext }).context;
  }
});

function configOwnerKey(fsPath: string): string {
  return `playwrightCodeLensRunner.configOwner:${path.normalize(fsPath)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(message: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(50);
  }
  assert.fail(`timed out waiting for ${message}`);
}
