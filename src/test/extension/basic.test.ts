import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditorTestSelection } from '../../core/editorSelections';
import { cliSelectionForEditor } from '../../core/selectionArguments';
import type { ExtensionApi } from '../../extension';

suite('Playwright CodeLens Runner extension', () => {
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

  test('registers the CodeLens companion commands', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    for (const command of [
      'playwrightCodeLensRunner.runTest',
      'playwrightCodeLensRunner.debugTest',
      'playwrightCodeLensRunner.inspectTest',
      'playwrightCodeLensRunner.openUi',
      'playwrightCodeLensRunner.openOfficialSettings',
      'playwrightCodeLensRunner.more',
      'playwrightCodeLensRunner.pickCase',
      'playwrightCodeLensRunner.showDiscoveryDetails',
      'playwrightCodeLensRunner.retryDiscovery',
      'playwrightCodeLensRunner.selectConfig',
    ]) {
      assert.ok(commands.has(command), `${command} is registered`);
    }
    assert.ok(!commands.has('playwrightCodeLensRunner.importJsonReport'));
    assert.ok(!commands.has('playwrightCodeLensRunner.updateSnapshots'));
  });

  test('retains no legacy command identifiers', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    for (const command of commands) {
      assert.ok(
        !command.startsWith('playwrightCliRunner.') && command !== 'playwrightCliRunner',
        `legacy command ${command} must not be registered`,
      );
    }
    assert.ok(!commands.has('playwrightCliRunner.migrateSettings'));
    assert.ok(!commands.has('playwright.runTest'));
    assert.ok(!commands.has('playwright.debugTest'));
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
    assert.ok([...titles].some((title) => title?.startsWith('$(settings-gear) CLI Config: ')));
  });

  test('automatically discovers and selects a conventional variant config', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'no-db-only.spec.ts');
    await vscode.workspace.openTextDocument(uri);
    await api.discovery.refreshAll();

    const target = api.discovery.currentTargets.find((candidate) => (
      candidate.configFile?.endsWith('playwright.no-db.config.ts')
    ));
    assert.ok(target, 'the no-database variant config is discovered automatically');

    const resolved = await api.discovery.resolveTargetForFile(uri.fsPath, { prompt: false });
    assert.strictEqual(resolved?.id, target.id, 'the variant config owns its matching test');

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
    const titles = new Set((lenses ?? []).map((lens) => lens.command?.title));
    assert.ok(titles.has('$(play) Run File'));
    assert.ok(titles.has('$(play) Run Test'));
    assert.ok([...titles].some((title) => title?.endsWith('CLI Config: playwright.no-db.config.ts')));
  });

  test('provides full, compact, and custom CodeLens layouts', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'example.spec.ts');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    await api.discovery.refreshAll();

    const configuration = vscode.workspace.getConfiguration('playwrightCodeLensRunner', uri);
    const keys = [
      'codeLens.layout',
      'codeLens.fileActions',
      'codeLens.suiteActions',
      'codeLens.testActions',
    ] as const;
    const previous = new Map(keys.map((key) => [key, configuration.inspect(key)?.globalValue]));

    try {
      await configuration.update('codeLens.layout', 'full', vscode.ConfigurationTarget.Global);
      assertLayout(await codeLenses(uri), {
        file: ['debugFile', 'more', 'openUi', 'runFile', 'selectConfig'],
        suite: ['debugTest', 'inspectTest', 'more', 'openUi', 'runTest'],
        test: ['debugTest', 'inspectTest', 'more', 'openUi', 'runTest'],
      });

      await configuration.update('codeLens.layout', 'compact', vscode.ConfigurationTarget.Global);
      assertLayout(await codeLenses(uri), {
        file: ['debugFile', 'more', 'runFile'],
        suite: ['debugTest', 'more', 'runTest'],
        test: ['debugTest', 'more', 'runTest'],
      });

      await configuration.update('codeLens.layout', 'companion-only', vscode.ConfigurationTarget.Global);
      assertLayout(await codeLenses(uri), {
        file: ['flakeLab', 'more', 'openUi', 'runCompanion', 'selectConfig'],
        suite: ['flakeLab', 'inspectTest', 'more', 'openUi', 'runCompanion'],
        test: ['flakeLab', 'inspectTest', 'more', 'openUi', 'runCompanion'],
      });

      await configuration.update('codeLens.fileActions', ['more'], vscode.ConfigurationTarget.Global);
      await configuration.update('codeLens.suiteActions', ['inspect'], vscode.ConfigurationTarget.Global);
      await configuration.update('codeLens.testActions', ['ui'], vscode.ConfigurationTarget.Global);
      await configuration.update('codeLens.layout', 'custom', vscode.ConfigurationTarget.Global);
      assertLayout(await codeLenses(uri), {
        file: ['more'],
        suite: ['inspectTest'],
        test: ['openUi'],
      });
    } finally {
      for (const key of keys) {
        await configuration.update(key, previous.get(key), vscode.ConfigurationTarget.Global);
      }
    }
  });

  test('provides one CodeLens group for a data-driven test declaration', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'dynamic.spec.ts');
    await vscode.workspace.openTextDocument(uri);
    await api.discovery.refreshAll();
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
    const runLenses = (lenses ?? []).filter((lens) => lens.command?.title === '$(play) Run Test');

    assert.strictEqual(runLenses.length, 1);
    const selection = runLenses[0].command?.arguments?.[0] as { titlePaths?: string[][] } | undefined;
    assert.strictEqual(selection?.titlePaths?.length, 3);
    assert.ok((lenses ?? []).some((lens) => lens.command?.title === 'Cases (3)…'));
  });

  test('discovers a file whose name contains regular-expression metacharacters', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'metachar[smoke]+.spec.ts');
    await vscode.workspace.openTextDocument(uri);
    const lenses = await codeLenses(uri);
    assert.ok(lenses.some((lens) => lens.command?.title === '$(play) Run File'));
    assert.ok(lenses.some((lens) => lens.command?.title === '$(play) Run Test'));
  });

  test('keeps nested file suites out of CLI title paths and scopes suites/tests by line', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'nested', 'scoped.spec.ts');
    await vscode.workspace.openTextDocument(uri);
    const lenses = await codeLenses(uri);
    const suiteLens = lenses.find((lens) => lens.command?.title === '$(eye) Inspect Suite');
    const testLens = lenses.find((lens) => lens.command?.title === '$(eye) Inspect Test');
    assert.ok(suiteLens?.command, 'nested suite Inspector lens is available');
    assert.ok(testLens?.command, 'nested test Inspector lens is available');

    const suiteSelection = suiteLens.command.arguments?.[0] as EditorTestSelection;
    const testSelection = testLens.command.arguments?.[0] as EditorTestSelection;
    assert.deepStrictEqual(suiteSelection.titlePath, ['nested suite']);
    assert.deepStrictEqual(testSelection.titlePath, ['nested suite', 'nested test']);
    assert.strictEqual(cliSelectionForEditor(suiteSelection).line, suiteSelection.position.line + 1);
    assert.strictEqual(cliSelectionForEditor(testSelection).line, testSelection.position.line + 1);
  });

  test('keeps flattened title collisions distinct with source-line scope', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'title-collisions.spec.ts');
    await vscode.workspace.openTextDocument(uri);
    const lenses = await codeLenses(uri);
    const inspectSelections = lenses
      .filter((lens) => lens.command?.command === 'playwrightCodeLensRunner.inspectTest')
      .map((lens) => lens.command?.arguments?.[0] as EditorTestSelection);

    const nested = inspectSelections.find((selection) => selection.titlePath?.join(' › ') === 'foo › bar');
    const flattened = inspectSelections.find((selection) => selection.titlePath?.join(' › ') === 'foo bar');
    assert.ok(nested, 'nested foo/bar test is discovered');
    assert.ok(flattened, 'top-level foo bar test is discovered');
    assert.notStrictEqual(nested.position.line, flattened.position.line);
    assert.strictEqual(cliSelectionForEditor(nested).line, nested.position.line + 1);
    assert.strictEqual(cliSelectionForEditor(flattened).line, flattened.position.line + 1);
  });

  test('a CodeLens run is executed exactly once by the Microsoft extension', async () => {
    const restoreAutoFocus = await disableAutoFocus(fixture.uri);
    const marker = vscode.Uri.joinPath(fixture.uri, 'official-run-marker.txt');
    try {
      await vscode.workspace.fs.delete(marker);
    } catch {
      // The first run has no marker yet.
    }

    try {
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
    } finally {
      await restoreAutoFocus();
    }
  });

  test('file Run delegates by URI without companion CLI discovery', async () => {
    const restoreAutoFocus = await disableAutoFocus(fixture.uri);
    const marker = vscode.Uri.joinPath(fixture.uri, 'official-run-marker.txt');
    try {
      await vscode.workspace.fs.delete(marker);
    } catch {
      // The preceding test may already have cleaned the marker.
    }
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'delegation.spec.ts');
    await vscode.commands.executeCommand('testing.refreshTests');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    let resolutionCalled = false;
    const originalResolve = api.discovery.resolveTargetForFile;
    api.discovery.resolveTargetForFile = async () => {
      resolutionCalled = true;
      throw new Error('native file runs must not resolve a companion CLI target');
    };
    try {
      await vscode.commands.executeCommand('playwrightCodeLensRunner.runFile', uri);
      assert.deepStrictEqual(await waitForMarker(marker), ['run']);
    } finally {
      api.discovery.resolveTargetForFile = originalResolve;
      await restoreAutoFocus();
    }
    assert.strictEqual(resolutionCalled, false);
  });

  test('rebuilds resolved targets when execution settings change', async () => {
    const configuration = vscode.workspace.getConfiguration('playwrightCodeLensRunner', fixture.uri);
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
        () => api.discovery.currentTargets.length > 0
          && api.discovery.currentTargets.every((target) => target.env.PW_COMPANION_SETTINGS_TEST !== marker),
      );
    }
  });

  test('shows discovery recovery actions when the CLI fails', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'example.spec.ts');
    const configuration = vscode.workspace.getConfiguration('playwrightCodeLensRunner', uri);
    const previous = configuration.inspect<string>('cli.executable')?.globalValue;
    const missing = `playwright-codelens-missing-${Date.now()}`;
    try {
      await configuration.update('cli.executable', missing, vscode.ConfigurationTarget.Global);
      await waitUntil(
        'resolved target CLI to be rebuilt',
        () => api.discovery.currentTargets.some((target) => target.cli.executable === missing),
      );
      const titles = new Set((await codeLenses(uri)).map((lens) => lens.command?.title));
      assert.ok(titles.has('$(warning) Discovery failed'));
      assert.ok(titles.has('Details'));
      assert.ok(titles.has('Retry'));
      assert.ok(titles.has('Choose CLI Config…'));
    } finally {
      await configuration.update('cli.executable', previous, vscode.ConfigurationTarget.Global);
      await waitUntil(
        'resolved target CLI to be restored',
        () => api.discovery.currentTargets.length > 0
          && api.discovery.currentTargets.every((target) => target.cli.executable !== missing),
      );
    }
  });

  test('refreshes discovery after an external-style test file change', async () => {
    const target = api.discovery.currentTargets[0] ?? (await api.discovery.refreshTargets())[0];
    assert.ok(target, 'fixture target is available');
    await api.discovery.discover(target, undefined, true);
    const before = api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0;
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', `watcher-${Date.now()}.spec.ts`);
    try {
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from("import { test } from '@playwright/test';\ntest('watcher refresh', async () => {});\n"),
      );
      await waitUntil(
        'file watcher to refresh the owning target',
        () => (api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0) > before,
      );
    } finally {
      try {
        await vscode.workspace.fs.delete(uri);
      } catch {
        // The file may not have been created if the assertion failed early.
      }
    }
  });

  test('refreshes a conventional variant config after an external-style change', async () => {
    const configUri = vscode.Uri.joinPath(fixture.uri, 'playwright.no-db.config.ts');
    const original = Buffer.from(await vscode.workspace.fs.readFile(configUri)).toString('utf8');
    await api.discovery.refreshTargets();
    const target = api.discovery.currentTargets.find((candidate) => (
      candidate.configFile === configUri.fsPath
    ));
    assert.ok(target, 'the variant config is an active discovery target');
    await api.discovery.discover(target, undefined, true);
    const before = api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0;
    const marker = `variant-config-watcher-${Date.now()}`;

    try {
      await vscode.workspace.fs.writeFile(configUri, Buffer.from(`${original}\n// ${marker}\n`));
      await waitUntil(
        'variant config watcher to rescan and refresh its target',
        () => (api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0) > before,
      );
    } finally {
      const beforeRestore = api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0;
      await vscode.workspace.fs.writeFile(configUri, Buffer.from(original));
      await waitUntil(
        'variant config watcher to refresh after restoring the fixture',
        () => (api.discovery.diagnosticsFor(target.id)?.startedAt ?? 0) > beforeRestore,
      );
    }
  });

  test('forced discovery re-probes a previously unsupported target', async () => {
    const target = api.discovery.currentTargets[0] ?? (await api.discovery.refreshTargets())[0];
    assert.ok(target, 'fixture target is available');
    const internals = api.discovery as unknown as {
      unsupported: Map<string, string>;
      versions: Map<string, string>;
    };
    internals.versions.set(target.id, 'Version 1.37.0');
    internals.unsupported.set(target.id, 'synthetic unsupported-version result');

    const model = await api.discovery.discover(target, undefined, true);
    assert.ok(model, 'forced refresh recovered after the synthetic upgrade');
    assert.ok(!api.discovery.errorFor(target.id)?.includes('synthetic unsupported-version result'));
    assert.ok(!internals.versions.get(target.id)?.includes('1.37.0'), 'the real CLI version replaced the cached unsupported version');
  });

  test('serializes overlapping forced discoveries for one target', async () => {
    const target = api.discovery.currentTargets[0] ?? (await api.discovery.refreshTargets())[0];
    assert.ok(target, 'fixture target is available');

    const [first, second] = await Promise.all([
      api.discovery.discover(target, undefined, true),
      api.discovery.discover(target, undefined, true),
    ]);
    assert.ok(first, 'the earlier forced refresh is not cancelled by the later refresh');
    assert.ok(second, 'the later forced refresh completes after the earlier refresh');
  });

  test('redacts sensitive CLI argument values from discovery diagnostics', async () => {
    const source = api.discovery.currentTargets[0] ?? (await api.discovery.refreshTargets())[0];
    assert.ok(source, 'fixture target is available');
    const secret = `diagnostic-secret-${Date.now()}`;
    const target = {
      ...source,
      id: `diagnostics:${Date.now()}`,
      env: { ...source.env, PW_DIAGNOSTIC_SECRET: secret },
      cli: {
        executable: 'playwright-codelens-runner-command-that-does-not-exist',
        argsPrefix: ['--token', secret],
        source: 'explicit' as const,
      },
    };

    const model = await api.discovery.discover(target, undefined, true);
    assert.strictEqual(model, undefined);
    const diagnostics = api.discovery.diagnosticsFor(target.id);
    assert.ok(diagnostics, 'failed discovery records diagnostics');
    assert.ok(!diagnostics.commandPreview.includes(secret), 'command preview redacts the adjacent token value');
    assert.ok(!diagnostics.error?.includes(secret), 'error text redacts the adjacent token value');

    const internals = api.discovery as unknown as {
      recordDiagnostics(
        diagnosticTarget: typeof target,
        startedAt: number,
        cliVersion: string,
        args: string[],
        scopeFile: string | undefined,
        projects: string[],
        error: string | undefined,
      ): void;
    };
    internals.recordDiagnostics(
      target,
      Date.now(),
      `Version ${secret}`,
      [],
      undefined,
      [`project-${secret}`],
      undefined,
    );
    assert.ok(!JSON.stringify(api.discovery.diagnosticsFor(target.id)).includes(secret));
  });

  test('discovery palette commands resolve the active Playwright file', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'tests', 'example.spec.ts');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    const target = await api.discovery.resolveTargetForFile(uri.fsPath, { prompt: false });
    assert.ok(target, 'active file resolves to a discovery target');
    await api.discovery.discoverForFile(target, uri.fsPath, undefined, true);

    let shownTarget: string | undefined;
    let shownFile: string | undefined;
    const originalShowDiagnostics = api.discovery.showDiagnostics;
    api.discovery.showDiagnostics = (targetId: string, scopeFile?: string) => {
      shownTarget = targetId;
      shownFile = scopeFile;
    };
    try {
      await vscode.commands.executeCommand('playwrightCodeLensRunner.showDiscoveryDetails');
    } finally {
      api.discovery.showDiagnostics = originalShowDiagnostics;
    }
    assert.strictEqual(shownTarget, target.id, 'Details uses the active file target without a CodeLens payload');
    assert.strictEqual(shownFile, uri.fsPath, 'Details preserves active-file diagnostic scope');

    const before = api.discovery.diagnosticsFor(target.id, uri.fsPath)?.startedAt ?? 0;
    await delay(5);
    await vscode.commands.executeCommand('playwrightCodeLensRunner.retryDiscovery');
    const after = api.discovery.diagnosticsFor(target.id, uri.fsPath)?.startedAt ?? 0;
    assert.ok(after > before, 'Retry performs fresh file-scoped discovery for the active file');
  });

  test('discovery palette commands do not scope to an unrelated active document', async () => {
    const uri = vscode.Uri.joinPath(fixture.uri, 'package.json');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    const configuration = vscode.workspace.getConfiguration('playwrightCodeLensRunner', fixture.uri);
    const previousConfigFiles = configuration.inspect<string[]>('configFiles')?.globalValue;
    await configuration.update('configFiles', ['playwright.config.ts'], vscode.ConfigurationTarget.Global);
    await waitUntil('one unambiguous target after constraining config files', () => api.discovery.currentTargets.length === 1);
    const target = api.discovery.currentTargets[0];
    const model = api.discovery.cachedModel(target.id) ?? await api.discovery.discover(target);
    assert.ok(model, 'fixture discovery model is available');

    let shownTarget: string | undefined;
    let shownFile: string | undefined;
    const originalShowDiagnostics = api.discovery.showDiagnostics;
    api.discovery.showDiagnostics = (targetId: string, scopeFile?: string) => {
      shownTarget = targetId;
      shownFile = scopeFile;
    };
    try {
      await vscode.commands.executeCommand('playwrightCodeLensRunner.showDiscoveryDetails');
    } finally {
      api.discovery.showDiagnostics = originalShowDiagnostics;
    }
    assert.strictEqual(shownTarget, target.id, 'Details falls back to the unambiguous config');
    assert.strictEqual(shownFile, undefined, 'Details does not use an unrelated document as file scope');

    let targetWideRetries = 0;
    let fileScopedRetries = 0;
    const originalDiscover = api.discovery.discover;
    const originalDiscoverForFile = api.discovery.discoverForFile;
    api.discovery.discover = async () => {
      targetWideRetries++;
      return model;
    };
    api.discovery.discoverForFile = async () => {
      fileScopedRetries++;
      return model;
    };
    try {
      await vscode.commands.executeCommand('playwrightCodeLensRunner.retryDiscovery');
    } finally {
      api.discovery.discover = originalDiscover;
      api.discovery.discoverForFile = originalDiscoverForFile;
      await configuration.update('configFiles', previousConfigFiles, vscode.ConfigurationTarget.Global);
      await waitUntil('target list to restore after config constraint', () => api.discovery.currentTargets.length > 1);
    }
    assert.strictEqual(targetWideRetries, 1, 'Retry refreshes the selected config');
    assert.strictEqual(fileScopedRetries, 0, 'Retry does not refresh an unrelated document as a Playwright file');
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

async function disableAutoFocus(resource: vscode.Uri): Promise<() => PromiseLike<void>> {
  const configuration = vscode.workspace.getConfiguration('playwrightCodeLensRunner', resource);
  const previous = configuration.inspect<boolean>('sidebar.autoFocus')?.globalValue;
  await configuration.update('sidebar.autoFocus', false, vscode.ConfigurationTarget.Global);
  return () => configuration.update('sidebar.autoFocus', previous, vscode.ConfigurationTarget.Global);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function codeLenses(uri: vscode.Uri): Promise<vscode.CodeLens[]> {
  return (await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri)) ?? [];
}

type SelectionKind = 'file' | 'suite' | 'test';

function assertLayout(
  lenses: vscode.CodeLens[],
  expected: Record<SelectionKind, string[]>,
): void {
  const prefix = 'playwrightCodeLensRunner.';
  for (const kind of ['file', 'suite', 'test'] as const) {
    const commands = new Set<string>();
    for (const lens of lenses) {
      const selection = lens.command?.arguments?.[0] as { kind?: string } | undefined;
      if (selection?.kind === kind && lens.command?.command.startsWith(prefix)) {
        commands.add(lens.command.command.slice(prefix.length));
      }
    }
    assert.deepStrictEqual([...commands].sort(), [...expected[kind]].sort(), `${kind} CodeLens commands`);
  }
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
