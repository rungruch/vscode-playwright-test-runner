import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PlaywrightCodeLensProvider } from '../../codeLens';
import { CompanionCliRunner } from '../../companionRunner';
import { CompanionCliRunRequest, CompanionRunSummary } from '../../core/companionTypes';
import { DiscoveryService } from '../../discoveryService';
import { RunTarget } from '../../runTarget';
import { Settings } from '../../settings';
import { ArtifactService } from '../../artifactService';
import { createCliTerminal } from '../../terminal';

suite('responsive editor and concurrent companion runs', () => {
  const delayedDisposals: vscode.Disposable[] = [];
  suiteTeardown(() => {
    for (const disposable of delayedDisposals) {
      disposable.dispose();
    }
  });
  test('launches an integrated CLI terminal with literal argv, independent of the default shell', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright terminal '));
    const output = path.join(directory, 'argv.json');
    const extension = vscode.extensions.getExtension('rungruch.playwright-codelens-runner');
    assert.ok(extension);
    const values = ['space path', 'quote"here', "it's", '$x;&|', '%USERPROFILE%', 'end\\'];
    const terminal = createCliTerminal(fakeTarget(directory), 'Playwright argv regression', [
      '-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))', '--', output, ...values,
    ], path.join(extension.extensionPath, 'dist', 'terminalLauncher.cjs'));
    try {
      let content: string | undefined;
      const deadline = Date.now() + 10_000;
      while (!content && Date.now() < deadline) {
        content = await fs.readFile(output, 'utf8').catch(() => undefined);
        if (!content) { await new Promise(resolve => setTimeout(resolve, 50)); }
      }
      assert.ok(content, 'terminal relay actually executes the CLI');
      assert.deepStrictEqual(JSON.parse(content), values);
    } finally {
      terminal.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  test('keeps browser modes independent and lets explicit config opt out of the default', async () => {
    const configuration = vscode.workspace.getConfiguration('playwrightCodeLensRunner');
    const keys = ['browser', 'inspector.browser', 'companion.browser', 'flakeLab.browser'];
    const saved = keys.map((key) => configuration.inspect<string>(key)?.globalValue);
    const settings = new Settings();
    try {
      for (const key of keys) { await configuration.update(key, undefined, vscode.ConfigurationTarget.Global); }
      await configuration.update('inspector.browser', 'firefox', vscode.ConfigurationTarget.Global);
      assert.deepStrictEqual([settings.inspectorBrowser, settings.companionBrowser, settings.flakeLabBrowser], ['firefox', 'config', 'config']);
      await configuration.update('browser', 'chromium', vscode.ConfigurationTarget.Global);
      assert.deepStrictEqual([settings.inspectorBrowser, settings.companionBrowser, settings.flakeLabBrowser], ['firefox', 'chromium', 'chromium']);
      await configuration.update('inspector.browser', 'config', vscode.ConfigurationTarget.Global);
      await configuration.update('flakeLab.browser', 'webkit', vscode.ConfigurationTarget.Global);
      assert.deepStrictEqual([settings.inspectorBrowser, settings.companionBrowser, settings.flakeLabBrowser], ['config', 'chromium', 'webkit']);
      await configuration.update('companion.browser', 'config', vscode.ConfigurationTarget.Global);
      assert.strictEqual(settings.companionBrowser, 'config');
    } finally {
      for (const [index, key] of keys.entries()) { await configuration.update(key, saved[index], vscode.ConfigurationTarget.Global); }
    }
  });

  test('coalesces artifact scans and rejects an older scan finishing last', async () => {
    let calls = 0;
    let releaseOld!: () => void;
    const old = new Promise<[]>(resolve => { releaseOld = () => resolve([]); });
    const service = new ArtifactService(async (roots) => {
      calls++;
      if (roots.some(root => root.targetIds.includes('old'))) { return old; }
      return [{ kind: 'report', path: '/new/report', label: 'New', modifiedAt: 1, targetId: 'new' }];
    });
    const oldTarget = { ...fakeTarget('/old'), id: 'old' };
    const newTarget = { ...fakeTarget('/new'), id: 'new' };
    try {
      const first = service.scan([oldTarget]);
      const same = service.scan([oldTarget]);
      await service.scan([newTarget]);
      releaseOld();
      await Promise.all([first, same]);
      assert.strictEqual(calls, 2);
      assert.strictEqual(service.artifacts[0].targetId, 'new');
    } finally { service.dispose(); }
  });

  test('shows only the selected historical output, including after restoration', async () => {
    const state = new Map<string, unknown>();
    const context = { asAbsolutePath: (file: string) => path.resolve(file),
      workspaceState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } } } as unknown as vscode.ExtensionContext;
    const runner = new CompanionCliRunner(context);
    const target = fakeTarget(os.tmpdir());
    const request = syntheticRequest(target, 0, 1);
    const first = await runner.run(target, { ...request, args: ['-e', "process.stdout.write('output-old')", '--'] });
    await runner.run(target, { ...request, startedAt: 2, args: ['-e', "process.stdout.write('output-new')", '--'] });
    runner.dispose();
    const restored = new CompanionCliRunner(context);
    try {
      await restored.showOutput(first.id);
      const document = vscode.window.activeTextEditor?.document;
      assert.ok(document);
      assert.ok(document.uri.scheme.startsWith('playwright-run-output-'));
      assert.ok(document.getText().includes('output-old'));
      assert.ok(!document.getText().includes('output-new'));
      assert.ok(document.getText().includes('Retained output tail'));
    } finally { restored.dispose(); }
  });

  test('executes exact scopes as one managed run without losing earlier batch results', async () => {
    const runner = new CompanionCliRunner({ asAbsolutePath: (file: string) => path.resolve(file),
      workspaceState: { get: () => undefined, update: async () => undefined } } as unknown as vscode.ExtensionContext);
    const target = fakeTarget(os.tmpdir());
    const first = syntheticRequest(target, 20, 1);
    const second = { ...first, args: first.args.map(arg => arg.replaceAll('one', 'two')) };
    try {
      const final = await runner.run(target, { ...first, kind: 'rerun-failed', batches: [first, second].map(request => ({
        args: request.args, selection: request.selection, initialTests: [],
      })) });
      assert.strictEqual(final.passed, 2);
      assert.strictEqual(final.total, 2);
      assert.deepStrictEqual(final.tests?.map(test => test.title), ['one', 'two']);
      assert.strictEqual(runner.runs.length, 1);
    } finally { runner.dispose(); }
  });
  test('refreshes file content without another version probe and isolates cancelled callers', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codelens-discovery-'));
    const file = path.join(directory, 'one.spec.ts');
    const log = path.join(directory, 'calls.log');
    const report = { config: { rootDir: directory, projects: [{ name: 'chromium' }] }, suites: [{
      title: 'one.spec.ts', file, specs: [{ title: 'one', file, line: 1, column: 1, tests: [{ projectName: 'chromium' }] }],
    }] };
    const target = fakeTarget(directory);
    target.cli.argsPrefix = ['-e', `
      const version = process.argv.includes('--version');
      require('fs').appendFileSync(${JSON.stringify(log)}, version ? 'version\\n' : 'list\\n');
      setTimeout(() => process.stdout.write(version ? 'Version 1.62.1' : ${JSON.stringify(JSON.stringify(report))}), 30);
    `, '--'];
    const discovery = new DiscoveryService({ workspaceState: { get: () => undefined, update: async () => undefined } } as unknown as vscode.ExtensionContext);
    const internals = discovery as unknown as {
      targets: RunTarget[];
      refreshForFiles(changes: Array<{ path: string; rescan: boolean }>): Promise<void>;
      invalidateTarget(id: string, retire: boolean, clearCli: boolean): void;
    };
    internals.targets = [target];
    const firstCaller = new vscode.CancellationTokenSource();
    try {
      await discovery.discover(target);
      await internals.refreshForFiles([{ path: file, rescan: false }]);
      assert.strictEqual(await fs.readFile(log, 'utf8'), 'version\nlist\nlist\n');
      assert.strictEqual(discovery.cachedModel(target.id), undefined);
      assert.deepStrictEqual(discovery.knownProjects(target.id), ['chromium']);
      await discovery.discoverForFile(target, file);
      assert.strictEqual(await fs.readFile(log, 'utf8'), 'version\nlist\nlist\n');

      internals.invalidateTarget(target.id, false, false);
      const first = discovery.discoverForFile(target, file, firstCaller.token);
      const second = discovery.discoverForFile(target, file);
      firstCaller.cancel();
      assert.strictEqual(await first, undefined);
      assert.ok((await second)?.files.length);
      assert.strictEqual(await fs.readFile(log, 'utf8'), 'version\nlist\nlist\nlist\n');

      internals.invalidateTarget(target.id, false, false);
      const stale = discovery.discoverForFile(target, file);
      internals.invalidateTarget(target.id, false, false);
      assert.strictEqual(await stale, undefined);
      assert.ok((await discovery.discoverForFile(target, file))?.files.length);
    } finally {
      firstCaller.dispose();
      discovery.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('renders and reuses source actions while ownership is blocked', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codelens-static-'));
    const uri = vscode.Uri.file(path.join(directory, 'cold.spec.ts'));
    await fs.writeFile(uri.fsPath, "import { test } from '@playwright/test';\ntest('cold test', async () => {});\n");
    const document = await vscode.workspace.openTextDocument(uri);
    const event = new vscode.EventEmitter<never>();
    let release!: () => void;
    const blocked = new Promise<undefined>((resolve) => { release = () => resolve(undefined); });
    let requests = 0;
    const target = fakeTarget(directory);
    const discovery = {
      onDidDiscover: event.event,
      provisionalTargetForFile: async () => target,
      cachedModelForFile: () => undefined,
      cachedModel: () => undefined,
      errorFor: () => undefined,
      resolveTargetForFile: () => { requests++; return blocked; },
    } as unknown as DiscoveryService;
    const provider = new PlaywrightCodeLensProvider(discovery);
    let reads = 0;
    const observedDocument = new Proxy({} as vscode.TextDocument, {
      get(_target, property) {
        return property === 'getText' ? () => { reads++; return document.getText(); } : Reflect.get(document, property);
      },
    });
    const cancellation = new vscode.CancellationTokenSource();
    const configuration = vscode.workspace.getConfiguration('playwrightCodeLensRunner', uri);
    const previousStatic = configuration.inspect<boolean>('codeLens.fastStaticDiscovery')?.globalValue;
    let timer: NodeJS.Timeout | undefined;
    try {
      const lenses = await Promise.race([
        provider.provideCodeLenses(observedDocument, cancellation.token),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('CodeLens waited for blocked ownership discovery')), 1000); }),
      ]);
      assert.ok(lenses.some((lens) => lens.command?.title === '$(play) Run Test'));
      assert.ok(lenses.every((lens) => lens.command?.arguments?.[0]?.discoverySource === 'ast'));
      await provider.provideCodeLenses(observedDocument, cancellation.token);
      assert.strictEqual(reads, 1, 'the same document version must not be parsed again');
      assert.strictEqual(requests, 1, 'ownership requests are shared');
      await configuration.update('codeLens.fastStaticDiscovery', false, vscode.ConfigurationTarget.Global);
      let completed = false;
      const authoritative = provider.provideCodeLenses(observedDocument, cancellation.token).then(() => { completed = true; });
      await new Promise((resolve) => setImmediate(resolve));
      assert.strictEqual(completed, false, 'disabling static discovery must wait for the CLI owner');
      release();
      await authoritative;
    } finally {
      clearTimeout(timer);
      release();
      provider.dispose();
      event.dispose();
      cancellation.dispose();
      await configuration.update('codeLens.fastStaticDiscovery', previousStatic, vscode.ConfigurationTarget.Global);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('bounds inactive discovery entries while retaining open documents and recently used files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codelens-cache-'));
    const pinned = path.join(directory, 'open.spec.ts');
    await fs.writeFile(pinned, '');
    await vscode.workspace.openTextDocument(vscode.Uri.file(pinned));
    const target = fakeTarget(directory);
    const discovery = new DiscoveryService({ workspaceState: { get: () => undefined, update: async () => undefined } } as unknown as vscode.ExtensionContext);
    const internals = discovery as unknown as {
      fileCache: Map<string, unknown>;
      recordDiagnostics(target: RunTarget, startedAt: number, version: string, args: string[], file: string, projects: string[], error: undefined): void;
    };
    const add = (file: string) => {
      internals.fileCache.set(`${target.id}\0${file}`, { id: target.id, files: [] });
      internals.recordDiagnostics(target, Date.now(), 'Version 1.62.1', [], file, [], undefined);
    };
    try {
      add(pinned);
      for (let index = 0; index < 128; index++) { add(path.join(directory, `${index}.spec.ts`)); }
      discovery.cachedModelForFile(target.id, path.join(directory, '0.spec.ts'));
      add(path.join(directory, 'new.spec.ts'));
      assert.strictEqual(internals.fileCache.size, 129);
      assert.ok(discovery.cachedModelForFile(target.id, pinned));
      assert.ok(discovery.cachedModelForFile(target.id, path.join(directory, '0.spec.ts')));
      assert.strictEqual(discovery.cachedModelForFile(target.id, path.join(directory, '1.spec.ts')), undefined);
      assert.strictEqual(discovery.diagnosticsFor(target.id, path.join(directory, '1.spec.ts')), undefined);
    } finally {
      // VS Code registers output channels asynchronously; dispose after this suite drains its RPC work.
      delayedDisposals.push(discovery);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('keeps concurrent runs ordered, serializes writes, and retains active runs when clearing history', async () => {
    const state = new Map<string, unknown>();
    let writes = 0;
    let maximumWrites = 0;
    const context = {
      asAbsolutePath: (file: string) => path.resolve(file),
      workspaceState: {
        get: (key: string) => state.get(key),
        update: async (key: string, value: unknown) => {
          maximumWrites = Math.max(maximumWrites, ++writes);
          await new Promise((resolve) => setTimeout(resolve, 5));
          state.set(key, value);
          writes--;
        },
      },
    } as unknown as vscode.ExtensionContext;
    const runner = new CompanionCliRunner(context);
    const target = fakeTarget(os.tmpdir());
    try {
      const older = runner.run(target, syntheticRequest(target, 350, 1));
      const newer = runner.run(target, syntheticRequest(target, 50, 2));
      const completedNewer = await newer;
      assert.strictEqual(runner.latestRun?.id, completedNewer.id);
      assert.ok(runner.hasActiveRun);
      const completedOlder = await older;
      assert.strictEqual(completedOlder.passed, 1);
      assert.strictEqual(runner.latestRun?.id, completedNewer.id, 'older completion must not steal latest');
      assert.strictEqual((state.get('companion.latestRun') as CompanionRunSummary).id, completedNewer.id);
      assert.strictEqual(maximumWrites, 1);

      const active = runner.run(target, syntheticRequest(target, 1000, 3));
      await runner.clearRuns();
      assert.strictEqual(runner.runs.length, 1);
      assert.strictEqual(runner.runs[0].status, 'running');
      runner.cancel(runner.runs[0].id);
      assert.strictEqual((await active).status, 'cancelled');
      assert.strictEqual(runner.hasActiveRun, false);
    } finally {
      runner.dispose();
    }
  });

  test('publishes final results immediately without a later live publication', async () => {
    const runner = new CompanionCliRunner({
      asAbsolutePath: (file: string) => path.resolve(file),
      workspaceState: { get: () => undefined, update: async () => undefined },
    } as unknown as vscode.ExtensionContext);
    const target = fakeTarget(os.tmpdir());
    const statuses: string[] = [];
    const listener = runner.onDidChange((summary) => { if (summary) { statuses.push(summary.status); } });
    try {
      const final = await runner.run(target, syntheticRequest(target, 0, Date.now()));
      assert.strictEqual(final.passed, 1);
      assert.strictEqual(final.activeTests, 0);
      const count = statuses.length;
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.strictEqual(statuses.length, count);
      assert.strictEqual(statuses.at(-1), 'passed');
    } finally {
      listener.dispose();
      runner.dispose();
    }
  });
});

