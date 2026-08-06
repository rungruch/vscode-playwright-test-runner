import * as assert from 'assert';
import { PROJECT_STATE_PREFIX, projectStateKey, reconcileProjectSelection } from '../../core/projectSelection';

suite('projectSelection', () => {
  test('persists project selections under the playwrightCodeLensRunner namespace', () => {
    assert.strictEqual(PROJECT_STATE_PREFIX, 'playwrightCodeLensRunner.projects:');
    assert.strictEqual(projectStateKey('/ws/playwright.config.ts'), 'playwrightCodeLensRunner.projects:/ws/playwright.config.ts');
    assert.strictEqual(projectStateKey('configless:/ws'), 'playwrightCodeLensRunner.projects:configless:/ws');
  });

  test('drops renamed and removed persisted projects', () => {
    assert.deepStrictEqual(
      reconcileProjectSelection(['chromium', 'removed', 'chromium'], ['chromium', 'webkit']),
      ['chromium'],
    );
  });

  test('clears selections when the latest model has no named projects', () => {
    assert.deepStrictEqual(reconcileProjectSelection(['chromium'], []), []);
  });

  test('keeps selections when discovery failed to produce a model', () => {
    assert.deepStrictEqual(reconcileProjectSelection(['chromium'], undefined), ['chromium']);
  });
});
