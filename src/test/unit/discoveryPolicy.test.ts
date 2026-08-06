import * as assert from 'assert';
import * as path from 'path';
import {
  discoveryPickerCandidates,
  isBenignNoTestsFailure,
  rankDiscoveryTargets,
} from '../../core/discoveryPolicy';

const ROOT = path.join(path.parse(process.cwd()).root, 'workspace');

suite('discoveryPolicy', () => {
  test('prioritizes a cached Playwright rootDir over config proximity', () => {
    const file = path.join(ROOT, 'tests', 'example.spec.ts');
    const targets = [
      {
        id: 'near-config',
        configDir: path.join(ROOT, 'tests'),
        workspaceDir: ROOT,
      },
      {
        id: 'reported-owner',
        configDir: path.join(ROOT, 'configs'),
        workspaceDir: ROOT,
        cachedRootDir: path.join(ROOT, 'tests'),
      },
    ];

    assert.deepStrictEqual(
      rankDiscoveryTargets(targets, file, (target) => target).map((target) => target.id),
      ['reported-owner', 'near-config'],
    );
  });

  test('falls back to the deepest containing config and deterministic IDs', () => {
    const file = path.join(ROOT, 'packages', 'app', 'tests', 'example.spec.ts');
    const targets = [
      { id: 'z-root', configDir: ROOT, workspaceDir: ROOT },
      { id: 'nested', configDir: path.join(ROOT, 'packages', 'app'), workspaceDir: ROOT },
      { id: 'a-root', configDir: ROOT, workspaceDir: ROOT },
    ];

    assert.deepStrictEqual(
      rankDiscoveryTargets(targets, file, (target) => target).map((target) => target.id),
      ['nested', 'a-root', 'z-root'],
    );
  });

  test('keeps failed targets visible in an explicit picker', () => {
    const owner = { id: 'owner' };
    const fallback = { id: 'fallback' };
    const failed = { id: 'failed' };
    assert.deepStrictEqual(
      discoveryPickerCandidates([owner], [fallback], [failed, owner]).map((target) => target.id),
      ['owner', 'failed'],
    );
  });

  test('accepts only the expected Playwright no-tests response', () => {
    const stderr = [
      'Error: No tests found.',
      'Make sure that arguments are regular expressions matching test files.',
      'You may need to escape symbols like "$" or "*" and quote the arguments.',
    ].join('\n');
    assert.strictEqual(
      isBenignNoTestsFailure(stderr, ['Playwright did not produce a JSON report.']),
      true,
    );
    assert.strictEqual(
      isBenignNoTestsFailure('', [stderr]),
      true,
      'accepts the multiline message emitted by Playwright\'s JSON reporter',
    );
  });

  test('does not hide substantive failures that mention no tests', () => {
    assert.strictEqual(
      isBenignNoTestsFailure('Error: No tests found because fixture generation failed', []),
      false,
    );
    assert.strictEqual(
      isBenignNoTestsFailure('Error: No tests found.\nConfiguration failed: missing token', []),
      false,
    );
    assert.strictEqual(
      isBenignNoTestsFailure('Error: No tests found.', ['Reporter failed to load']),
      false,
    );
  });
});
