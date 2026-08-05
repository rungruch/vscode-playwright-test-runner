import * as path from 'path';
import * as vscode from 'vscode';
import { CliCommand, resolveCli } from './core/cliResolution';
import { findPackageRoot } from './core/packageManager';
import { VariableContext, substituteVariables } from './core/variables';
import { Settings } from './settings';

/**
 * A fully resolved execution target for one Playwright config (or configless
 * project). Everything the companion CLI needs is pre-computed: structured CLI
 * command, cwd, environment and options.
 */
export interface RunTarget {
  /** Stable id: absolute config path, or `configless:<cwd>` for configless projects. */
  id: string;
  workspaceFolder: vscode.WorkspaceFolder;
  configFile?: string;
  configDir: string;
  cwd: string;
  cli: CliCommand;
  env: Record<string, string>;
  runOptions: string[];
}

export function resolveRunTarget(
  workspaceFolder: vscode.WorkspaceFolder,
  configFile: string | undefined,
  settings: Settings,
): RunTarget {
  const workspacePath = workspaceFolder.uri.fsPath;
  const configDir = configFile ? path.dirname(configFile) : findPackageRoot(workspacePath, workspacePath) ?? workspacePath;
  const context: VariableContext = {
    workspaceFolder: workspacePath,
    packageRoot: findPackageRoot(configDir, workspacePath) ?? workspacePath,
    configDir,
  };

  const rawCwd = settings.workingDirectory;
  const cwd = rawCwd ? path.resolve(workspacePath, substituteVariables(rawCwd, context)) : configDir;

  const cli = resolveCli({
    executable: settings.cliExecutable ? substituteVariables(settings.cliExecutable, context) : undefined,
    arguments: settings.cliArguments.map((a) => substituteVariables(a, context)),
    cwd,
    // Detection walks above the workspace folder so hoisted monorepo
    // installs (shared node_modules in a parent) are found.
  });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings.environment)) {
    env[key] = substituteVariables(String(value), context);
  }

  return {
    id: configFile ?? `configless:${configDir}`,
    workspaceFolder,
    configFile,
    configDir,
    cwd,
    cli,
    env,
    runOptions: settings.runOptions.map((o) => substituteVariables(o, context)),
  };
}

export function targetLabel(target: RunTarget): string {
  const relative = path.relative(target.workspaceFolder.uri.fsPath, target.configFile ?? target.configDir);
  return target.configFile ? relative || path.basename(target.configFile) : `${relative || '.'} (no config)`;
}
