import * as path from 'path';
import { DiscoveredConfig, DiscoveredSuite, DiscoveredTest } from './model';

type EditorTestSelectionKind = 'file' | 'suite' | 'test';

/**
 * Serializable CodeLens/command payload. URI and position deliberately avoid
 * VS Code API instances so the payload survives the extension-host command
 * round trip without depending on this extension's former TestItems.
 */
export interface EditorTestSelection {
  kind: EditorTestSelectionKind;
  targetId: string;
  discoverySource?: 'ast' | 'cli';
  documentVersion?: number;
  discoveryRevision?: number;
  columnMissing?: boolean;
  declarationsOnLine?: number;
  uri: string;
  file: string;
  position: {
    line: number;
    character: number;
  };
  fullTitle?: string;
  /** Individual describe/test titles, preserving boundaries for CLI grep. */
  titlePath?: string[];
  /** Multiple generated tests collapsed at the same source declaration. */
  titlePaths?: string[][];
}

/** Flattens one discovered file into source-ordered editor actions. */
export function editorSelectionsForFile(
  model: DiscoveredConfig,
  filePath: string,
  uri: string,
): EditorTestSelection[] {
  const normalized = path.normalize(filePath);
  const file = model.files.find((candidate) => path.normalize(candidate.file) === normalized);
  if (!file) {
    return [];
  }

  const selections: EditorTestSelection[] = [{
    kind: 'file',
    targetId: model.id,
    uri,
    file: file.file,
    position: { line: 0, character: 0 },
  }];

  for (const suite of file.suites) {
    appendSuite(selections, model.id, uri, file.file, suite, []);
  }
  for (const test of file.tests) {
    appendTest(selections, model.id, uri, test, []);
  }

  const collapsed = collapseSelections(selections);
  const lineCounts = new Map<string, number>();
  for (const selection of collapsed) {
    const key = `${selection.kind}:${selection.position.line}`;
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
  }
  for (const selection of collapsed) {
    selection.declarationsOnLine = lineCounts.get(`${selection.kind}:${selection.position.line}`);
  }
  return collapsed.sort((a, b) => {
    if (a.kind === 'file' && b.kind === 'file') {
      return 0;
    }
    if (a.kind === 'file') {
      return -1;
    }
    if (b.kind === 'file') {
      return 1;
    }
    return a.position.line - b.position.line || a.position.character - b.position.character;
  });
}

function appendSuite(
  selections: EditorTestSelection[],
  targetId: string,
  uri: string,
  file: string,
  suite: DiscoveredSuite,
  parentTitles: string[],
): void {
  const titles = [...parentTitles, suite.title];
  if (suite.location && suite.location.line > 0) {
    selections.push({
      kind: 'suite',
      targetId,
      uri,
      file,
      position: toPosition(suite.location.line, suite.location.column),
      columnMissing: suite.location.column <= 0,
      fullTitle: titles.join(' '),
      titlePath: titles,
    });
  }
  for (const child of suite.suites) {
    appendSuite(selections, targetId, uri, file, child, titles);
  }
  for (const test of suite.tests) {
    appendTest(selections, targetId, uri, test, titles);
  }
}

function appendTest(
  selections: EditorTestSelection[],
  targetId: string,
  uri: string,
  test: DiscoveredTest,
  parentTitles: string[],
): void {
  if (test.location.line <= 0) {
    return;
  }
  selections.push({
    kind: 'test',
    targetId,
    uri,
    file: test.location.file,
    position: toPosition(test.location.line, test.location.column),
    columnMissing: test.location.column <= 0,
    fullTitle: test.fullTitle,
    titlePath: [...parentTitles, test.title],
  });
}

function collapseSelections(selections: EditorTestSelection[]): EditorTestSelection[] {
  const byLocation = new Map<string, EditorTestSelection>();
  for (const selection of selections) {
    const key = [
      selection.kind,
      path.normalize(selection.file),
      selection.position.line,
      selection.position.character,
    ].join('\0');
    const existing = byLocation.get(key);
    if (!existing) {
      byLocation.set(key, selection);
      continue;
    }
    mergeTitlePaths(existing, selection);
  }
  return [...byLocation.values()];
}

function mergeTitlePaths(target: EditorTestSelection, incoming: EditorTestSelection): void {
  const paths = [
    ...(target.titlePaths ?? (target.titlePath ? [target.titlePath] : [])),
    ...(incoming.titlePaths ?? (incoming.titlePath ? [incoming.titlePath] : [])),
  ];
  const unique = new Map(paths.map((titles) => [titles.join('\0'), titles]));
  target.titlePaths = [...unique.values()];
}

function toPosition(line: number, column: number): { line: number; character: number } {
  return {
    line: Math.max(0, line - 1),
    character: Math.max(0, column - 1),
  };
}
