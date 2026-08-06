import { EditorTestSelection } from './editorSelections';
import { RunSelection, fullTitleFilter, suiteTitleFilter } from './runArguments';

/** Converts a serializable editor selection into an exact companion CLI scope. */
export function cliSelectionForEditor(selection: EditorTestSelection): RunSelection {
  const titleFilters: string[] = [];
  const titlePaths = selection.titlePaths
    ?? (selection.titlePath ? [selection.titlePath] : selection.fullTitle ? [[selection.fullTitle]] : []);
  if (selection.kind === 'test' && titlePaths.length > 1) {
    return {
      files: [selection.file],
      titleFilters,
      line: selection.position.line + 1,
    };
  }
  for (const titlePath of titlePaths) {
    if (selection.kind === 'test' && titlePath.length > 0) {
      titleFilters.push(fullTitleFilter(titlePath, selection.file));
    } else if (selection.kind === 'suite' && titlePath.length > 0) {
      titleFilters.push(suiteTitleFilter(titlePath, selection.file));
    }
  }
  return {
    files: [selection.file],
    titleFilters,
    ...(selection.kind === 'file' ? {} : { line: selection.position.line + 1 }),
  };
}
