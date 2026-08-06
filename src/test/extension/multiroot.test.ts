import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../extension';

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
  });

  test('discovers one target per nested config across workspace roots', async () => {
    await api.discovery.refreshAll();
    const configs = api.discovery.currentTargets
      .map((target) => target.configFile ?? '')
      .filter((configFile) => configFile.length > 0)
      .sort();
    assert.strictEqual(configs.length, 2, `expected two nested configs, found: ${configs.join(', ')}`);
    assert.ok(configs.some((configFile) => configFile.endsWith('app1/playwright.config.ts')));
    assert.ok(configs.some((configFile) => configFile.endsWith('app2/playwright.config.ts')));

    for (const target of api.discovery.currentTargets) {
      assert.strictEqual(api.discovery.errorFor(target.id), undefined, `no discovery error for ${target.id}`);
      const model = await api.discovery.discover(target);
      assert.ok(model, `discovery succeeds for ${target.id}`);
    }
  });

  test('discovers the tests owned by each nested config', async () => {
    await api.discovery.refreshAll();
    const titlesByApp = new Map<string, string[]>();
    for (const target of api.discovery.currentTargets) {
      const model = await api.discovery.discover(target);
      assert.ok(model);
      const app = target.configFile?.includes('app1') ? 'app1' : 'app2';
      titlesByApp.set(app, model.files.flatMap((file) => file.tests.map((test) => test.title)));
    }
    assert.deepStrictEqual(titlesByApp.get('app1'), ['app1 test']);
    assert.deepStrictEqual(titlesByApp.get('app2'), ['app2 test']);
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
});
