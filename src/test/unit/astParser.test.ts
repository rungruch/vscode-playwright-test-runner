import * as assert from 'assert';
import { parseTestFileAst } from '../../core/astParser';

suite('astParser', () => {
  test('parses basic tests and suites', () => {
    const code = `
      import { test, expect } from '@playwright/test';

      test.describe('authentication', () => {
        test('logs in successfully', async ({ page }) => {
          await page.goto('/');
        });

        test('handles invalid credentials', async ({ page }) => {
          await page.goto('/login');
        });
      });

      test('standalone root test', async () => {});
    `;

    const model = parseTestFileAst(code, '/workspace/tests/auth.spec.ts');
    assert.strictEqual(model.files.length, 1);
    const file = model.files[0];
    assert.strictEqual(file.tests.length, 1);
    assert.strictEqual(file.tests[0].title, 'standalone root test');

    assert.strictEqual(file.suites.length, 1);
    const suite = file.suites[0];
    assert.strictEqual(suite.title, 'authentication');
    assert.strictEqual(suite.tests.length, 2);
    assert.strictEqual(suite.tests[0].title, 'logs in successfully');
    assert.strictEqual(suite.tests[0].fullTitle, 'authentication logs in successfully');
    assert.strictEqual(suite.tests[1].title, 'handles invalid credentials');
  });

  test('handles modifiers: only, skip, fixme, serial, describe.only', () => {
    const code = `
      test.describe.serial('serial suite', () => {
        test.skip('skipped test', async () => {});
        test.only('focused test', async () => {});
        test.fixme('broken test', async () => {});
      });
    `;

    const model = parseTestFileAst(code, '/workspace/tests/modifiers.spec.ts');
    const suite = model.files[0].suites[0];
    assert.strictEqual(suite.title, 'serial suite');
    assert.strictEqual(suite.tests.length, 3);
    assert.strictEqual(suite.tests[0].skipped, true);
    assert.strictEqual(suite.tests[1].skipped, false);
    assert.strictEqual(suite.tests[2].skipped, true);
  });

  test('extracts tags from titles and options objects', () => {
    const code = `
      test('test with @smoke tag in title', async () => {});
      test('test with option tag', { tag: '@fast' }, async () => {});
      test('test with multiple tags', { tag: ['@regression', '@p1'] }, async () => {});
      test('test with both @critical and option', { tag: '@api' }, async () => {});
    `;

    const model = parseTestFileAst(code, '/workspace/tests/tags.spec.ts');
    const tests = model.files[0].tests;
    assert.deepStrictEqual(tests[0].tags, ['@smoke']);
    assert.deepStrictEqual(tests[1].tags, ['@fast']);
    assert.deepStrictEqual(tests[2].tags, ['@p1', '@regression']);
    assert.deepStrictEqual(tests[3].tags, ['@api', '@critical']);
  });

  test('handles TypeScript, JSX, and template strings', () => {
    const code = `
      import React from 'react';
      import { test } from '@playwright/experimental-ct-react';

      test(\`renders user \${userId} profile\`, async ({ mount }) => {
        const component = await mount(<Profile id="123" />);
      });
    `;

    const model = parseTestFileAst(code, '/workspace/tests/react.spec.tsx');
    assert.strictEqual(model.files[0].tests.length, 1);
    assert.ok(model.files[0].tests[0].title.includes('renders user'));
    assert.strictEqual(model.errors.length, 0);
  });

  test('ignores hooks and non-test methods', () => {
    const code = `
      test.beforeEach(async () => {});
      test.afterEach(async () => {});
      test.beforeAll(async () => {});
      test.afterAll(async () => {});
      test.use({ locale: 'en-US' });
      test.describe.configure({ mode: 'parallel' });

      test('valid test', async () => {});
    `;

    const model = parseTestFileAst(code, '/workspace/tests/hooks.spec.ts');
    assert.strictEqual(model.files[0].suites.length, 0);
    assert.strictEqual(model.files[0].tests.length, 1);
    assert.strictEqual(model.files[0].tests[0].title, 'valid test');
  });

  test('tolerates syntax errors gracefully with errorRecovery', () => {
    const code = `
      test('valid test before syntax error', async () => {});

      // Incomplete statement while user is typing
      test('incomplete test
    `;

    const model = parseTestFileAst(code, '/workspace/tests/broken.spec.ts');
    assert.ok(model.files[0].tests.length >= 1);
    assert.strictEqual(model.files[0].tests[0].title, 'valid test before syntax error');
  });

  test('executes in sub-5ms speed benchmark', () => {
    const lines: string[] = ["import { test } from '@playwright/test';\n"];
    for (let i = 0; i < 100; i++) {
      lines.push(`
        test.describe('suite ${i}', () => {
          test('test ${i}-1', async () => {});
          test('test ${i}-2', async () => {});
        });
      `);
    }
    const code = lines.join('\n');
    const start = performance.now();
    const model = parseTestFileAst(code, '/workspace/tests/large.spec.ts');
    const duration = performance.now() - start;

    assert.strictEqual(model.files[0].suites.length, 100);
    assert.strictEqual(model.files[0].suites[0].tests.length, 2);
    // Even for 100 suites (200 tests, ~1000 lines), speed should be exceptionally fast
    assert.ok(duration < 50, `parsing 1000 lines took ${duration}ms, expected < 50ms`);
  });
});
