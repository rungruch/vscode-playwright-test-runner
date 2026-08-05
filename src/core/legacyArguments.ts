const CURSOR_COMMANDS = new Set([
  'playwright.runTest',
  'playwright.debugTest',
  'playwright.inspectTest',
]);

/** Old cursor commands accepted a regex string; new handlers resolve the active editor selection. */
export function normalizeLegacyArguments(legacyId: string, args: readonly unknown[]): unknown[] {
  if (CURSOR_COMMANDS.has(legacyId) && typeof args[0] === 'string') {
    return [];
  }
  return [...args];
}
