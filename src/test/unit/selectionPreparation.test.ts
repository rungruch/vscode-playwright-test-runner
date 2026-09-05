import * as assert from 'assert';
import { parseTestFileAst } from '../../core/astParser';
import { editorSelectionsForFile } from '../../core/editorSelections';
import { prepareSelection } from '../../core/selectionPreparation';

suite('companion selection preparation', () => {
  const file = '/workspace/test.spec.ts';
  const uri = 'file:///workspace/test.spec.ts';
  const model = parseTestFileAst("test('example', () => {});", file, { targetId: 'owner' });
  const requested = { ...editorSelectionsForFile(model, file, uri)[1], discoverySource: 'ast' as const, documentVersion: 1 };

  test('saves only the selected dirty document before ownership and CLI verification', async () => {
    const calls: string[] = [];
    const document = { version: 1, isDirty: true, save: async () => { calls.push('save'); document.isDirty = false; return true; } };
    const result = await prepareSelection(requested, {
      openDocument: async () => document,
      afterSave: async () => { calls.push('refresh'); },
      resolveTarget: async () => { calls.push('owner'); return { id: 'owner' }; },
      discover: async () => { calls.push('discover'); return model; },
      revision: () => 0,
    });
    assert.deepStrictEqual(calls, ['save', 'refresh', 'owner', 'discover']);
    assert.strictEqual(result.error, undefined);
    if (!result.error && 'selection' in result) {
      assert.strictEqual(result.selection.discoverySource, 'cli');
    }
  });

  test('does not discover when saving fails or the clicked document version is stale', async () => {
    for (const version of [1, 2]) {
      const result = await prepareSelection(requested, {
        openDocument: async () => ({ version, isDirty: true, save: async () => false }),
        resolveTarget: async () => { assert.fail('must not resolve ownership'); },
        discover: async () => { assert.fail('must not execute discovery'); },
        revision: () => 0,
      });
      assert.ok(result.error);
    }
  });

  test('rejects edits and config invalidation during CLI verification', async () => {
    for (const change of ['document', 'config']) {
      const document = { version: 1, isDirty: false, save: async () => true };
      let revision = 0;
      const result = await prepareSelection(requested, {
        openDocument: async () => document,
        resolveTarget: async () => ({ id: 'owner' }),
        discover: async () => {
          if (change === 'document') { document.version++; } else { revision++; }
          return model;
        },
        revision: () => revision,
      });
      assert.ok(result.error);
    }
  });

  test('classifies missing declarations separately from failed discovery and ambiguity', async () => {
    for (const scenario of ['missing', 'error', 'ambiguous']) {
      const discovered = scenario === 'missing' ? { ...model, files: [] }
        : scenario === 'error' ? { ...model, errors: ['config failed'] }
          : parseTestFileAst("test('example', () => {});\ntest('example', () => {});", file, { targetId: 'owner' });
      const result = await prepareSelection({ ...requested, discoverySource: 'cli', position: { line: 20, character: 0 } }, {
        openDocument: async () => ({ version: 1, isDirty: false, save: async () => true }),
        resolveTarget: async () => ({ id: 'owner' }),
        discover: async () => discovered,
        revision: () => 0,
      });
      assert.ok(result.error);
      if (result.error !== undefined) {
        assert.strictEqual(result.reason, scenario === 'missing' ? 'missing' : undefined);
      }
    }
  });

  test('rejects an edit made while the saved file refresh settles', async () => {
    const document = { version: 1, isDirty: true, save: async () => { document.isDirty = false; return true; } };
    const result = await prepareSelection(requested, {
      openDocument: async () => document,
      afterSave: async () => { document.version++; },
      resolveTarget: async () => ({ id: 'owner' }),
      discover: async () => model,
      revision: () => 0,
    });
    assert.ok(result.error);
  });
});
