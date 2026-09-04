import * as assert from 'assert';
import { isBrowserPreference, resolveBrowserPreference } from '../../core/inspectorBrowser';

suite('inspectorBrowser', () => {
  test('uses config and persisted CLI projects by default', () => {
    assert.deepStrictEqual(
      resolveBrowserPreference('config', ['smoke'], ['smoke', 'regression']),
      { projects: ['smoke'] },
    );
  });

  test('forces a matching config project case-insensitively', () => {
    assert.deepStrictEqual(
      resolveBrowserPreference('firefox', ['chromium'], ['Chromium', 'Firefox', 'WebKit']),
      { projects: ['Firefox'] },
    );
    assert.deepStrictEqual(
      resolveBrowserPreference('chromium', [], ['Chromium', 'Firefox', 'WebKit']),
      { projects: ['Chromium'] },
    );
  });

  test('matches browser aliases like Desktop Chrome or Safari when exact name is absent', () => {
    assert.deepStrictEqual(
      resolveBrowserPreference('chromium', [], ['Desktop Chrome', 'Mobile Safari']),
      { projects: ['Desktop Chrome'] },
    );
    assert.deepStrictEqual(
      resolveBrowserPreference('webkit', [], ['Desktop Chrome', 'Mobile Safari']),
      { projects: ['Mobile Safari'] },
    );
  });

  test('uses the browser flag when no projects are configured', () => {
    assert.deepStrictEqual(
      resolveBrowserPreference('webkit', [], []),
      { projects: [], browser: 'webkit' },
    );
    assert.deepStrictEqual(
      resolveBrowserPreference('firefox', [], []),
      { projects: [], browser: 'firefox' },
    );
  });

  test('rejects a forced browser missing from configured projects', () => {
    const resolution = resolveBrowserPreference('firefox', [], ['chromium', 'webkit']);
    assert.deepStrictEqual(resolution.projects, []);
    assert.match(resolution.error ?? '', /no project named "firefox"/);
  });

  test('rejects a forced browser when projects could not be discovered', () => {
    const resolution = resolveBrowserPreference('chromium', [], undefined);
    assert.match(resolution.error ?? '', /could not be discovered/);
  });

  test('validates browser preference values', () => {
    assert.strictEqual(isBrowserPreference('config'), true);
    assert.strictEqual(isBrowserPreference('chromium'), true);
    assert.strictEqual(isBrowserPreference('firefox'), true);
    assert.strictEqual(isBrowserPreference('webkit'), true);
    assert.strictEqual(isBrowserPreference('edge'), false);
    assert.strictEqual(isBrowserPreference('chrome'), false);
  });
});
