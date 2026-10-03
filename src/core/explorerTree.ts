import * as path from 'path';
import { EditorTestSelection } from './editorSelections';
import { DiscoveredConfig, DiscoveredFile, DiscoveredSuite, DiscoveredTest } from './model';

export interface ExplorerTestNode {
  kind: 'file' | 'suite' | 'test';
  id: string;
  label: string;
  targetId: string;
  children: ExplorerTestNode[];
  selection?: EditorTestSelection;
  projects: string[];
  tags: string[];
  skipped: boolean;
  sharedDeclaration: boolean;
}

interface ExplorerFolderNode {
  kind: 'folder';
  id: string;
  label: string;
  targetId: string;
  directory: string;
  children: ExplorerNode[];
}

export type ExplorerNode = ExplorerFolderNode | ExplorerTestNode;

/** Builds individual cases; CodeLens intentionally collapses these by declaration. */
export function explorerTree(
  model: DiscoveredConfig,
  revision: number,
  uriForFile: (file: string) => string,
  baseDirectory = model.rootDir,
): ExplorerNode[] {
  const declarations = new Map<string, ExplorerTestNode[]>();
  const selection = (
    kind: EditorTestSelection['kind'], file: string, line: number, column: number, titles?: string[],
  ): EditorTestSelection | undefined => {
    if (kind !== 'file' && line <= 0) {
      return undefined;
    }
    return {
      kind, targetId: model.id, discoverySource: 'cli', discoveryRevision: revision,
      file, uri: uriForFile(file),
      position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
      columnMissing: kind !== 'file' && column <= 0,
      ...(titles ? { fullTitle: titles.join(' '), titlePath: titles, titlePaths: [titles] } : {}),
    };
  };
  const remember = (node: ExplorerTestNode): ExplorerTestNode => {
    if (node.selection && node.kind !== 'file') {
      const { file, position } = node.selection;
      const key = JSON.stringify([node.kind, file, position.line, position.character]);
      const siblings = declarations.get(key) ?? [];
      siblings.push(node);
      declarations.set(key, siblings);
    }
    return node;
  };
  const testNode = (test: DiscoveredTest, parentTitles: string[]): ExplorerTestNode => remember({
    kind: 'test', id: test.id, label: test.title, targetId: model.id, children: [],
    selection: selection('test', test.location.file, test.location.line, test.location.column, [...parentTitles, test.title]),
    projects: test.projects, tags: test.tags, skipped: test.skipped, sharedDeclaration: false,
  });
  const children = (group: DiscoveredFile | DiscoveredSuite, file: string, titles: string[]): ExplorerTestNode[] => {
    const entries = [
      ...group.suites.map((suite) => {
        const titlePath = [...titles, suite.title];
        const nested = children(suite, file, titlePath);
        return remember({
          kind: 'suite', id: suite.id, label: suite.title, targetId: model.id, children: nested,
          selection: suite.location
            ? selection('suite', suite.location.file, suite.location.line, suite.location.column, titlePath) : undefined,
          projects: [...new Set(nested.flatMap((node) => node.projects))].sort(),
          tags: [], skipped: false, sharedDeclaration: false,
        });
      }),
      ...group.tests.map((test) => testNode(test, titles)),
    ];
    return entries.sort((a, b) => (a.selection?.position.line ?? Number.MAX_SAFE_INTEGER)
      - (b.selection?.position.line ?? Number.MAX_SAFE_INTEGER)
      || (a.selection?.position.character ?? 0) - (b.selection?.position.character ?? 0)
      || a.label.localeCompare(b.label));
  };
  const files: ExplorerTestNode[] = [...model.files]
    .sort((a, b) => a.relativeFile.localeCompare(b.relativeFile))
    .map((file) => ({
      kind: 'file', id: file.id, label: path.basename(file.file), targetId: model.id,
      children: children(file, file.file, []), selection: selection('file', file.file, 1, 1),
      projects: model.projects, tags: [], skipped: false, sharedDeclaration: false,
    }));
  for (const siblings of declarations.values()) {
    for (const node of siblings) {
      node.sharedDeclaration = siblings.length > 1;
    }
  }
  const roots: ExplorerNode[] = [];
  const folders = new Map<string, ExplorerFolderNode>();
  for (const file of files) {
    const relative = path.relative(baseDirectory, file.selection!.file);
    const root = path.parse(relative).root;
    const segments = relative.slice(root.length).split(path.sep).slice(0, -1);
    if (root) {
      segments.unshift(root);
    }
    let parent = roots;
    let directory = baseDirectory;
    for (const segment of segments) {
      directory = path.resolve(directory, segment);
      let folder = folders.get(directory);
      if (!folder) {
        folder = {
          kind: 'folder', id: JSON.stringify([model.id, 'folder', directory]), label: segment,
          targetId: model.id, directory, children: [],
        };
        folders.set(directory, folder);
        parent.push(folder);
      }
      parent = folder.children;
    }
    parent.push(file);
  }
  const sort = (nodes: ExplorerNode[]): void => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    for (const node of nodes) {
      if (node.kind === 'folder') {
        sort(node.children);
      }
    }
  };
  sort(roots);
  return roots;
}
