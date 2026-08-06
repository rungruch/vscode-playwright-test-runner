import * as path from 'path';
import * as vscode from 'vscode';
import { substituteVariables } from './core/variables';
import { RunTarget, resolveRunTarget } from './runTarget';
import { Settings } from './settings';

/**
 * The usual Playwright config plus conventional variants such as
 * `playwright.no-db.config.ts` and `playwright.pdf.config.ts`.
 *
 * Arbitrary names stay opt-in through `playwrightCodeLensRunner.configFiles`
 * so helper files such as `e2e.config.ts` are never executed unexpectedly.
 */
export const PLAYWRIGHT_CONFIG_GLOB = '**/playwright*.config.{js,cjs,mjs,ts,cts,mts}';
const EXCLUDE_GLOB = '**/{node_modules,out,dist,.git}/**';

/**
 * Discovers all Playwright configs across every workspace folder of a
 * (possibly multi-root) workspace. Folders without any config fall back to a
 * configless project rooted at the nearest package root.
 */
export async function discoverRunTargets(onProgress?: (message: string) => void): Promise<RunTarget[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const targets: RunTarget[] = [];
  for (const folder of folders) {
    const settings = new Settings(folder.uri);
    const explicit = settings.configFiles;
    if (explicit && explicit.length > 0) {
      for (const entry of explicit) {
        const substituted = substituteVariables(entry, {
          workspaceFolder: folder.uri.fsPath,
          packageRoot: folder.uri.fsPath,
          configDir: folder.uri.fsPath,
        });
        const absolute = path.isAbsolute(substituted) ? path.normalize(substituted) : path.normalize(path.resolve(folder.uri.fsPath, substituted));
        targets.push(resolveRunTarget(folder, absolute, settings));
      }
      continue;
    }

    onProgress?.(`Scanning ${folder.name} for Playwright configs`);
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, PLAYWRIGHT_CONFIG_GLOB),
      EXCLUDE_GLOB,
    );
    if (found.length === 0) {
      targets.push(resolveRunTarget(folder, undefined, settings));
      continue;
    }
    found.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    for (const uri of found) {
      targets.push(resolveRunTarget(folder, path.normalize(uri.fsPath), settings));
    }
  }
  return targets;
}

/** Config file patterns relevant for save-based refresh. */
export function isConfigFile(fsPath: string): boolean {
  return /(^|[\\/])playwright[^\\/]*\.config\.(js|cjs|mjs|ts|cts|mts)$/.test(fsPath);
}

export function isTestFile(fsPath: string): boolean {
  return /\.(test|spec)\.(js|jsx|ts|tsx|mts|cts|mjs|cjs)$/.test(fsPath);
}
