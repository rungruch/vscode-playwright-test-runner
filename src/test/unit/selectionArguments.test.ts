import * as assert from 'assert';
import { EditorTestSelection } from '../../core/editorSelections';
import { cliSelectionForEditor } from '../../core/selectionArguments';

const BASE: EditorTestSelection = {
  kind: 'test',
  targetId: '/workspace/playwright.config.ts',
  uri: 'file:///workspace/tests/badge.spec.ts',
  file: '/workspace/tests/badge.spec.ts',
  position: { line: 10, character: 2 },
  fullTitle: 'Verify Badge renders tagged state',
  titlePath: ['Verify Badge', 'renders tagged state'],
};

suite('selectionArguments', () => {
  test('scopes a tagged test without rejecting project/file prefixes', () => {
    const selection = cliSelectionForEditor(BASE);
    assert.strictEqual(selection.files[0], BASE.file);
    assert.match(
      'chromium tests/badge.spec.ts Verify Badge › renders tagged state @badge',
      new RegExp(selection.titleFilters[0]),
    );
    assert.strictEqual(selection.line, BASE.position.line + 1);
  });

  test('suite scope includes descendant test titles', () => {
    const selection = cliSelectionForEditor({
      ...BASE,
      kind: 'suite',
      fullTitle: 'Verify Badge nested',
      titlePath: ['Verify Badge', 'nested'],
    });
    assert.match(
      'webkit tests/badge.spec.ts Verify Badge › nested › works @badge',
      new RegExp(selection.titleFilters[0]),
    );
    assert.strictEqual(selection.line, BASE.position.line + 1);
  });

  test('keeps file selections unqualified by a source line', () => {
    const selection = cliSelectionForEditor({
      ...BASE,
      kind: 'file',
      fullTitle: undefined,
      titlePath: undefined,
      position: { line: 0, character: 0 },
    });

    assert.deepStrictEqual(selection, {
      files: [BASE.file],
      titleFilters: [],
    });
  });

  test('uses a source-line filter for collapsed data-driven cases', () => {
    const selection = cliSelectionForEditor({
      ...BASE,
      position: { line: 16, character: 2 },
      titlePaths: [
        ['Verify Badge', 'case one'],
        ['Verify Badge', 'case two'],
      ],
    });
    assert.deepStrictEqual(selection, {
      files: [BASE.file],
      titleFilters: [],
      line: 17,
    });
  });

  test('keeps the declaration line and exact grep for one selected generated case', () => {
    const selection = cliSelectionForEditor({
      ...BASE,
      position: { line: 16, character: 2 },
      titlePath: ['Verify Badge', 'case two'],
      titlePaths: [['Verify Badge', 'case two']],
    });

    assert.deepStrictEqual(selection.files, [BASE.file]);
    assert.strictEqual(selection.line, 17);
    const exact = new RegExp(selection.titleFilters[0]);
    assert.match('chromium tests/badge.spec.ts Verify Badge case two', exact);
    assert.doesNotMatch('chromium tests/badge.spec.ts Verify Badge supercase two', exact);
    assert.doesNotMatch('chromium tests/badge.spec.ts Verify Badge case one case two', exact);
  });
});
