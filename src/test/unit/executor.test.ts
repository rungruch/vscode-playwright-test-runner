import * as assert from 'assert';
import { CliCommand } from '../../core/cliResolution';
import { spawnCommand } from '../../executor';

const NODE: CliCommand = {
  executable: process.execPath,
  argsPrefix: [],
  source: 'explicit',
};

suite('executor', () => {
  test('reports a normal process outcome', async () => {
    let stdout = '';
    const running = spawnCommand(NODE, ['-e', 'process.stdout.write("ready")'], {
      cwd: process.cwd(),
      env: {},
      onStdout: (text) => (stdout += text),
    });

    const result = await running.outcome;
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.timedOut, false);
    assert.strictEqual(stdout, 'ready');
  });

  test('reports timeout separately from cancellation', async () => {
    const running = spawnCommand(NODE, ['-e', 'setInterval(() => undefined, 1000)'], {
      cwd: process.cwd(),
      env: {},
      timeoutMs: 75,
    });

    const result = await running.outcome;
    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.timedOut, true);
  });

  test('makes repeated cancellation idempotent', async () => {
    const running = spawnCommand(NODE, ['-e', 'setInterval(() => undefined, 1000)'], {
      cwd: process.cwd(),
      env: {},
    });
    running.cancel();
    running.cancel();

    const result = await running.outcome;
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(result.timedOut, false);
  });
});