function fakeTarget(directory: string): RunTarget {
  return {
    id: 'runtime-test', cwd: directory, configDir: directory,
    workspaceFolder: { name: 'runtime-test', index: 0, uri: vscode.Uri.file(directory) },
    cli: { executable: process.execPath, argsPrefix: [], source: 'explicit' }, env: {}, runOptions: [],
  };
}

function syntheticRequest(target: RunTarget, delay: number, startedAt: number): CompanionCliRunRequest {
  const script = `
    const test = { id: 'one', title: 'one', titlePath: ['one'], file: '/tmp/one.spec.ts', line: 1, column: 1 };
    const emit = event => process.stdout.write('\\u001ePLAYWRIGHT_CODELENS_EVENT:' + JSON.stringify({version: 1, runId: process.env.PLAYWRIGHT_CODELENS_RUN_ID, ...event}) + '\\n');
    emit({type: 'plan', total: 1, tests: [test]});
    emit({type: 'testBegin', test, retry: 0, workerIndex: 0});
    setTimeout(() => emit({type: 'testEnd', test, retry: 0, workerIndex: 0, status: 'passed', outcome: 'expected', durationMs: 1, willRetry: false}), ${delay});
  `;
  return {
    kind: 'companion-run', targetId: target.id, cwd: target.cwd, env: {},
    args: ['-e', script, '--'], startedAt, projects: [], selection: { files: [], titleFilters: [] },
  };
}
