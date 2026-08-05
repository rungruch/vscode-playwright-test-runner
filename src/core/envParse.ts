/**
 * Parses legacy `playwrightrunner.playwrightEnvironmentVariables` entries
 * (an array of "KEY=value" strings) into an environment object. Values may
 * contain '=' characters (split on the first '=' only).
 */
export function parseEnvironmentArray(entries: readonly string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (!Array.isArray(entries)) {
    return env;
  }
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      continue;
    }
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1);
    if (key.length > 0) {
      env[key] = value;
    }
  }
  return env;
}
