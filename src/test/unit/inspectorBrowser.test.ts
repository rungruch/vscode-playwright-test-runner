import * as assert from 'assert';
import { resolveInspectorBrowser } from '../../core/inspectorBrowser';

suite('inspectorBrowser', () => {
  test('uses config and persisted CLI projects by default', () => {
    assert.deepStrictEqual(
      resolveInspectorBrowser('config', ['smoke'], ['smoke', 'regression']),
      { projects: ['smoke'] },
    );
  });

  test('forces a matching config project case-insensitively', () => {
    assert.deepStrictEqual(
      resolveInspectorBrowser('firefox', ['chromium'], ['Chromium', 'Firefox', 'WebKit']),
      { projects: ['Firefox'] },
    );
  });

  test('uses the browser flag when no projects are configured', () => {
    assert.deepStrictEqual(
      resolveInspectorBrowser('webkit', [], []),
      { projects: [], browser: 'webkit' },
    );
  });

  test('rejects a forced browser missing from configured projects', () => {
    const resolution = resolveInspectorBrowser('firefox', [], ['chromium', 'webkit']);
    assert.deepStrictEqual(resolution.projects, []);
    assert.match(resolution.error ?? '', /no project named "firefox"/);
  });

  test('rejects a forced browser when projects could not be discovered', () => {
    const resolution = resolveInspectorBrowser('chromium', [], undefined);
    assert.match(resolution.error ?? '', /could not be discovered/);
  });
});
