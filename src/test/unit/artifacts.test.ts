import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { classifyArtifactDirectory, classifyArtifactPath, rankArtifacts } from '../../core/artifacts';
import { artifactRoots, scanArtifactRoots } from '../../core/artifactScanner';

suite('artifacts', () => {
  test('scans shared roots once and retains all ten config owners', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-artifacts-'));
    try {
      await fs.mkdir(path.join(directory, 'playwright-report'));
      await fs.writeFile(path.join(directory, 'playwright-report', 'index.html'), '<html></html>');
      const targets = Array.from({ length: 10 }, (_, index) => ({ id: `config-${index}`,
        bases: [directory, directory], directories: ['playwright-report', 'test-results', 'blob-report'] }));
      const roots = artifactRoots(targets);
      let reads = 0;
      const records = await scanArtifactRoots(roots, {
        readDirectory: async (file) => { reads++; return fs.readdir(file, { withFileTypes: true }); }, stat: fs.stat,
      });
      assert.strictEqual(reads, 3);
      assert.strictEqual(records.length, 1);
      assert.deepStrictEqual(records[0].targetIds, targets.map((target) => target.id));
      assert.strictEqual(records[0].targetId, 'config-0');
      assert.deepStrictEqual(artifactRoots([{ id: 'bad', bases: [directory], directories: ['../outside'] }]), []);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  test('recognizes report ZIPs, traces, blob reports, and test-result attachments', () => {
    const root = '/ws';
    assert.strictEqual(classifyArtifactPath(root, '/ws/playwright-report/index.html'), 'report');
    assert.strictEqual(classifyArtifactPath(root, '/ws/playwright-report/report.zip'), 'report-zip');
    assert.strictEqual(classifyArtifactPath(root, '/ws/test-results/a/trace.zip'), 'trace');
    assert.strictEqual(classifyArtifactPath(root, '/ws/blob-report/report-1.zip'), 'blob-report');
    assert.strictEqual(classifyArtifactPath(root, '/ws/test-results/a/screenshot.png'), 'attachment');
    assert.strictEqual(classifyArtifactDirectory(root, '/ws/test-results/a/trace'), 'trace');
    assert.strictEqual(classifyArtifactPath('/ws/blob-report', '/ws/blob-report/report-1.zip'), 'blob-report');
    assert.strictEqual(classifyArtifactPath('/ws/test-results', '/ws/test-results/a/screenshot.png'), 'attachment');
  });

  test('ranks artifact records newest-first without changing equal-time path order determinism', () => {
    const ranked = rankArtifacts([
      { kind: 'trace', path: '/ws/z.zip', label: 'z', modifiedAt: 10, targetId: 'one' },
      { kind: 'report', path: '/ws/a', label: 'a', modifiedAt: 20, targetId: 'one' },
      { kind: 'attachment', path: '/ws/b', label: 'b', modifiedAt: 10, targetId: 'one' },
    ]);
    assert.deepStrictEqual(ranked.map((record) => record.path), ['/ws/a', '/ws/b', '/ws/z.zip']);
  });
});
