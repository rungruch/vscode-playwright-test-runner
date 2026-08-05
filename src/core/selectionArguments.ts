import { EditorTestSelection } from './editorSelections';
import { RunSelection, fullTitleFilter, suiteTitleFilter } from './runArguments';

/** Converts a serializable editor selection into an exact companion CLI scope. */
export function cliSelectionForEditor(selection: EditorTestSelection): RunSelection {
  const titleFilters: string[] = [];
  const titlePath = selection.titlePath ?? (selection.fullTitle ? [selection.fullTitle] : []);
  if (selection.kind === 'test' && titlePath.length > 0) {
    titleFilters.push(fullTitleFilter(titlePath));
  } else if (selection.kind === 'suite' && titlePath.length > 0) {
    titleFilters.push(suiteTitleFilter(titlePath));
  }
  return { files: [selection.file], titleFilters };
}
