import * as assert from 'assert';
import { extractJson, parseDiscoveryOutput } from '../../core/discoveryParser';

const BASE = { id: '/ws/playwright.config.ts', cwd: '/ws', configFile: '/ws/playwright.config.ts' };

function report(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    config: { rootDir: '/ws', projects: [{ name: 'chromium' }, { name: 'firefox' }] },
    suites: [],
    errors: [],
    ...overrides,
  });
}

suite('discoveryParser', () => {
  test('parses a minimal empty report', () => {
    const model = parseDiscoveryOutput(report(), BASE);
    assert.strictEqual(model.id, BASE.id);
    assert.strictEqual(model.rootDir, '/ws');
    assert.deepStrictEqual(model.projects, ['chromium', 'firefox']);
    assert.deepStrictEqual(model.files, []);
    assert.deepStrictEqual(model.errors, []);
  });

  test('parses nested suites with tests and project metadata', () => {
    const model = parseDiscoveryOutput(report({
      suites: [
        {
          title: 'login.spec.ts',
          file: 'tests/login.spec.ts',
          suites: [
            {
              title: 'Login',
              file: 'tests/login.spec.ts',
              line: 3,
              column: 1,
              specs: [
                {
                  title: 'logs in',
                  id: 'spec-1',
                  file: 'tests/login.spec.ts',
                  line: 5,
                  column: 3,
                  tests: [
                    { projectName: 'chromium', status: 'passed' },
                    { projectName: 'firefox', status: 'passed' },
                  ],
                },
              ],
              suites: [
                {
                  title: 'nested',
                  file: 'tests/login.spec.ts',
                  line: 10,
                  column: 3,
                  specs: [
                    { title: 'deep test', id: 'spec-2', file: 'tests/login.spec.ts', line: 12, column: 5, tests: [{ projectName: 'chromium', status: 'skipped' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }), BASE);

    assert.strictEqual(model.files.length, 1);
    const file = model.files[0];
    assert.strictEqual(file.relativeFile, 'tests/login.spec.ts');
    assert.strictEqual(file.suites.length, 1);
    const suite = file.suites[0];
    assert.strictEqual(suite.title, 'Login');
    assert.strictEqual(suite.tests.length, 1);
    assert.strictEqual(suite.suites.length, 1);
    assert.strictEqual(suite.suites[0].title, 'nested');

    const test = suite.tests[0];
    assert.strictEqual(test.id, `${BASE.id}:spec-1`);
    assert.strictEqual(test.fullTitle, 'Login logs in');
    assert.deepStrictEqual(test.projects, ['chromium', 'firefox']);
    assert.strictEqual(test.location.line, 5);
    assert.strictEqual(test.skipped, false);

    const deep = suite.suites[0].tests[0];
    assert.strictEqual(deep.fullTitle, 'Login nested deep test');
    assert.strictEqual(deep.skipped, true);
    assert.deepStrictEqual(model.projects, ['chromium', 'firefox']);
  });

  test('handles specs directly on the file suite (no describe)', () => {
    const model = parseDiscoveryOutput(report({
      suites: [
        {
          title: 'plain.spec.ts',
          file: 'plain.spec.ts',
          specs: [
            { title: 'works', id: 's1', file: 'plain.spec.ts', line: 2, column: 1, tests: [{ projectName: 'chromium' }] },
          ],
        },
      ],
    }), BASE);
    assert.strictEqual(model.files.length, 1);
    assert.strictEqual(model.files[0].suites.length, 0);
    assert.strictEqual(model.files[0].tests.length, 1);
    assert.strictEqual(model.files[0].tests[0].fullTitle, 'works');
  });

  test('keeps duplicate titles distinct via spec ids', () => {
    const model = parseDiscoveryOutput(report({
      suites: [
        {
          title: 'dup.spec.ts',
          file: 'dup.spec.ts',
          specs: [
            { title: 'same title', id: 'a1', file: 'dup.spec.ts', line: 2, column: 1, tests: [] },
            { title: 'same title', id: 'a2', file: 'dup.spec.ts', line: 6, column: 1, tests: [] },
          ],
        },
      ],
    }), BASE);
    const [first, second] = model.files[0].tests;
    assert.strictEqual(first.title, second.title);
    assert.notStrictEqual(first.id, second.id);
    assert.strictEqual(first.location.line, 2);
    assert.strictEqual(second.location.line, 6);
  });

  test('generates fallback ids for specs without an id (dynamic tests)', () => {
    const model = parseDiscoveryOutput(report({
      suites: [
        {
          title: 'dynamic.spec.ts',
          file: 'dynamic.spec.ts',
          specs: [
            { title: 'case 1', file: 'dynamic.spec.ts', line: 4, column: 1, tests: [] },
            { title: 'case 2', file: 'dynamic.spec.ts', line: 5, column: 1, tests: [] },
          ],
        },
      ],
    }), BASE);
    const ids = model.files[0].tests.map((t) => t.id);
    assert.strictEqual(new Set(ids).size, 2);
    assert.ok(ids.every((id) => id.startsWith(`${BASE.id}:spec:`)));
  });

  test('collects projects from spec tests when config omits them', () => {
    const model = parseDiscoveryOutput(JSON.stringify({
      suites: [
        {
          title: 'p.spec.ts',
          file: 'p.spec.ts',
          specs: [
            { title: 't', id: 'x', file: 'p.spec.ts', line: 1, column: 1, tests: [{ projectName: 'webkit' }] },
          ],
        },
      ],
    }), BASE);
    assert.deepStrictEqual(model.projects, ['webkit']);
  });

  test('returns an error model for malformed output', () => {
    const model = parseDiscoveryOutput('not json at all', BASE);
    assert.strictEqual(model.files.length, 0);
    assert.strictEqual(model.errors.length, 1);
  });

  test('extracts JSON prefixed by npm noise', () => {
    const stdout = 'npm warn something\n> playwright test\n' + report();
    const parsed = extractJson(stdout);
    assert.ok(parsed);
    assert.strictEqual(parsed?.config?.rootDir, '/ws');
  });

  test('extractJson returns undefined for garbage', () => {
    assert.strictEqual(extractJson('hello world'), undefined);
    assert.strictEqual(extractJson(''), undefined);
    assert.strictEqual(extractJson('{}{}{'), undefined);
  });

  test('surfaces report errors', () => {
    const model = parseDiscoveryOutput(report({ errors: [{ message: 'Config file has an error' }] }), BASE);
    assert.deepStrictEqual(model.errors, ['Config file has an error']);
  });
});
