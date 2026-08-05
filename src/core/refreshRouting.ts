import * as path from 'path';

export interface RefreshableTarget {
  configDir: string;
  configFile?: string;
}

/** Selects exact config targets, otherwise every target at the deepest containing directory. */
export function targetsForChangedPath<T extends RefreshableTarget>(
  targets: readonly T[],
  fsPath: string,
  configChanged: boolean,
): T[] {
  const changed = path.normalize(fsPath);
  if (configChanged) {
    const exact = targets.filter((target) => target.configFile && path.normalize(target.configFile) === changed);
    if (exact.length > 0) {
      return exact;
    }
  }

  const containing = targets
    .filter((target) => containsPath(target.configDir, changed))
    .sort((a, b) => b.configDir.length - a.configDir.length);
  const deepest = containing[0]?.configDir.length;
  return deepest === undefined
    ? []
    : containing.filter((target) => target.configDir.length === deepest);
}

function containsPath(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
