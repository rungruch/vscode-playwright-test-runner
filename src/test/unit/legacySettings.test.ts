import * as assert from 'assert';
import { convertLegacySettings, legacyProjectSeed } from '../../core/legacySettings';

suite('legacySettings', () => {
  test('converts the config path into configFiles', () => {
    const migrated = convertLegacySettings({ playwrightConfigPath: 'e2e/playwright.config.ts' });
    assert.deepStrictEqual(migrated.configFiles, ['e2e/playwright.config.ts']);
  });

  test('splits the legacy command into executable plus arguments', () => {
    const migrated = convertLegacySettings({ playwrightCommand: 'pnpm exec playwright' });
    assert.strictEqual(migrated['cli.executable'], 'pnpm');
    assert.deepStrictEqual(migrated['cli.arguments'], ['exec', 'playwright']);
  });

  test('ignores the default projectPath placeholder', () => {
    const migrated = convertLegacySettings({ projectPath: '${packageRoot}' });
    assert.strictEqual(migrated.workingDirectory, undefined);
  });

  test('maps changeDirectoryToWorkspaceRoot to the workspace variable', () => {
    const migrated = convertLegacySettings({ changeDirectoryToWorkspaceRoot: true });
    assert.strictEqual(migrated.workingDirectory, '${workspaceFolder}');
  });

  test('converts environment variable arrays to objects', () => {
    const migrated = convertLegacySettings({ playwrightEnvironmentVariables: ['A=1', 'B=x=y'] });
    assert.deepStrictEqual(migrated.environment, { A: '1', B: 'x=y' });
  });

  test('inverts disableCodeLens', () => {
    assert.strictEqual(convertLegacySettings({ disableCodeLens: true })['codeLens.enabled'], false);
    assert.strictEqual(convertLegacySettings({ disableCodeLens: false })['codeLens.enabled'], true);
  });

  test('copies run options and the code lens selector', () => {
    const migrated = convertLegacySettings({
      playwrightRunOptions: ['--retries=2'],
      codeLensSelector: '**/*.e2e.ts',
    });
    assert.deepStrictEqual(migrated.runOptions, ['--retries=2']);
    assert.strictEqual(migrated['codeLens.pattern'], '**/*.e2e.ts');
  });

  test('produces nothing for empty legacy settings', () => {
    assert.deepStrictEqual(convertLegacySettings({}), {});
  });

  test('seeds project picks from legacy project settings', () => {
    assert.deepStrictEqual(legacyProjectSeed('chromium'), ['chromium']);
    assert.deepStrictEqual(legacyProjectSeed('chromium, firefox'), ['chromium', 'firefox']);
    assert.strictEqual(legacyProjectSeed(''), undefined);
    assert.strictEqual(legacyProjectSeed(undefined), undefined);
  });
});
