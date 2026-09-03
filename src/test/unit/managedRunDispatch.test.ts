import * as assert from 'assert';
import { dispatchManagedRun } from '../../core/managedRunDispatch';

suite('dispatchManagedRun', () => {
  test('uses the terminal command only when managed runs are disabled', async () => {
    const args = ['test', 'example.spec.ts:12', '--repeat-each', '10'];
    let terminalArgs: string[] | undefined;
    let managedCalls = 0;
    let afterManagedCalls = 0;

    const result = await dispatchManagedRun({
      runsEnabled: false,
      runInTerminal: () => { terminalArgs = [...args]; },
      runManaged: async () => {
        managedCalls += 1;
        return 'managed';
      },
      afterManaged: async () => { afterManagedCalls += 1; },
    });

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(terminalArgs, args);
    assert.ok(!terminalArgs?.includes('--reporter=line,json'));
    assert.strictEqual(managedCalls, 0);
    assert.strictEqual(afterManagedCalls, 0);
  });

  test('preserves managed execution and follow-up work when enabled', async () => {
    let terminalCalls = 0;
    let afterManagedCalls = 0;
    const result = await dispatchManagedRun({
      runsEnabled: true,
      runInTerminal: () => { terminalCalls += 1; },
      runManaged: async () => 'summary',
      afterManaged: async () => { afterManagedCalls += 1; },
    });

    assert.strictEqual(result, 'summary');
    assert.strictEqual(terminalCalls, 0);
    assert.strictEqual(afterManagedCalls, 1);
  });
});
