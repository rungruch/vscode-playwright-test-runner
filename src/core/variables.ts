import * as path from 'path';

/**
 * Variable substitution for user-configured strings.
 *
 * Preserves the legacy `playwrightrunner.*` variables and adds `${configDir}`
 * plus the VS Code standard `${workspaceFolder}` alias:
 *
 *  - ${workspaceFolder} / ${workspaceRoot}
 *  - ${workspaceFolderBasename}
 *  - ${packageRoot}
 *  - ${configDir}
 *  - ${currentFile}, ${fileExtname}, ${fileBasename}, ${fileBasenameNoExtension}, ${fileDirname}
 */
export interface VariableContext {
  /** Absolute path of the owning workspace folder. */
  workspaceFolder: string;
  /** Nearest folder containing package.json (and node_modules), walking up from the current file. */
  packageRoot?: string;
  /** Directory of the Playwright config file the value applies to. */
  configDir?: string;
  /** Absolute path of the file the value applies to (e.g. the edited test file). */
  currentFile?: string;
}

export function substituteVariables(input: string, context: VariableContext): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }
  const map = buildMap(context);
  let out = input;
  for (const [key, value] of map) {
    if (value !== undefined) {
      // Replace all occurrences; keys are literal (no regex).
      out = out.split(key).join(value);
    }
  }
  // Legacy behavior: normalize backward slashes to forward slashes.
  return out.replace(/\\/g, '/');
}

function buildMap(context: VariableContext): Map<string, string> {
  const map = new Map<string, string>();
  const workspace = normalize(context.workspaceFolder);
  map.set('${workspaceFolder}', workspace);
  map.set('${workspaceRoot}', workspace);
  map.set('${workspaceFolderBasename}', path.basename(workspace));
  map.set('${packageRoot}', normalize(context.packageRoot ?? context.workspaceFolder));
  map.set('${configDir}', normalize(context.configDir ?? context.packageRoot ?? context.workspaceFolder));
  if (context.currentFile) {
    const current = normalize(context.currentFile);
    const ext = path.extname(current);
    map.set('${currentFile}', current);
    map.set('${fileExtname}', ext);
    map.set('${fileBasename}', path.basename(current));
    map.set('${fileBasenameNoExtension}', path.basename(current, ext));
    map.set('${fileDirname}', path.dirname(current));
  }
  return map;
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/');
}
