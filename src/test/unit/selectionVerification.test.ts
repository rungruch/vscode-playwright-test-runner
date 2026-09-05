import * as assert from 'assert';
import { EditorTestSelection, editorSelectionsForFile } from '../../core/editorSelections';
import { parseTestFileAst } from '../../core/astParser';
import { parseDiscoveryOutput } from '../../core/discoveryParser';
import { verifyEditorSelection } from '../../core/selectionVerification';

suite('selection verification', () => {
  const selection: EditorTestSelection = {
    kind: 'test', targetId: 'target', uri: 'file:///test.spec.ts', file: '/test.spec.ts',
    position: { line: 4, character: 2 }, titlePath: ['suite', 'test'],
  };

  test('rejects a deleted selection instead of substituting another test', () => {
    assert.strictEqual(verifyEditorSelection(selection, [{ ...selection, titlePath: ['suite', 'other'] }]), undefined);
  });

  test('uses the CLI generated cases for a provisional declaration', () => {
    const candidate = { ...selection, titlePath: ['suite', 'case 1'], titlePaths: [['suite', 'case 1'], ['suite', 'case 2']] };
    assert.strictEqual(verifyEditorSelection({ ...selection, discoverySource: 'ast' }, [candidate]), candidate);
  });

  test('uses a missing-column fallback only for one source declaration on the line', () => {
    const provisional = { ...selection, discoverySource: 'ast' as const, declarationsOnLine: 1 };
    const candidate = { ...selection, columnMissing: true, position: { line: 4, character: 0 },
      titlePath: ['case 1'], titlePaths: [['case 1'], ['case 2']] };
    assert.strictEqual(verifyEditorSelection(provisional, [candidate]), candidate);
    assert.strictEqual(verifyEditorSelection({ ...provisional, declarationsOnLine: 2 }, [candidate]), undefined);
    assert.strictEqual(verifyEditorSelection(provisional, [candidate, { ...candidate }]), undefined);
    assert.strictEqual(verifyEditorSelection(provisional, [{ ...candidate, columnMissing: false }]), undefined);
    assert.strictEqual(verifyEditorSelection(provisional, [{ ...candidate, position: { line: 5, character: 0 } }]), undefined);
  });

  test('retains a picked exact case and rejects removed or ambiguous cases', () => {
    const cases = { ...selection, titlePaths: [['suite', 'test'], ['suite', 'second']] };
    const exact = { ...selection, titlePaths: [['suite', 'second']] };
    assert.deepStrictEqual(verifyEditorSelection(exact, [cases])?.titlePaths, [['suite', 'second']]);
    assert.strictEqual(verifyEditorSelection({ ...exact, titlePaths: [['missing']] }, [cases]), undefined);
    assert.strictEqual(verifyEditorSelection({ ...selection, position: { line: 30, character: 0 } }, [selection, { ...selection, position: { line: 20, character: 0 } }]), undefined);
  });

  test('preserves missing columns through discovery and verifies generated source cases', () => {
    const file = '/workspace/dynamic.spec.ts';
    const uri = `file://${file}`;
    const model = parseDiscoveryOutput(JSON.stringify({ suites: [{ title: 'dynamic.spec.ts', file,
      specs: ['case 1', 'case 2'].map((title) => ({ title, file, line: 2, tests: [] })),
    }] }), { id: 'target', cwd: '/workspace' });
    const candidates = editorSelectionsForFile(model, file, uri);
    for (const multiple of [false, true]) {
      const source = "for (const i of [1, 2]) {\n  test(`case ${i}`, () => {});" + (multiple ? " test('extra', () => {});" : '') + '\n}';
      const ast = parseTestFileAst(source, file, { targetId: 'target' });
      const requested = { ...editorSelectionsForFile(ast, file, uri)[1], discoverySource: 'ast' as const };
      const verified = verifyEditorSelection(requested, candidates);
      if (multiple) {
        assert.strictEqual(verified, undefined);
      } else {
        assert.deepStrictEqual(verified?.titlePaths, [['case 1'], ['case 2']]);
        assert.strictEqual(verified?.columnMissing, true);
      }
    }
  });
});
