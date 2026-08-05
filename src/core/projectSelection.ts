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
