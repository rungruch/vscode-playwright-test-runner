import * as assert from 'assert';
import { EditorTestSelection } from '../../core/editorSelections';
import {
  OFFICIAL_PLAYWRIGHT_EXTENSION_ID,
  officialCommandFor,
  officialIntegrationError,
} from '../../core/officialCommands';

const BASE: EditorTestSelection = {
  kind: 'test',
  targetId: '/ws/playwright.config.ts',
  uri: 'file:///ws/tests/a.spec.ts',
  file: '/ws/tests/a.spec.ts',
  position: { line: 4, character: 2 },
  fullTitle: 'suite test',
};

suite('officialCommands', () => {
  test('maps file runs to URI Testing commands', () => {
    assert.deepStrictEqual(
      officialCommandFor({ ...BASE, kind: 'file' }, 'run'),
      { command: 'testing.run.uri', usesUri: true, usesCursor: false },
    );
    assert.deepStrictEqual(
      officialCommandFor({ ...BASE, kind: 'file' }, 'debug'),
      { command: 'testing.debug.uri', usesUri: true, usesCursor: false },
    );
  });

  test('maps suite and test runs to cursor Testing commands', () => {
    assert.strictEqual(officialCommandFor(BASE, 'run').command, 'testing.runAtCursor');
    assert.strictEqual(officialCommandFor({ ...BASE, kind: 'suite' }, 'debug').command, 'testing.debugAtCursor');
  });

  test('reports missing extension and command requirements', () => {
    assert.match(officialIntegrationError(false, new Set(), 'testing.runAtCursor') ?? '', new RegExp(OFFICIAL_PLAYWRIGHT_EXTENSION_ID));
    assert.match(
      officialIntegrationError(true, new Set(), 'testing.runAtCursor') ?? '',
      /testing\.runAtCursor/,
    );
    assert.strictEqual(
      officialIntegrationError(true, new Set(['testing.runAtCursor']), 'testing.runAtCursor'),
      undefined,
    );
  });
});
