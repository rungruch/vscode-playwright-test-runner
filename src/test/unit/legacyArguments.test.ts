import * as assert from 'assert';
import { normalizeLegacyArguments } from '../../core/legacyArguments';

suite('legacyArguments', () => {
  test('drops obsolete regex strings from cursor commands', () => {
    assert.deepStrictEqual(normalizeLegacyArguments('playwright.runTest', ['suite.*test$', { obsolete: true }]), []);
    assert.deepStrictEqual(normalizeLegacyArguments('playwright.debugTest', ['suite.*test$']), []);
    assert.deepStrictEqual(normalizeLegacyArguments('playwright.inspectTest', ['suite.*test$']), []);
  });

  test('preserves URI-style and unrelated command arguments', () => {
    const uriLike = { scheme: 'file', fsPath: '/workspace/a.spec.ts' };
    assert.deepStrictEqual(normalizeLegacyArguments('playwright.runTestPath', [uriLike]), [uriLike]);
    assert.deepStrictEqual(normalizeLegacyArguments('playwright.showTrace', ['trace.zip']), ['trace.zip']);
  });
});
