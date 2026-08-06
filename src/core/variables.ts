/**
 * Variable substitution for user-configured strings:
 *
 *  - ${workspaceFolder}
 *  - ${packageRoot}
 *  - ${configDir}
 */
export interface VariableContext {
  /** Absolute path of the owning workspace folder. */
  workspaceFolder: string;
  /** Nearest folder containing package.json (and node_modules), walking up from the config directory. */
  packageRoot?: string;
  /** Directory of the Playwright config file the value applies to. */
  configDir?: string;
}

export function substituteVariables(input: string, context: VariableContext): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }
  const map = buildMap(context);
  let out = input;
  for (const [key, value] of map) {
    // Replace all occurrences; keys are literal (no regex).
    out = out.split(key).join(value);
  }
  // Normalize backward slashes to forward slashes.
  return out.replace(/\\/g, '/');
}

function buildMap(context: VariableContext): Map<string, string> {
  const map = new Map<string, string>();
  const workspace = normalize(context.workspaceFolder);
  map.set('${workspaceFolder}', workspace);
  map.set('${packageRoot}', normalize(context.packageRoot ?? context.workspaceFolder));
  map.set('${configDir}', normalize(context.configDir ?? context.packageRoot ?? context.workspaceFolder));
  return map;
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/');
}
