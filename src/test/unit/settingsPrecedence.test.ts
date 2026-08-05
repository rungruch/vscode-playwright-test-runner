import * as assert from 'assert';
import {
  preferExplicit,
  resolveConfigFilesSetting,
  resolveOptionalStringSetting,
} from '../../core/settingsPrecedence';

suite('settingsPrecedence', () => {
  test('explicit empty values suppress legacy fallbacks', () => {
    assert.deepStrictEqual(preferExplicit<string[]>([], ['legacy.config.ts']), []);
    assert.strictEqual(preferExplicit('', 'npx'), '');
    assert.deepStrictEqual(preferExplicit<Record<string, string>>({}, { LEGACY: '1' }), {});
  });

  test('uses legacy values only when the new value is absent', () => {
    assert.deepStrictEqual(preferExplicit(undefined, ['legacy.config.ts']), ['legacy.config.ts']);
    assert.strictEqual(preferExplicit(undefined, 'npx'), 'npx');
  });

  test('maps explicit empty config files to automatic discovery', () => {
    assert.strictEqual(resolveConfigFilesSetting([], 'legacy.config.ts'), undefined);
    assert.deepStrictEqual(resolveConfigFilesSetting(undefined, ' legacy.config.ts '), ['legacy.config.ts']);
  });

  test('maps an explicit empty CLI executable to automatic detection', () => {
    assert.strictEqual(resolveOptionalStringSetting('', 'pnpm'), undefined);
    assert.strictEqual(resolveOptionalStringSetting(undefined, ' pnpm '), 'pnpm');
  });
});
