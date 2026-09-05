import * as path from 'path';
import { EditorTestSelection } from './editorSelections';

/** Reconciles a source declaration without ever widening it to its entire file. */
export function verifyEditorSelection(selection: EditorTestSelection, candidates: readonly EditorTestSelection[]): EditorTestSelection | undefined {
  const scoped = candidates.filter((candidate) => candidate.kind === selection.kind
    && path.normalize(candidate.file) === path.normalize(selection.file));
  if (selection.kind === 'file') {
    return scoped[0];
  }
  const titles = selection.titlePaths ?? (selection.titlePath ? [selection.titlePath] : []);
  const matchesTitle = (candidate: EditorTestSelection) => titles.length > 0 && titles.every((titles) => (
    (candidate.titlePaths ?? (candidate.titlePath ? [candidate.titlePath] : []))
      .some((path) => JSON.stringify(path) === JSON.stringify(titles))
  ));
  const onLine = scoped.filter((candidate) => candidate.position.line === selection.position.line);
  const atLocation = onLine.filter((candidate) => candidate.columnMissing
    ? selection.discoverySource === 'ast' && selection.declarationsOnLine === 1 && onLine.length === 1
    : candidate.position.character === selection.position.character);
  const matching = atLocation.filter((candidate) => selection.discoverySource === 'ast' || matchesTitle(candidate));
  const byTitle = scoped.filter((candidate) => matchesTitle(candidate)
    && !(selection.discoverySource === 'ast' && candidate.columnMissing && selection.declarationsOnLine !== 1));
  const candidate = matching.length === 1 ? matching[0] : byTitle.length === 1 ? byTitle[0] : undefined;
  if (!candidate) {
    return undefined;
  }
  // A one-case picker payload must retain its exact case after reconciliation.
  return selection.titlePaths?.length === 1 && matchesTitle(candidate)
    ? { ...candidate, titlePath: titles[0], titlePaths: titles, fullTitle: titles[0].join(' ') }
    : candidate;
}
