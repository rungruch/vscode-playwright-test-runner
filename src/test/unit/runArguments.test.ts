import * as assert from 'assert';
import {
  buildDebugArguments,
  buildDiscoveryArguments,
  buildUiArguments,
  combineFilters,
  escapeRegExp,
  fullTitleFilter,
  suiteTitleFilter,
} from '../../core/runArguments';

suite('runArguments', () => {
  test('escapes regex metacharacters', () => {
    assert.strictEqual(escapeRegExp('a.b(c)d[e]f$g^h*i+j?k\\l|m'), 'a\\.b\\(c\\)d\\[e\\]f\\$g\\^h\\*i\\+j\\?k\\\\l\\|m');
  });

  test('builds prefix-, separator-, and tag-tolerant title-path filters', () => {
    const testFilter = fullTitleFilter(['Login flow (fast)', 'logs in']);
    const suiteFilter = suiteTitleFilter(['Login flow (fast)', 'nested']);

    assert.strictEqual(testFilter, 'Login flow \\(fast\\).*logs in(?:\\s+@\\S+)*$');
    assert.strictEqual(suiteFilter, 'Login flow \\(fast\\).*nested');
    assert.match(
      'chromium tests/login.spec.ts Login flow (fast) › logs in @smoke @auth',
      new RegExp(testFilter),
    );
    assert.match(
      'webkit tests/login.spec.ts Login flow (fast) › nested › rejects bad password @auth',
      new RegExp(suiteFilter),
    );
  });

  test('combines multiple title filters into an alternation', () => {
    assert.strictEqual(combineFilters(['^a$', '^b$']), '(?:^a$)|(?:^b$)');
    assert.strictEqual(combineFilters(['^a$']), '^a$');
  });

  test('builds discovery arguments', () => {
    assert.deepStrictEqual(
      buildDiscoveryArguments({ configFile: '/ws/playwright.config.ts' }),
      ['test', '--list', '--reporter=json', '--config', '/ws/playwright.config.ts'],
    );
    assert.deepStrictEqual(buildDiscoveryArguments({}), ['test', '--list', '--reporter=json']);
  });

  test('builds scoped Playwright UI arguments with CLI projects', () => {
    assert.deepStrictEqual(
      buildUiArguments(
        { files: ['/ws/tests/login.spec.ts'], titleFilters: ['Login flow'] },
        {
          configFile: '/ws/playwright.config.ts',
          cwd: '/ws',
          projects: ['chromium', 'webkit'],
          extraOptions: ['--headed'],
        },
      ),
      [
        'test', '--ui',
        '--config', '/ws/playwright.config.ts',
        'tests/login.spec.ts',
        '--project', 'chromium',
        '--project', 'webkit',
        '--headed',
        '--grep', 'Login flow',
      ],
    );
  });

  test('builds scoped Inspector arguments', () => {
    assert.deepStrictEqual(
      buildDebugArguments(
        { files: ['/ws/tests/login.spec.ts'], titleFilters: ['Login succeeds(?:\\s+@\\S+)*$'] },
        { configFile: '/ws/playwright.config.ts', cwd: '/ws', projects: ['chromium'] },
      ),
      [
        'test', '--debug',
        '--config', '/ws/playwright.config.ts',
        'tests/login.spec.ts',
        '--project', 'chromium',
        '--grep', 'Login succeeds(?:\\s+@\\S+)*$',
      ],
    );
  });

  test('forces a browser for configless Inspector runs', () => {
    assert.deepStrictEqual(
      buildDebugArguments(
        { files: ['/ws/tests/login.spec.ts'], titleFilters: [] },
        { cwd: '/ws', browser: 'firefox' },
      ),
      ['test', '--debug', 'tests/login.spec.ts', '--browser', 'firefox'],
    );
  });

  test('preserves config, cwd, and file paths containing spaces as argument tokens', () => {
    assert.deepStrictEqual(
      buildDebugArguments(
        { files: ['/work space/e2e tests/login.spec.ts'], titleFilters: [] },
        {
          configFile: '/work space/configs/playwright custom.config.ts',
          cwd: '/work space',
          extraOptions: ['--timeout=2500'],
        },
      ),
      [
        'test', '--debug',
        '--config', '/work space/configs/playwright custom.config.ts',
        'e2e tests/login.spec.ts',
        '--timeout=2500',
      ],
    );
  });

  test('keeps file paths outside cwd absolute', () => {
    const args = buildUiArguments(
      { files: ['/elsewhere/x.spec.ts'], titleFilters: [] },
      { cwd: '/ws' },
    );
    assert.ok(args.includes('/elsewhere/x.spec.ts'));
  });

  test('builds a Playwright file:line filter for generated cases', () => {
    const args = buildDebugArguments(
      { files: ['/ws/tests/dynamic.spec.ts'], titleFilters: [], line: 17 },
      { cwd: '/ws', projects: ['chromium'] },
    );
    assert.deepStrictEqual(args, [
      'test', '--debug',
      'tests/dynamic.spec.ts:17',
      '--project', 'chromium',
    ]);
  });
});
