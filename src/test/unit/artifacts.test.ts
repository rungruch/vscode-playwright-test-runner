import * as assert from 'assert';
import { classifyArtifactDirectory, classifyArtifactPath, rankArtifacts } from '../../core/artifacts';

suite('artifacts', () => {
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
