import * as assert from 'assert';
import { groupFailedReruns } from '../../core/failedReruns';
import { EditorTestSelection } from '../../core/editorSelections';

suite('failed rerun grouping', () => {
  const declaration = (line: number, titlePaths: string[][]): EditorTestSelection => ({
    kind: 'test', targetId: 'target', file: '/ws/a.spec.ts', uri: 'file:///ws/a.spec.ts',
    position: { line: line - 1, character: 0 }, titlePaths,
  });
  const failure = (line: number, titlePath: string[]) => ({
    title: titlePath.join(' '), file: '/ws/a.spec.ts', line, column: 1, titlePath,
  });
  test('batches ordinary failures and separates generated declarations without title cross-products', () => {
    const failures = [failure(1, ['one']), failure(2, ['two']), failure(3, ['case x']), failure(4, ['case y'])];
    const result = groupFailedReruns(failures, [declaration(1, [['one']]), declaration(2, [['two']]),
      declaration(3, [['case x'], ['case y']]), declaration(4, [['case x'], ['case y']])]);
    assert.deepStrictEqual(result.groups, [failures.slice(0, 2), [failures[2]], [failures[3]]]);
  });
  test('rejects indistinguishable generated cases unless every colliding case was selected', () => {
    const declarations = [declaration(3, [['foo', 'bar'], ['foo bar']])];
    const first = failure(3, ['foo', 'bar']);
    assert.strictEqual(groupFailedReruns([first], declarations).ambiguous, first);
    const second = failure(3, ['foo bar']);
    assert.deepStrictEqual(groupFailedReruns([first, second], declarations).groups, [[first, second]]);
  });
  test('does not give global diagnostics a second broad invocation', () => {
    const failed = failure(1, ['one']);
    assert.deepStrictEqual(groupFailedReruns([{ title: 'global error' }, failed], [declaration(1, [['one']])]).groups, [[failed]]);
    assert.deepStrictEqual(groupFailedReruns([{ title: 'global error' }], []).groups, [[{ title: 'global error' }]]);
  });
});
