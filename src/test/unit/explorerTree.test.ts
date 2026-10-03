import * as assert from 'assert';
import * as path from 'path';
import { editorSelectionsForFile } from '../../core/editorSelections';
import { explorerTree, ExplorerNode, ExplorerTestNode } from '../../core/explorerTree';
import { parseDiscoveryOutput } from '../../core/discoveryParser';
import { cliSelectionForEditor } from '../../core/selectionArguments';
import { verifyEditorSelection } from '../../core/selectionVerification';

suite('explorer tree', () => {
  const base = { id: 'config-a', cwd: '/workspace' };
  const file = '/workspace/tests/example.spec.ts';
  const spec = (id: string, title: string, line: number, column = 1) => ({
    id, title, file, line, column, tags: ['@smoke'],
    tests: [{ projectName: 'chromium' }, { projectName: 'firefox', expectedStatus: 'skipped' }],
  });
  const model = parseDiscoveryOutput(JSON.stringify({
    config: { rootDir: '/workspace', projects: [{ name: 'chromium' }, { name: 'firefox' }] },
    suites: [{ title: 'tests/example.spec.ts', file,
      specs: [spec('before', 'duplicate', 2), spec('after', 'duplicate', 30), spec('missing', 'unknown location', 0)],
      suites: [{ title: 'checkout', file, line: 3, column: 1,
        specs: [spec('case-1', 'admin', 5), spec('case-2', 'superadmin', 5)],
        suites: [{ title: 'nested', file, line: 10, column: 1, specs: [spec('nested', 'submits', 11)] }],
      }],
    }],
  }), base);
  const uri = (file: string) => `file://${file}`;

  test('orders mixed suites and tests by source and preserves nested suites', () => {
    const entry = flatten(explorerTree(model, 7, uri)).find((node) => node.kind === 'file')!;
    assert.ok(entry.kind === 'file');
    assert.strictEqual(entry.label, 'example.spec.ts');
    assert.deepStrictEqual(entry.children.map((node) => node.label), ['duplicate', 'checkout', 'duplicate', 'unknown location']);
    const suite = entry.children[1];
    assert.deepStrictEqual(suite.children.map((node) => node.label), ['admin', 'superadmin', 'nested']);
    assert.deepStrictEqual(suite.children[2].children[0].selection?.titlePath, ['checkout', 'nested', 'submits']);
  });

  test('lists every generated case with exact selections and project/tag metadata', () => {
    const nodes = flatten(explorerTree(model, 7, uri));
    const cases = nodes.filter((node): node is ExplorerTestNode => node.kind !== 'folder' && node.sharedDeclaration);
    assert.deepStrictEqual(cases.map((node) => node.label), ['admin', 'superadmin']);
    assert.deepStrictEqual(cases[0].projects, ['chromium', 'firefox']);
    assert.deepStrictEqual(cases[0].tags, ['@smoke']);
    assert.ok(cases[0].skipped);
    assert.deepStrictEqual(cases[0].selection?.titlePaths, [['checkout', 'admin']]);
    assert.strictEqual(cases[0].selection?.discoveryRevision, 7);
    const reconciled = verifyEditorSelection(cases[0].selection!, editorSelectionsForFile(model, file, uri(file)));
    assert.deepStrictEqual(reconciled?.titlePaths, [['checkout', 'admin']]);
    const scope = cliSelectionForEditor(reconciled!);
    assert.strictEqual(scope.line, 5);
    assert.strictEqual(scope.titleFilters.length, 1);
    assert.ok(new RegExp(scope.titleFilters[0]).test('chromium tests/example.spec.ts checkout admin'));
    assert.ok(!new RegExp(scope.titleFilters[0]).test('chromium tests/example.spec.ts checkout superadmin'));
  });

  test('keeps duplicate titles distinct, stable, and scoped to their config', () => {
    const first = flatten(explorerTree(model, 7, uri));
    const second = flatten(explorerTree(model, 8, uri));
    assert.deepStrictEqual(first.map((node) => node.id), second.map((node) => node.id));
    assert.strictEqual(new Set(first.map((node) => node.id)).size, first.length);
    const other = parseDiscoveryOutput(JSON.stringify({ suites: [{ title: 'tests/example.spec.ts', file, specs: [spec('before', 'duplicate', 2)] }] }), { ...base, id: 'config-b' });
    const otherNodes = flatten(explorerTree(other, 0, uri));
    assert.ok(otherNodes.every((node) => !first.some((entry) => entry.id === node.id)));
  });

  test('retains tests without source locations but omits executable selections', () => {
    const missing = flatten(explorerTree(model, 0, uri)).find((node) => node.kind === 'test' && node.label === 'unknown location');
    assert.ok(missing && missing.kind === 'test');
    assert.strictEqual(missing.selection, undefined);
  });

  test('groups nested directories and sorts folders and files together alphabetically', () => {
    const files = ['tests/z.spec.ts', 'root.spec.ts', 'tests/nested/b.spec.ts', 'tests/a.spec.ts', 'tests/nested/a.spec.ts'];
    const nested = parseDiscoveryOutput(JSON.stringify({ suites: files.map((relative, index) => ({
      title: relative, file: relative,
      specs: [{ id: `spec-${index}`, title: `test ${index}`, file: relative, line: 1, column: 1 }],
    })) }), base);
    const roots = explorerTree(nested, 0, uri);
    assert.deepStrictEqual(roots.map((node) => [node.kind, node.label]), [['file', 'root.spec.ts'], ['folder', 'tests']]);
    const tests = roots[1];
    assert.ok(tests.kind === 'folder');
    assert.strictEqual(tests.directory, path.join(base.cwd, 'tests'));
    assert.deepStrictEqual(tests.children.map((node) => node.label), ['a.spec.ts', 'nested', 'z.spec.ts']);
    assert.deepStrictEqual(tests.children[1].children.map((node) => node.label), ['a.spec.ts', 'b.spec.ts']);
    assert.strictEqual(flatten(roots).filter((node) => node.kind === 'test').length, files.length);
  });

  test('uses workspace-relative folders and retains distinct files with the same name', () => {
    const nested = parseDiscoveryOutput(JSON.stringify({
      config: { rootDir: '/workspace/tests' },
      suites: ['one/example.spec.ts', 'two/example.spec.ts'].map((relative, index) => ({
        title: relative, file: relative,
        specs: [{ id: `spec-${index}`, title: 'same title', file: relative, line: 1 }],
      })),
    }), base);
    const roots = explorerTree(nested, 0, uri, base.cwd);
    assert.deepStrictEqual(roots.map((node) => node.label), ['tests']);
    assert.deepStrictEqual(roots[0].children.map((node) => node.label), ['one', 'two']);
    const files = flatten(roots).filter((node): node is ExplorerTestNode => node.kind === 'file');
    assert.deepStrictEqual(files.map((node) => node.label), ['example.spec.ts', 'example.spec.ts']);
    assert.notStrictEqual(files[0].id, files[1].id);
    assert.notStrictEqual(files[0].selection?.file, files[1].selection?.file);
  });

  test('keeps tests outside the workspace reachable through parent folders', () => {
    const external = parseDiscoveryOutput(JSON.stringify({ suites: [{
      title: '../shared/tests/example.spec.ts', file: '../shared/tests/example.spec.ts',
      specs: [{ id: 'external', title: 'external test', file: '../shared/tests/example.spec.ts', line: 1 }],
    }] }), base);
    const roots = explorerTree(external, 0, uri);
    assert.deepStrictEqual(flatten(roots).map((node) => node.label), ['..', 'shared', 'tests', 'example.spec.ts', 'external test']);
    const file = flatten(roots).find((node) => node.kind === 'file')!;
    assert.ok(file.kind === 'file');
    assert.strictEqual(file.selection?.file, '/shared/tests/example.spec.ts');
    assert.deepStrictEqual(explorerTree({ ...external, files: [] }, 1, uri), []);
  });
});

function flatten(nodes: ExplorerNode[]): ExplorerNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}
