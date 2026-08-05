import * as assert from 'assert';
import { substituteVariables } from '../../core/variables';

const CONTEXT = {
  workspaceFolder: '/home/me/project',
  packageRoot: '/home/me/project/packages/app',
  configDir: '/home/me/project/packages/app/e2e',
  currentFile: '/home/me/project/packages/app/e2e/tests/login.spec.ts',
};

suite('variables', () => {
  test('substitutes workspace folder variants', () => {
    assert.strictEqual(substituteVariables('${workspaceFolder}/e2e', CONTEXT), '/home/me/project/e2e');
    assert.strictEqual(substituteVariables('${workspaceRoot}/e2e', CONTEXT), '/home/me/project/e2e');
    assert.strictEqual(substituteVariables('${workspaceFolderBasename}', CONTEXT), 'project');
  });

  test('substitutes packageRoot and configDir', () => {
    assert.strictEqual(substituteVariables('${packageRoot}/playwright.config.ts', CONTEXT), '/home/me/project/packages/app/playwright.config.ts');
    assert.strictEqual(substituteVariables('${configDir}', CONTEXT), '/home/me/project/packages/app/e2e');
  });

  test('substitutes current file variables', () => {
    assert.strictEqual(substituteVariables('${currentFile}', CONTEXT), '/home/me/project/packages/app/e2e/tests/login.spec.ts');
    assert.strictEqual(substituteVariables('${fileBasename}', CONTEXT), 'login.spec.ts');
    assert.strictEqual(substituteVariables('${fileBasenameNoExtension}', CONTEXT), 'login.spec');
    assert.strictEqual(substituteVariables('${fileExtname}', CONTEXT), '.ts');
    assert.strictEqual(substituteVariables('${fileDirname}', CONTEXT), '/home/me/project/packages/app/e2e/tests');
  });

  test('replaces all occurrences', () => {
    assert.strictEqual(
      substituteVariables('${workspaceFolder}:${workspaceFolder}', CONTEXT),
      '/home/me/project:/home/me/project',
    );
  });

  test('normalizes backward slashes', () => {
    const result = substituteVariables('${workspaceFolder}\\tests', {
      ...CONTEXT,
      workspaceFolder: 'C:\\Users\\me\\project',
    });
    assert.strictEqual(result, 'C:/Users/me/project/tests');
  });

  test('returns empty string for empty input', () => {
    assert.strictEqual(substituteVariables('', CONTEXT), '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(substituteVariables(undefined as any, CONTEXT), '');
  });

  test('falls back to workspace folder when packageRoot/configDir are missing', () => {
    const result = substituteVariables('${packageRoot}|${configDir}', { workspaceFolder: '/ws' });
    assert.strictEqual(result, '/ws|/ws');
  });
});
