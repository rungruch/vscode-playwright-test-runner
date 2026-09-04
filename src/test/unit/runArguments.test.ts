import * as assert from 'assert';
import {
  buildDebugArguments,
  buildDiscoveryArguments,
  buildChangedUiArguments,
  buildFlakeLabArguments,
  buildLastFailedUiArguments,
  buildTagArguments,
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
    const file = '/ws/tests/login.spec.ts';
    const testFilter = fullTitleFilter(['Login flow (fast)', 'logs in'], file);
    const suiteFilter = suiteTitleFilter(['Login flow (fast)', 'nested'], file);

    assert.match(
      'chromium tests/login.spec.ts Login flow (fast) logs in @smoke @auth',
      new RegExp(testFilter),
    );
    assert.match(
      'webkit tests/login.spec.ts Login flow (fast) › nested › rejects bad password @auth',
      new RegExp(suiteFilter),
    );
  });

  test('handles JSON reporter titlePath containing leading empty string and filename without duplication', () => {
    const file = '/ws/tests/calendar_single.spec.ts';
    const jsonTitlePath = ['', 'tests/calendar_single.spec.ts', 'Verify Single Calendar UI', 'Verify Popover Calendar Container'];
    const filter = fullTitleFilter(jsonTitlePath, file);
    assert.match(
      'chromium tests/calendar_single.spec.ts Verify Single Calendar UI Verify Popover Calendar Container @calendar',
      new RegExp(filter),
    );
    assert.match(
      'calendar_single.spec.ts › Verify Single Calendar UI › Verify Popover Calendar Container @calendar',
      new RegExp(filter),
    );
  });

  test('keeps exact title-path boundaries for generated cases', () => {
    const file = '/ws/tests/generated.spec.ts';
    const exact = new RegExp(fullTitleFilter(['admin'], file));
    assert.match('chromium tests/generated.spec.ts admin', exact);
    assert.doesNotMatch('chromium tests/generated.spec.ts superadmin', exact);
    assert.doesNotMatch('chromium tests/generated.spec.ts super admin', exact);

    const nested = new RegExp(fullTitleFilter(['foo', 'bar'], file));
    assert.match('webkit tests/generated.spec.ts foo bar', nested);
    assert.doesNotMatch('webkit tests/generated.spec.ts foobar', nested);
    assert.doesNotMatch('webkit tests/generated.spec.ts foo something bar', nested);
  });

  test('allows Playwright describe tags between title-path segments', () => {
    const file = '/ws/tests/tagged.spec.ts';
    const filter = new RegExp(fullTitleFilter(['group', 'nested', 'works'], file));
    assert.match(
      'chromium tests/tagged.spec.ts group @suite nested @nested works @test',
      filter,
    );
    assert.doesNotMatch(
      'chromium tests/tagged.spec.ts group @suite nested @nested also works @test',
      filter,
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
    assert.deepStrictEqual(
      buildDiscoveryArguments({
        configFile: '/ws/playwright.config.ts',
        cwd: '/ws',
        files: ['/ws/tests/login[smoke].spec.ts'],
      }),
      ['test', '--list', '--reporter=json', '--config', '/ws/playwright.config.ts', 'tests/login\\[smoke\\]\\.spec\\.ts'],
    );
    assert.deepStrictEqual(
      buildDiscoveryArguments({ files: ['C:\\work space\\tests\\login.spec.ts'] }),
      ['test', '--list', '--reporter=json', 'C:/work space/tests/login\\.spec\\.ts'],
    );
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
        'tests/login\\.spec\\.ts',
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
        'tests/login\\.spec\\.ts',
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
      ['test', '--debug', 'tests/login\\.spec\\.ts', '--browser', 'firefox'],
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
        'e2e tests/login\\.spec\\.ts',
        '--timeout=2500',
      ],
    );
  });

  test('keeps file paths outside cwd absolute', () => {
    const args = buildUiArguments(
      { files: ['/elsewhere/x.spec.ts'], titleFilters: [] },
      { cwd: '/ws' },
    );
    assert.ok(args.includes('/elsewhere/x\\.spec\\.ts'));
  });

  test('escapes portable Inspector/UI file regexes', () => {
    assert.deepStrictEqual(
      buildDebugArguments(
        { files: ['/ws/tests/metachar[smoke]+.spec.ts'], titleFilters: [] },
        { cwd: '/ws' },
      ),
      ['test', '--debug', 'tests/metachar\\[smoke\\]\\+\\.spec\\.ts'],
    );
    assert.deepStrictEqual(
      buildUiArguments(
        { files: ['C:\\work space\\tests\\login.spec.ts'], titleFilters: [] },
        { cwd: '/ws' },
      ),
      ['test', '--ui', 'C:/work space/tests/login\\.spec\\.ts'],
    );
  });

  test('builds a Playwright file:line filter for generated cases', () => {
    const args = buildDebugArguments(
      { files: ['/ws/tests/dynamic.spec.ts'], titleFilters: [], line: 17 },
      { cwd: '/ws', projects: ['chromium'] },
    );
    assert.deepStrictEqual(args, [
      'test', '--debug',
      'tests/dynamic\\.spec\\.ts:17',
      '--project', 'chromium',
    ]);
  });

  test('keeps the source line when an exact generated case also has a title filter', () => {
    const args = buildDebugArguments(
      {
        files: ['/ws/tests/dynamic.spec.ts'],
        titleFilters: ['Dynamic case.*second(?:\\s+@\\S+)*$'],
        line: 17,
      },
      { cwd: '/ws' },
    );
    assert.deepStrictEqual(args, [
      'test', '--debug',
      'tests/dynamic\\.spec\\.ts:17',
      '--grep', 'Dynamic case.*second(?:\\s+@\\S+)*$',
    ]);
  });

  test('builds Flake Lab defaults after scoped file, project, and grep arguments', () => {
    assert.deepStrictEqual(
      buildFlakeLabArguments(
        { files: ['/ws/tests/login.spec.ts'], titleFilters: ['Login flow'], line: 12 },
        {
          configFile: '/ws/playwright.config.ts',
          cwd: '/ws',
          projects: ['chromium'],
          extraOptions: ['--headed'],
          repeatEach: 10,
          workers: 1,
          retries: 1,
          trace: 'on',
          failOnFlakyTests: true,
        },
      ),
      [
        'test', '--config', '/ws/playwright.config.ts', 'tests/login\\.spec\\.ts:12',
        '--project', 'chromium', '--grep', 'Login flow',
        '--repeat-each', '10', '--workers', '1', '--retries', '1', '--trace', 'on',
        '--fail-on-flaky-tests', '--headed',
      ],
    );
  });

  test('builds target-scoped changed and last-failed UI arguments', () => {
    const options = {
      configFile: '/ws/playwright.config.ts',
      cwd: '/ws',
      projects: ['chromium'],
      uiHost: '0.0.0.0',
      uiPort: 8080,
    };
    assert.deepStrictEqual(
      buildChangedUiArguments(options, 'origin/main'),
      [
        'test', '--ui', '--config', '/ws/playwright.config.ts', '--project', 'chromium',
        '--ui-host', '0.0.0.0', '--ui-port', '8080', '--only-changed', 'origin/main',
      ],
    );
    assert.deepStrictEqual(
      buildLastFailedUiArguments(options),
      [
        'test', '--ui', '--config', '/ws/playwright.config.ts', '--project', 'chromium',
        '--ui-host', '0.0.0.0', '--ui-port', '8080', '--last-failed',
      ],
    );
  });

  test('puts a discovered tag in one structured grep token for UI and Inspector', () => {
    const options = { cwd: '/ws', projects: ['webkit'] };
    assert.deepStrictEqual(
      buildTagArguments('ui', '@smoke', options),
      ['test', '--ui', '--project', 'webkit', '--grep', '@smoke'],
    );
    assert.deepStrictEqual(
      buildTagArguments('debug', '@auth-api', options),
      ['test', '--debug', '--project', 'webkit', '--grep', '@auth-api'],
    );
  });
});
