import * as assert from 'assert';
import { parseEnvironmentArray } from '../../core/envParse';

suite('envParse', () => {
  test('parses KEY=value entries', () => {
    assert.deepStrictEqual(parseEnvironmentArray(['NODE_ENV=production', 'DEBUG=1']), {
      NODE_ENV: 'production',
      DEBUG: '1',
    });
  });

  test('keeps equals signs inside values', () => {
    assert.deepStrictEqual(parseEnvironmentArray(['URL=https://example.com/?a=b&c=d']), {
      URL: 'https://example.com/?a=b&c=d',
    });
  });

  test('skips malformed entries', () => {
    assert.deepStrictEqual(parseEnvironmentArray(['no-equals', '=novaluekey', '', 'OK=1']), { OK: '1' });
  });

  test('handles undefined and non-array input', () => {
    assert.deepStrictEqual(parseEnvironmentArray(undefined), {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepStrictEqual(parseEnvironmentArray('nope' as any), {});
  });
});
