import * as path from 'path';
import { DiscoveredConfig, DiscoveredSuite, DiscoveredTest } from './model';

export type EditorTestSelectionKind = 'file' | 'suite' | 'test';

/**
 * Serializable CodeLens/command payload. URI and position deliberately avoid
 * VS Code API instances so the payload survives the extension-host command
 * round trip without depending on this extension's former TestItems.
 */
export interface EditorTestSelection {
  kind: EditorTestSelectionKind;
  targetId: string;
  uri: string;
  file: string;
  position: {
    line: number;
    character: number;
  };
  fullTitle?: string;
  /** Individual describe/test titles, preserving boundaries for CLI grep. */
  titlePath?: string[];
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

  return deduplicateSelections(selections).sort((a, b) => {
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
    fullTitle: test.fullTitle,
    titlePath: [...parentTitles, test.title],
  });
}

function deduplicateSelections(selections: EditorTestSelection[]): EditorTestSelection[] {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const key = [
      selection.kind,
      path.normalize(selection.file),
      selection.position.line,
      selection.position.character,
      ...(selection.titlePath ?? []),
    ].join('\0');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toPosition(line: number, column: number): { line: number; character: number } {
  return {
    line: Math.max(0, line - 1),
    character: Math.max(0, column - 1),
  };
}
