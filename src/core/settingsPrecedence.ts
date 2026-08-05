/** Explicit new settings always win, including empty strings/arrays/objects. */
export function preferExplicit<T>(explicit: T | undefined, legacy: T | undefined): T | undefined {
  return explicit !== undefined ? explicit : legacy;
}

/** Resolves [] as automatic discovery without falling back to a legacy path. */
export function resolveConfigFilesSetting(
  explicit: string[] | undefined,
  legacyPath: string | undefined,
): string[] | undefined {
  const normalizedLegacy = legacyPath && legacyPath.trim().length > 0 ? [legacyPath.trim()] : undefined;
  const selected = preferExplicit(explicit, normalizedLegacy);
  return selected && selected.length > 0 ? selected : undefined;
}

/** Resolves an explicit empty string as automatic detection, suppressing legacy. */
export function resolveOptionalStringSetting(
  explicit: string | undefined,
  legacy: string | undefined,
): string | undefined {
  const selected = preferExplicit(explicit, legacy);
  return selected && selected.trim().length > 0 ? selected.trim() : undefined;
}
