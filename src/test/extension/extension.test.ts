import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../extension';

suite('Playwright CLI Test Runner extension', () => {
  let api: ExtensionApi;
  let fixture: vscode.WorkspaceFolder;

  suiteSetup(async () => {
    const official = vscode.extensions.getExtension('ms-playwright.playwright');
    assert.ok(official, 'the required Microsoft Playwright extension is installed');
    await official.activate();

    const extension = vscode.extensions.getExtension<ExtensionApi>('rungruch.playwright-cli-test-runner');
    assert.ok(extension, 'extension is installed in the development host');
    api = await extension.activate();
    assert.ok(api, 'extension activates in a trusted workspace');
    assert.ok(api.discovery);
    assert.ok(api.projects);
    assert.ok(api.bridge);

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'fixture workspace is open');
    fixture = folder;
  });

  suiteTeardown(async () => {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(fixture.uri, 'official-run-marker.txt'));
    } catch {
      // No marker is expected when the delegated run never started.
    }
  });

  test('registers the editor-first commands', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    assert.ok(commands.has('playwrightCliRunner.runTest'));
    assert.ok(commands.has('playwrightCliRunner.debugTest'));
    assert.ok(commands.has('playwrightCliRunner.inspectTest'));
    assert.ok(commands.has('playwrightCliRunner.openUi'));
    assert.ok(commands.has('playwrightCliRunner.openOfficialSettings'));
    assert.ok(!commands.has('playwrightCliRunner.importJsonReport'));
    assert.ok(!commands.has('playwrightCliRunner.updateSnapshots'));
  });

  test('provides file, suite, and test CodeLens actions', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'example.spec.ts');
    await vscode.workspace.openTextDocument(uri);
    await api.discovery.refreshAll();

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
    const titles = new Set((lenses ?? []).map((lens) => lens.command?.title));

    assert.ok(titles.has('$(play) Run File'));
    assert.ok(titles.has('$(browser) Playwright UI'));
    assert.ok(titles.has('$(play) Run Suite'));
    assert.ok(titles.has('$(eye) Inspect Suite'));
    assert.ok(titles.has('$(play) Run Test'));
    assert.ok(titles.has('$(eye) Inspect Test'));
  });

  test('a CodeLens run is executed exactly once by the Microsoft extension', async () => {
    const marker = vscode.Uri.joinPath(fixture.uri, 'official-run-marker.txt');
    try {
      await vscode.workspace.fs.delete(marker);
    } catch {
      // The first run has no marker yet.
    }

    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'delegation.spec.ts');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    await api.discovery.refreshAll();
    await vscode.commands.executeCommand('testing.refreshTests');

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
    const runLens = (lenses ?? []).find((lens) => lens.command?.title === '$(play) Run Test');
    assert.ok(runLens?.command, 'test Run CodeLens is available');

    await vscode.commands.executeCommand(runLens.command.command, ...(runLens.command.arguments ?? []));
    const lines = await waitForMarker(marker);
    assert.deepStrictEqual(lines, ['run'], 'only the official TestController executes the selected test');
  });

  test('rebuilds resolved targets when execution settings change', async () => {
    const configuration = vscode.workspace.getConfiguration('playwrightCliRunner', fixture.uri);
    const previous = configuration.inspect<Record<string, string>>('environment')?.globalValue;
    const marker = `settings-${Date.now()}`;
    try {
      await configuration.update(
        'environment',
        { PW_COMPANION_SETTINGS_TEST: marker },
        vscode.ConfigurationTarget.Global,
      );
      await waitUntil(
        'resolved target environment to be rebuilt',
        () => api.discovery.currentTargets.some((target) => target.env.PW_COMPANION_SETTINGS_TEST === marker),
      );
    } finally {
      await configuration.update('environment', previous, vscode.ConfigurationTarget.Global);
      await waitUntil(
        'resolved target environment to be restored',
        () => api.discovery.currentTargets.every((target) => target.env.PW_COMPANION_SETTINGS_TEST !== marker),
      );
    }
  });

  test('forced discovery re-probes a previously unsupported target', async () => {
    const target = api.discovery.currentTargets[0] ?? (await api.discovery.refreshTargets())[0];
    assert.ok(target, 'fixture target is available');
    const internals = api.discovery as unknown as { unsupported: Map<string, string> };
    internals.unsupported.set(target.id, 'synthetic unsupported-version result');

    const model = await api.discovery.discover(target, undefined, true);
    assert.ok(model, 'forced refresh recovered after the synthetic upgrade');
    assert.ok(!api.discovery.errorFor(target.id)?.includes('synthetic unsupported-version result'));
  });

});

async function waitForMarker(uri: vscode.Uri): Promise<string[]> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const contents = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const lines = contents.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length > 0) {
        await delay(1_000);
        const settled = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        return settled.trim().split(/\r?\n/).filter(Boolean);
      }
    } catch {
      // The official provider has not finished the test yet.
    }
    await delay(100);
  }
  assert.fail('timed out waiting for the official Playwright run marker');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(description: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(100);
  }
  assert.fail(`timed out waiting for ${description}`);
}
