import * as assert from 'assert';
import { targetsForChangedPath } from '../../core/refreshRouting';

const ROOT = { configDir: '/workspace', configFile: '/workspace/playwright.config.ts', id: 'root' };
const NESTED = {
  configDir: '/workspace/packages/shop',
  configFile: '/workspace/packages/shop/playwright.config.ts',
  id: 'nested',
};

suite('refreshRouting', () => {
  test('routes nested test saves to the deepest containing target', () => {
    assert.deepStrictEqual(
      targetsForChangedPath([ROOT, NESTED], '/workspace/packages/shop/tests/a.spec.ts', false).map((target) => target.id),
      ['nested'],
    );
  });

  test('routes config saves to the exact config instead of a root prefix', () => {
    assert.deepStrictEqual(
      targetsForChangedPath([ROOT, NESTED], NESTED.configFile, true).map((target) => target.id),
      ['nested'],
    );
  });

  test('refreshes all same-directory configs for an ambiguous test file', () => {
    const alternate = { configDir: '/workspace', configFile: '/workspace/custom.config.ts', id: 'alternate' };
    assert.deepStrictEqual(
      targetsForChangedPath([ROOT, alternate], '/workspace/tests/a.spec.ts', false).map((target) => target.id),
      ['root', 'alternate'],
    );
  });
});
