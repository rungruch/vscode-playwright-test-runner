/** Workspace-state key prefix for persisted companion CLI project selections. */
export const PROJECT_STATE_PREFIX = 'playwrightCodeLensRunner.projects:';

/** Workspace-state key storing the persisted project selection for one target. */
export function projectStateKey(targetId: string): string {
  return PROJECT_STATE_PREFIX + targetId;
}

/** Removes renamed/deleted projects while preserving the user's stored order. */
export function reconcileProjectSelection(
  selected: readonly string[],
  available: readonly string[] | undefined,
): string[] {
  if (available === undefined) {
    return [...selected];
  }
  const known = new Set(available);
  return [...new Set(selected.filter((project) => known.has(project)))];
}
