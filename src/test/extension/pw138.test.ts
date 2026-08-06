import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../extension';

suite('Playwright 1.38 compatibility smoke', () => {
  let api: ExtensionApi;
  let fixture: vscode.WorkspaceFolder;

  suiteSetup(async () => {
    const official = vscode.extensions.getExtension('ms-playwright.playwright');
    assert.ok(official, 'the required Microsoft Playwright extension is installed');
    await official.activate();

    const extension = vscode.extensions.getExtension<ExtensionApi>('rungruch.playwright-codelens-runner');
    assert.ok(extension, 'extension is installed in the development host');
    api = await extension.activate();
    assert.ok(api, 'extension activates in a trusted workspace');

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'pw138 fixture workspace is open');
    fixture = folder;
  });

  test('discovers tests through the minimum supported Playwright release', async () => {
    await api.discovery.refreshAll();
    const target = api.discovery.currentTargets.find((candidate) => candidate.configFile?.endsWith('playwright.config.ts'));
    assert.ok(target, 'the pw138 fixture config is discovered');
    assert.strictEqual(api.discovery.errorFor(target.id), undefined, 'Playwright 1.38.0 satisfies the compatibility floor');

    const model = await api.discovery.discover(target);
    assert.ok(model, 'discovery succeeds on Playwright 1.38.0');
    const file = model.files.find((candidate) => candidate.relativeFile.endsWith('example.spec.ts'));
    assert.ok(file, 'example.spec.ts is discovered');
    const titles = [
      ...file.suites.flatMap((suite) => suite.tests.map((test) => test.title)),
      ...file.tests.map((test) => test.title),
    ];
    assert.deepStrictEqual(titles, ['adds numbers']);
    assert.deepStrictEqual(model.projects, ['project-a']);
  });

  test('provides CodeLens actions for the minimum supported release', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'example.spec.ts');
    await vscode.workspace.openTextDocument(uri);
    await api.discovery.refreshAll();

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
    const titles = new Set((lenses ?? []).map((lens) => lens.command?.title));
    assert.ok(titles.has('$(play) Run File'));
    assert.ok(titles.has('$(play) Run Test'));
    assert.ok(titles.has('$(eye) Inspect Test'));
    assert.ok(titles.has('$(browser) Playwright UI'));
  });
});
