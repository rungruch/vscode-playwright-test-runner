import * as assert from 'assert';
import { isLoopbackHost, normalizeUiProfiles } from '../../core/uiProfiles';

suite('uiProfiles', () => {
  test('keeps only named profiles with argv-safe hosts and valid ports', () => {
    assert.deepStrictEqual(normalizeUiProfiles([
      { name: 'Codespaces', host: '0.0.0.0', port: 8080 },
      { name: 'Broken', host: 'host name', port: 8080 },
      { name: 'Bad port', host: 'localhost', port: 0 },
      { name: 'Codespaces', host: 'example.test', port: 3000 },
    ]), [{ name: 'Codespaces', host: 'example.test', port: 3000 }]);
  });

  test('distinguishes loopback hosts before remote exposure confirmation', () => {
    assert.strictEqual(isLoopbackHost('localhost'), true);
    assert.strictEqual(isLoopbackHost('127.0.0.1'), true);
    assert.strictEqual(isLoopbackHost('::1'), true);
    assert.strictEqual(isLoopbackHost('0.0.0.0'), false);
  });
});
