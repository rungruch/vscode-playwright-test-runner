import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('extension manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
    name?: string;
    displayName?: string;
    activationEvents?: string[];
    contributes?: {
      configuration?: Array<{
        properties?: Record<string, { default?: unknown; enum?: unknown[] }>;
      }>;
    };
  };

  test('activates custom configured layouts after startup', () => {
    assert.ok(manifest.activationEvents?.includes('onStartupFinished'));
  });

  test('uses the Playwright CodeLens Runner marketplace identity', () => {
    assert.strictEqual(manifest.name, 'playwright-codelens-runner');
    assert.strictEqual(manifest.displayName, 'Playwright CodeLens Runner');
  });

  test('contributes the Inspector browser choices with config as the default', () => {
    const setting = manifest.contributes?.configuration?.[0].properties?.['playwrightCliRunner.inspector.browser'];
    assert.strictEqual(setting?.default, 'config');
    assert.deepStrictEqual(setting?.enum, ['config', 'chromium', 'firefox', 'webkit']);
  });
});
