import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface Manifest {
  name?: string;
  displayName?: string;
  version?: string;
  engines?: { vscode?: string; node?: string };
  activationEvents?: string[];
  contributes?: {
    configuration?: Array<{
      properties?: Record<string, {
        default?: unknown;
        enum?: unknown[];
        scope?: string;
        uniqueItems?: boolean;
        items?: { enum?: unknown[] };
      }>;
    }>;
    commands?: Array<{ command: string }>;
    menus?: Record<string, Array<{ command: string; when?: string }>>;
    viewsContainers?: { activitybar?: Array<{ id: string; title: string; icon?: string }> };
    views?: Record<string, Array<{ id: string; name: string; when?: string }>>;
  };
}

suite('extension manifest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as Manifest;

  test('activates custom configured layouts after startup', () => {
    assert.ok(manifest.activationEvents?.includes('onStartupFinished'));
  });

  test('activates for conventional variant Playwright config names', () => {
    assert.ok(manifest.activationEvents?.includes('workspaceContains:**/playwright*.config.ts'));
  });

  test('uses the Playwright CodeLens Runner marketplace identity', () => {
    assert.strictEqual(manifest.name, 'playwright-codelens-runner');
    assert.strictEqual(manifest.displayName, 'Playwright CodeLens Runner');
  });

  test('declares the 3.3.0 release and platform floors', () => {
    assert.strictEqual(manifest.version, '3.3.0');
    assert.strictEqual(manifest.engines?.vscode, '^1.125.0');
    assert.strictEqual(manifest.engines?.node, '>=22.13.0');
  });

  test('contributes the Inspector and top-level browser choices with config as the default', () => {
    const properties = manifest.contributes?.configuration?.[0].properties ?? {};
    const topBrowser = properties['playwrightCodeLensRunner.browser'];
    assert.strictEqual(topBrowser?.default, 'config');
    assert.deepStrictEqual(topBrowser?.enum, ['config', 'chromium', 'firefox', 'webkit']);

    const setting = properties['playwrightCodeLensRunner.inspector.browser'];
    assert.strictEqual(setting?.default, 'config');
    assert.deepStrictEqual(setting?.enum, ['config', 'chromium', 'firefox', 'webkit']);
  });

  test('contributes validated full, compact, and custom CodeLens settings', () => {
    const properties = manifest.contributes?.configuration?.[0].properties ?? {};
    const layout = properties['playwrightCodeLensRunner.codeLens.layout'];
    assert.strictEqual(layout?.default, 'full');
    assert.deepStrictEqual(layout?.enum, ['full', 'compact', 'custom']);

    const expected = {
      fileActions: {
        allowed: ['run', 'debug', 'ui', 'config', 'more'],
        defaults: ['run', 'debug', 'ui', 'config'],
      },
      suiteActions: {
        allowed: ['run', 'debug', 'inspect', 'ui', 'more'],
        defaults: ['run', 'debug', 'inspect', 'ui'],
      },
      testActions: {
        allowed: ['run', 'debug', 'inspect', 'ui', 'cases', 'more'],
        defaults: ['run', 'debug', 'inspect', 'ui', 'cases'],
      },
    } as const;
    for (const [name, values] of Object.entries(expected)) {
      const setting = properties[`playwrightCodeLensRunner.codeLens.${name}`];
      assert.strictEqual(setting?.uniqueItems, true, `${name} rejects duplicate actions`);
      assert.deepStrictEqual(setting?.items?.enum, values.allowed, `${name} allowed actions`);
      assert.deepStrictEqual(setting?.default, values.defaults, `${name} defaults`);
    }
  });

  test('contributes the 3.0 workbench and discovery commands', () => {
    const commands = new Set((manifest.contributes?.commands ?? []).map((entry) => entry.command));
    for (const command of [
      'playwrightCodeLensRunner.more',
      'playwrightCodeLensRunner.pickCase',
      'playwrightCodeLensRunner.showDiscoveryDetails',
      'playwrightCodeLensRunner.retryDiscovery',
      'playwrightCodeLensRunner.selectConfig',
    ]) {
      assert.ok(commands.has(command), `${command} is contributed`);
    }
  });

  test('contributes companion Flake Lab, dashboard, artifact, tag, and UI-profile commands', () => {
    const commands = new Set((manifest.contributes?.commands ?? []).map((entry) => entry.command));
    for (const command of [
      'playwrightCodeLensRunner.flakeLab',
      'playwrightCodeLensRunner.flakeLabWithSize',
      'playwrightCodeLensRunner.runCompanion',
      'playwrightCodeLensRunner.cancelCompanionRun',
      'playwrightCodeLensRunner.clearRuns',
      'playwrightCodeLensRunner.runSingleCompanionTest',
      'playwrightCodeLensRunner.flakeSingleCompanionTest',
      'playwrightCodeLensRunner.openChangedUi',
      'playwrightCodeLensRunner.openLastFailedUi',
      'playwrightCodeLensRunner.tagActions',
      'playwrightCodeLensRunner.openRunsView',
      'playwrightCodeLensRunner.rerunFailedCli',
      'playwrightCodeLensRunner.openArtifactCenter',
      'playwrightCodeLensRunner.openLatestReport',
      'playwrightCodeLensRunner.openLatestTrace',
      'playwrightCodeLensRunner.mergeBlobReports',
      'playwrightCodeLensRunner.openUiProfile',
    ]) {
      assert.ok(commands.has(command), `${command} is contributed`);
    }
  });

  test('contributes companion defaults and the Playwright Activity Bar views', () => {
    const properties = manifest.contributes?.configuration?.[0].properties ?? {};
    assert.strictEqual(properties['playwrightCodeLensRunner.companion.showCliOutput']?.default, 'on-run');
    assert.deepStrictEqual(properties['playwrightCodeLensRunner.companion.showCliOutput']?.enum, ['on-run', 'on-failure', 'never']);
    assert.strictEqual(properties['playwrightCodeLensRunner.companion.browser']?.default, 'config');
    assert.deepStrictEqual(properties['playwrightCodeLensRunner.companion.browser']?.enum, ['config', 'chromium', 'firefox', 'webkit']);
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.browser']?.default, 'config');
    assert.deepStrictEqual(properties['playwrightCodeLensRunner.flakeLab.browser']?.enum, ['config', 'chromium', 'firefox', 'webkit']);
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.size']?.default, 'standard');
    assert.deepStrictEqual(properties['playwrightCodeLensRunner.flakeLab.size']?.enum, ['quick', 'standard', 'deep', 'custom']);
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.maxScopeTests']?.default, 15);
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.repeatEach']?.default, 10);
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.workers']?.default, 1);
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.retries']?.default, 1);
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.trace']?.default, 'on');
    assert.strictEqual(properties['playwrightCodeLensRunner.flakeLab.failOnFlakyTests']?.default, true);
    assert.strictEqual(properties['playwrightCodeLensRunner.sidebar.autoFocus']?.default, true);
    assert.strictEqual(properties['playwrightCodeLensRunner.sidebar.runsEnabled']?.default, true);
    assert.strictEqual(properties['playwrightCodeLensRunner.sidebar.runsEnabled']?.scope, 'window');
    assert.strictEqual(properties['playwrightCodeLensRunner.sidebar.historySize']?.default, 3);
    assert.strictEqual(properties['playwrightCodeLensRunner.sidebar.historySize']?.scope, 'window');
    assert.deepStrictEqual(properties['playwrightCodeLensRunner.artifacts.scanDirectories']?.default, [
      'playwright-report', 'blob-report', 'test-results',
    ]);
    assert.deepStrictEqual(manifest.contributes?.viewsContainers?.activitybar?.map((container) => ({
      id: container.id,
      title: container.title,
      icon: container.icon,
    })), [
      {
        id: 'playwrightCodeLensRunner',
        title: 'Playwright',
        icon: 'public/playwright-sidebar.svg',
      },
    ]);
    assert.deepStrictEqual(
      manifest.contributes?.views?.playwrightCodeLensRunner?.map((view) => view.id),
      ['playwrightCodeLensRunner.runsView', 'playwrightCodeLensRunner.artifactsView'],
    );
    const views = manifest.contributes?.views?.playwrightCodeLensRunner ?? [];
    assert.strictEqual(
      views.find((view) => view.id === 'playwrightCodeLensRunner.runsView')?.when,
      'config.playwrightCodeLensRunner.sidebar.runsEnabled',
    );
    assert.strictEqual(
      views.find((view) => view.id === 'playwrightCodeLensRunner.artifactsView')?.when,
      undefined,
    );
    const runTitleActions = (manifest.contributes?.menus?.['view/title'] ?? []).filter((entry) => (
      entry.command === 'playwrightCodeLensRunner.openRunsView'
      || entry.command === 'playwrightCodeLensRunner.rerunFailedCli'
    ));
    assert.ok(runTitleActions.length > 0);
    assert.ok(runTitleActions.every((entry) => entry.when?.includes(
      'config.playwrightCodeLensRunner.sidebar.runsEnabled',
    )));
  });

  test('every contributed setting uses the playwrightCodeLensRunner namespace', () => {
    const properties = manifest.contributes?.configuration?.[0].properties ?? {};
    const keys = Object.keys(properties);
    assert.ok(keys.length > 0);
    for (const key of keys) {
      assert.ok(
        key.startsWith('playwrightCodeLensRunner.'),
        `setting ${key} must use the playwrightCodeLensRunner namespace`,
      );
    }
  });

  test('every contributed command and menu entry uses the playwrightCodeLensRunner namespace', () => {
    const commands = manifest.contributes?.commands ?? [];
    assert.ok(commands.length > 0);
    for (const entry of commands) {
      assert.ok(
        entry.command.startsWith('playwrightCodeLensRunner.'),
        `command ${entry.command} must use the playwrightCodeLensRunner namespace`,
      );
    }
    for (const [location, entries] of Object.entries(manifest.contributes?.menus ?? {})) {
      for (const entry of entries) {
        assert.ok(
          entry.command.startsWith('playwrightCodeLensRunner.'),
          `menu entry ${entry.command} in ${location} must use the playwrightCodeLensRunner namespace`,
        );
      }
    }
  });

  test('retains no legacy command or setting identifiers', () => {
    const serialized = JSON.stringify(manifest.contributes);
    assert.ok(!serialized.includes('playwrightCliRunner'));
    assert.ok(!serialized.includes('playwrightrunner'));
    assert.ok(!serialized.includes('migrateSettings'));
    assert.ok(!manifest.contributes?.commands?.some((entry) => entry.command.startsWith('playwright.')));
  });

  test('excludes generated Playwright results from the VSIX', () => {
    const vscodeIgnore = fs.readFileSync(path.resolve(process.cwd(), '.vscodeignore'), 'utf8');
    const entries = vscodeIgnore.split(/\r?\n/);
    for (const generated of ['test-results/**', 'playwright-report/**', 'blob-report/**']) {
      assert.ok(entries.includes(generated), `${generated} must not leak into the packaged extension`);
    }
  });
});
