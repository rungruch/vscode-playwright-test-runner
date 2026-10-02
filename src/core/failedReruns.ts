import * as path from 'path';
import { CompanionFailure } from './companionTypes';
import { EditorTestSelection } from './editorSelections';

function locationKey(file?: string, line?: number, column?: number): string {
  return JSON.stringify([file && path.normalize(file), line, column]);
}

/** Ordinary declarations can share one invocation; generated declarations need separate greps. */
export function groupFailedReruns(failures: CompanionFailure[], declarations: EditorTestSelection[]): {
  groups: CompanionFailure[][];
  ambiguous?: CompanionFailure;
} {
  // Global diagnostics are reproduced by the selected test scopes. Giving
  // them a separate invocation would rerun the original scope a second time.
  if (failures.some(failure => failure.file)) {
    failures = failures.filter(failure => failure.file);
  }
  const cases = new Map(declarations.filter(declaration => declaration.kind === 'test').map(declaration => [
    locationKey(declaration.file, declaration.position.line + 1, declaration.position.character + 1),
    declaration.titlePaths ?? (declaration.titlePath ? [declaration.titlePath] : []),
  ]));
  const selected = new Map<string, Set<string>>();
  for (const failure of failures) {
    const key = locationKey(failure.file, failure.line, failure.column);
    const titles = selected.get(key) ?? new Set<string>();
    titles.add(JSON.stringify(failure.titlePath));
    selected.set(key, titles);
  }
  const groups = new Map<string, CompanionFailure[]>();
  for (const failure of failures) {
    const key = locationKey(failure.file, failure.line, failure.column);
    const available = cases.get(key) ?? [];
    const flattened = failure.titlePath?.join(' ');
    if (flattened !== undefined && available.some(titles => titles.join(' ') === flattened
      && !selected.get(key)?.has(JSON.stringify(titles)))) {
      // CLI grep sees flattened titles. It cannot distinguish these cases,
      // even when a file:line:column filter is supplied.
      return { groups: [], ambiguous: failure };
    }
    const groupKey = available.length === 1 ? 'ordinary' : key;
    const group = groups.get(groupKey) ?? [];
    group.push(failure);
    groups.set(groupKey, group);
  }
  return { groups: [...groups.values()] };
}
