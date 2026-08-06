import * as assert from 'assert';
import { buildShowReportArguments } from '../../core/reportServer';

suite('reportServer', () => {
  test('uses an available port when opening a specific report', () => {
    assert.deepStrictEqual(
      buildShowReportArguments('/workspace/playwright-report'),
      ['show-report', '/workspace/playwright-report', '--port', '0'],
    );
  });

  test('uses an available port when opening the default report', () => {
    assert.deepStrictEqual(buildShowReportArguments(), ['show-report', '--port', '0']);
  });
});
