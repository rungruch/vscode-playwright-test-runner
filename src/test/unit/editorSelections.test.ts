import * as assert from 'assert';
import { editorSelectionsForFile } from '../../core/editorSelections';
import { DiscoveredConfig } from '../../core/model';

const FILE = '/workspace/tests/example.spec.ts';

const MODEL: DiscoveredConfig = {
  id: '/workspace/playwright.config.ts',
  configFile: '/workspace/playwright.config.ts',
  cwd: '/workspace',
  rootDir: '/workspace',
  projects: ['chromium'],
  errors: [],
  files: [{
    id: 'file',
    file: FILE,
    relativeFile: 'tests/example.spec.ts',
    tests: [{
      id: 'top',
      title: 'duplicate',
      fullTitle: 'duplicate',
      location: { file: FILE, line: 20, column: 1 },
      projects: ['chromium'],
      tags: [],
      skipped: false,
    }],
    suites: [{
      id: 'outer',
      title: 'Math',
      location: { file: FILE, line: 3, column: 1 },
      tests: [{
        id: 'first',
        title: 'duplicate',
        fullTitle: 'Math duplicate',
        location: { file: FILE, line: 5, column: 3 },
        projects: ['chromium'],
        tags: [],
        skipped: false,
      }],
      suites: [{
        id: 'nested',
        title: 'nested',
        location: { file: FILE, line: 9, column: 3 },
        suites: [],
        tests: [{
          id: 'second',
          title: 'duplicate',
          fullTitle: 'Math nested duplicate',
          location: { file: FILE, line: 10, column: 5 },
          projects: ['chromium'],
          tags: [],
          skipped: false,
        }],
      }],
    }],
  }],
};

suite('editorSelections', () => {
  test('flattens file, nested suites, top-level tests, and duplicate titles', () => {
    const selections = editorSelectionsForFile(MODEL, FILE, 'file:///workspace/tests/example.spec.ts');
    assert.deepStrictEqual(
      selections.map((selection) => [selection.kind, selection.position.line, selection.fullTitle]),
      [
        ['file', 0, undefined],
        ['suite', 2, 'Math'],
        ['test', 4, 'Math duplicate'],
        ['suite', 8, 'Math nested'],
        ['test', 9, 'Math nested duplicate'],
        ['test', 19, 'duplicate'],
      ],
    );
    assert.ok(selections.every((selection) => selection.targetId === MODEL.id));
  });

  test('returns no selections for an unknown file', () => {
    assert.deepStrictEqual(editorSelectionsForFile(MODEL, '/other.spec.ts', 'file:///other.spec.ts'), []);
  });

  test('deduplicates project-specific specs at the same source location', () => {
    const duplicated: DiscoveredConfig = {
      ...MODEL,
      projects: ['chromium', 'webkit'],
      files: [{
        ...MODEL.files[0],
        tests: [
          MODEL.files[0].tests[0],
          { ...MODEL.files[0].tests[0], id: 'top-webkit', projects: ['webkit'] },
        ],
        suites: [],
      }],
    };
    const selections = editorSelectionsForFile(duplicated, FILE, 'file:///workspace/tests/example.spec.ts');
    assert.deepStrictEqual(selections.map((selection) => selection.kind), ['file', 'test']);
  });
});
