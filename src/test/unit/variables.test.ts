import * as assert from 'assert';
import { substituteVariables } from '../../core/variables';

const CONTEXT = {
  workspaceFolder: '/home/me/project',
  packageRoot: '/home/me/project/packages/app',
  configDir: '/home/me/project/packages/app/e2e',
};

suite('variables', () => {
  test('substitutes the workspace folder variable', () => {
    assert.strictEqual(substituteVariables('${workspaceFolder}/e2e', CONTEXT), '/home/me/project/e2e');
  });

  test('substitutes packageRoot and configDir', () => {
    assert.strictEqual(substituteVariables('${packageRoot}/playwright.config.ts', CONTEXT), '/home/me/project/packages/app/playwright.config.ts');
    assert.strictEqual(substituteVariables('${configDir}', CONTEXT), '/home/me/project/packages/app/e2e');
  });

  test('does not substitute removed v1 variables', () => {
    assert.strictEqual(substituteVariables('${workspaceRoot}/e2e', CONTEXT), '${workspaceRoot}/e2e');
    assert.strictEqual(substituteVariables('${workspaceFolderBasename}', CONTEXT), '${workspaceFolderBasename}');
    assert.strictEqual(substituteVariables('${currentFile}', CONTEXT), '${currentFile}');
    assert.strictEqual(substituteVariables('${fileExtname}', CONTEXT), '${fileExtname}');
    assert.strictEqual(substituteVariables('${fileBasename}', CONTEXT), '${fileBasename}');
    assert.strictEqual(substituteVariables('${fileBasenameNoExtension}', CONTEXT), '${fileBasenameNoExtension}');
    assert.strictEqual(substituteVariables('${fileDirname}', CONTEXT), '${fileDirname}');
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
