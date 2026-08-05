import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectPackageManager, findLocalPlaywrightCli, findPackageRoot } from '../../core/packageManager';
import { environmentForCli, packageManagerCommand, resolveCli } from '../../core/cliResolution';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pw-pm-test-'));
}

suite('packageManager', () => {
  let root: string;

  setup(() => {
    root = makeTempDir();
  });

  teardown(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('detects pnpm from pnpm-lock.yaml', () => {
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
    assert.strictEqual(detectPackageManager(root), 'pnpm');
  });

  test('detects yarn from yarn.lock', () => {
    fs.writeFileSync(path.join(root, 'yarn.lock'), '');
    assert.strictEqual(detectPackageManager(root), 'yarn');
  });

  test('detects bun from bun.lockb', () => {
    fs.writeFileSync(path.join(root, 'bun.lockb'), '');
    assert.strictEqual(detectPackageManager(root), 'bun');
  });

  test('defaults to npm with no lockfile', () => {
    assert.strictEqual(detectPackageManager(root), 'npm');
  });

  test('walks up from a subdirectory to find the lockfile', () => {
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
    const sub = path.join(root, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    assert.strictEqual(detectPackageManager(sub, root), 'pnpm');
  });

  test('prefers the nearest lockfile when nested', () => {
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    const sub = path.join(root, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'yarn.lock'), '');
    assert.strictEqual(detectPackageManager(sub, root), 'yarn');
  });

  test('findPackageRoot finds the nearest package.json', () => {
    const sub = path.join(root, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    assert.strictEqual(findPackageRoot(sub, root), root);
    assert.strictEqual(findPackageRoot(root), root);
  });

  test('findLocalPlaywrightCli finds @playwright/test cli.js', () => {
    const cliDir = path.join(root, 'node_modules', '@playwright', 'test');
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, 'cli.js'), '');
    const found = findLocalPlaywrightCli(root);
    assert.strictEqual(found, path.join(cliDir, 'cli.js'));
  });
});

suite('cliResolution', () => {
  test('explicit executable wins over detection', () => {
    const cli = resolveCli({ executable: '/usr/local/bin/mypw', arguments: ['run'], cwd: '/nonexistent' });
    assert.deepStrictEqual(cli, {
      executable: '/usr/local/bin/mypw',
      argsPrefix: ['run'],
      source: 'explicit',
    });
  });

  test('falls back to the detected package manager', () => {
    const cli = resolveCli({ cwd: '/definitely/not/a/real/path-xyz-123' });
    assert.strictEqual(cli.source, 'package-manager');
    assert.ok(cli.argsPrefix.includes('playwright'));
  });

  test('package manager commands are structured (no shell strings)', () => {
    assert.deepStrictEqual(packageManagerCommand('npm').argsPrefix, ['playwright']);
    assert.deepStrictEqual(packageManagerCommand('pnpm').argsPrefix, ['exec', 'playwright']);
    assert.deepStrictEqual(packageManagerCommand('yarn').argsPrefix, ['playwright']);
    assert.deepStrictEqual(packageManagerCommand('bun').argsPrefix, ['playwright']);
  });

  test('windows executables use .cmd shims', () => {
    if (process.platform === 'win32') {
      assert.strictEqual(packageManagerCommand('npm').executable, 'npx.cmd');
      assert.strictEqual(packageManagerCommand('pnpm').executable, 'pnpm.cmd');
    } else {
      assert.strictEqual(packageManagerCommand('npm').executable, 'npx');
      assert.strictEqual(packageManagerCommand('pnpm').executable, 'pnpm');
    }
  });

  test('local install runs through node with the cli path', () => {
    const root = makeTempDir();
    try {
      const cliDir = path.join(root, 'node_modules', '@playwright', 'test');
      fs.mkdirSync(cliDir, { recursive: true });
      fs.writeFileSync(path.join(cliDir, 'cli.js'), '');
      const cli = resolveCli({ cwd: root, nodeExecutable: '/usr/bin/node' });
      assert.strictEqual(cli.source, 'local-install');
      assert.strictEqual(cli.executable, '/usr/bin/node');
      assert.deepStrictEqual(cli.argsPrefix, [path.join(cliDir, 'cli.js')]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('local CLI launched through the extension-host runtime uses Electron as Node', () => {
    const cli = {
      executable: process.execPath,
      argsPrefix: ['/workspace/node_modules/@playwright/test/cli.js'],
      source: 'local-install' as const,
    };
    assert.deepStrictEqual(
      environmentForCli(cli, { CUSTOM: 'value' }),
      { CUSTOM: 'value', ELECTRON_RUN_AS_NODE: '1' },
    );
  });

  test('package-manager CLI terminal environment is unchanged', () => {
    assert.deepStrictEqual(
      environmentForCli(packageManagerCommand('npm'), { CUSTOM: 'value' }),
      { CUSTOM: 'value' },
    );
  });
});
