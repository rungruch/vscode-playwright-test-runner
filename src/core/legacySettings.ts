/**
 * Mapping between legacy `playwrightrunner.*` settings and the new
 * `playwrightCliRunner.*` namespace. Legacy values are read (never
 * recontributed) and act as a fallback: explicit new settings win, legacy
 * settings win over automatic detection.
 */
import { parseEnvironmentArray } from './envParse';

export const LEGACY_NAMESPACE = 'playwrightrunner';
export const NEW_NAMESPACE = 'playwrightCliRunner';

export interface LegacySettings {
  playwrightConfigPath?: string;
  projectPath?: string;
  playwrightRunProject?: string;
  playwrightDebugProject?: string;
  playwrightInspectProject?: string;
  playwrightRunOptions?: string[];
  playwrightEnvironmentVariables?: string[];
  playwrightCommand?: string;
  disableCodeLens?: boolean;
  codeLensSelector?: string;
  changeDirectoryToWorkspaceRoot?: boolean;
}

export interface MigratedSettings {
  configFiles?: string[];
  'cli.executable'?: string;
  'cli.arguments'?: string[];
  workingDirectory?: string;
  runOptions?: string[];
  environment?: Record<string, string>;
  'codeLens.enabled'?: boolean;
  'codeLens.pattern'?: string;
}

/**
 * Converts a set of legacy settings into their new-namespace equivalents.
 * Only defined legacy values produce output entries. Used both at read time
 * (fallback) and by the migrateSettings command (preview + write).
 */
export function convertLegacySettings(legacy: LegacySettings): MigratedSettings {
  const migrated: MigratedSettings = {};

  const configPath = nonEmpty(legacy.playwrightConfigPath);
  if (configPath) {
    migrated.configFiles = [configPath];
  }

  if (typeof legacy.playwrightCommand === 'string' && legacy.playwrightCommand.trim().length > 0) {
    const parts = legacy.playwrightCommand.trim().split(/\s+/);
    const executable = parts.shift();
    if (executable) {
      migrated['cli.executable'] = executable;
      if (parts.length > 0) {
        migrated['cli.arguments'] = parts;
      }
    }
  }

  const projectPath = nonEmpty(legacy.projectPath);
  if (projectPath && projectPath !== '${packageRoot}') {
    migrated.workingDirectory = projectPath;
  } else if (legacy.changeDirectoryToWorkspaceRoot === true && !projectPath) {
    migrated.workingDirectory = '${workspaceFolder}';
  }

  if (Array.isArray(legacy.playwrightRunOptions) && legacy.playwrightRunOptions.length > 0) {
    migrated.runOptions = [...legacy.playwrightRunOptions];
  }

  if (Array.isArray(legacy.playwrightEnvironmentVariables) && legacy.playwrightEnvironmentVariables.length > 0) {
    migrated.environment = parseEnvironmentArray(legacy.playwrightEnvironmentVariables);
  }

  if (legacy.disableCodeLens === true) {
    migrated['codeLens.enabled'] = false;
  } else if (legacy.disableCodeLens === false) {
    migrated['codeLens.enabled'] = true;
  }

  const selector = nonEmpty(legacy.codeLensSelector);
  if (selector) {
    migrated['codeLens.pattern'] = selector;
  }

  return migrated;
}

/**
 * Splits a legacy "project" preference into a seed list for the project
 * Quick Pick. Returns undefined when unset.
 */
export function legacyProjectSeed(project: string | undefined): string[] | undefined {
  const value = nonEmpty(project);
  if (!value) {
    return undefined;
  }
  return value.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
