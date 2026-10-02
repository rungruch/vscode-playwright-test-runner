import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CliCommand } from '../../core/cliResolution';
import { spawnCommand } from '../../executor';

const NODE: CliCommand = {
  executable: process.execPath,
  argsPrefix: [],
  source: 'explicit',
};

suite('executor', () => {
  test('kills a resistant descendant after its parent exits on interrupt', async function () {
    if (process.platform === 'win32') { this.skip(); }
    let descendant = 0;
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const running = spawnCommand(NODE, ['-e', `
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, ['-e', "process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.once('data', () => process.stdout.write(String(child.pid)));
      process.on('SIGINT', () => process.exit(0));
      setInterval(() => {}, 1000);
    `], { cwd: process.cwd(), env: {}, onStdout: (text) => { descendant = Number(text); ready(); } });
    try {
      await started;
      running.cancel();
      assert.strictEqual((await running.outcome).cancelled, true);
      // SIGKILL delivery and orphan reaping can lag the parent close event.
      const deadline = Date.now() + 1000;
      let alive = true;
      while (alive && Date.now() < deadline) {
        try { process.kill(descendant, 0); } catch { alive = false; }
        if (alive) { await new Promise((resolve) => setTimeout(resolve, 25)); }
      }
      assert.strictEqual(alive, false, 'descendant survives cancellation');
    } finally {
      running.cancel();
      if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch { /* already reaped */ } }
    }
  });

  test('preserves argv through Windows package-manager shims', async function () {
    if (process.platform !== 'win32') { this.skip(); }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright argv '));
    const bin = path.join(directory, 'node_modules', '.bin');
    const file = path.join(bin, 'playwright.cmd');
    const values = ['space path', 'quote"here', 'a&b|c', '%USERPROFILE%', '!name!', '(x)', 'end\\'];
    try {
      await fs.mkdir(bin, { recursive: true });
      await fs.writeFile(path.join(directory, 'echo.cjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      await fs.writeFile(file, `@"${process.execPath}" "%~dp0..\\..\\echo.cjs" %*\r\n`);
      let output = '';
      const running = spawnCommand({ executable: file, argsPrefix: [], source: 'explicit' }, values,
        { cwd: directory, env: {}, onStdout: (text) => { output += text; } });
      assert.strictEqual((await running.outcome).exitCode, 0);
      assert.deepStrictEqual(JSON.parse(output), values);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  test('preserves reporter text when UTF-8 characters span output chunks', async () => {
    let stdout = '';
    const running = spawnCommand(NODE, ['-e', `
      const bytes = Buffer.from('ทดสอบ 🧪');
      process.stdout.write(bytes.subarray(0, 2));
      setTimeout(() => process.stdout.write(bytes.subarray(2)), 10);
    `], { cwd: process.cwd(), env: {}, onStdout: (text) => { stdout += text; } });
    assert.strictEqual((await running.outcome).exitCode, 0);
    assert.strictEqual(stdout, 'ทดสอบ 🧪');
  });
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
