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
  });
});
