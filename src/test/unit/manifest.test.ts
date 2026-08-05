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
      properties?: Record<string, { default?: unknown; enum?: unknown[] }>;
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

  test('uses the Playwright CodeLens Runner marketplace identity', () => {
    assert.strictEqual(manifest.name, 'playwright-codelens-runner');
    assert.strictEqual(manifest.displayName, 'Playwright CodeLens Runner');
  });

  test('declares the 2.1 release and platform floors', () => {
    assert.strictEqual(manifest.version, '2.1.0');
    assert.strictEqual(manifest.engines?.vscode, '^1.125.0');
    assert.strictEqual(manifest.engines?.node, '>=22.13.0');
  });

  test('contributes the Inspector browser choices with config as the default', () => {
    const setting = manifest.contributes?.configuration?.[0].properties?.['playwrightCodeLensRunner.inspector.browser'];
    assert.strictEqual(setting?.default, 'config');
    assert.deepStrictEqual(setting?.enum, ['config', 'chromium', 'firefox', 'webkit']);
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
});
