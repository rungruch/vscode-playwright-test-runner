import * as assert from 'assert';
import { reconcileProjectSelection } from '../../core/projectSelection';

suite('projectSelection', () => {
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
