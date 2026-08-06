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
        uniqueItems?: boolean;
        items?: { enum?: unknown[] };
      }>;
    }>;
    commands?: Array<{ command: string }>;
    menus?: Record<string, Array<{ command: string }>>;
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

  test('declares the 3.0.1 release and platform floors', () => {
    assert.strictEqual(manifest.version, '3.0.1');
    assert.strictEqual(manifest.engines?.vscode, '^1.125.0');
    assert.strictEqual(manifest.engines?.node, '>=22.13.0');
  });

  test('contributes the Inspector browser choices with config as the default', () => {
    const setting = manifest.contributes?.configuration?.[0].properties?.['playwrightCodeLensRunner.inspector.browser'];
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
