import * as vscode from 'vscode';
import { LEGACY_NAMESPACE, NEW_NAMESPACE, legacyProjectSeed } from './core/legacySettings';
import {
  preferExplicit,
  resolveConfigFilesSetting,
  resolveOptionalStringSetting,
} from './core/settingsPrecedence';

const DEFAULT_CODE_LENS_PATTERN = '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}';

/**
 * Reads `playwrightCliRunner.*` settings with fallback to legacy
 * `playwrightrunner.*` values. Precedence: explicit new settings > explicit
 * legacy settings > manifest defaults / automatic detection. Legacy settings
 * are only read, never recontributed.
 */
export class Settings {
  constructor(private readonly resource?: vscode.Uri) {}

  private inspectNew<T>(key: string): T | undefined {
    const inspected = vscode.workspace.getConfiguration(NEW_NAMESPACE, this.resource).inspect<T>(key);
    return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  }

  private inspectLegacy<T>(key: string): T | undefined {
    const inspected = vscode.workspace.getConfiguration(LEGACY_NAMESPACE, this.resource).inspect<T>(key);
    return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  }

  private withDefault<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration(NEW_NAMESPACE, this.resource).get<T>(key, fallback);
  }

  /** Explicit config file list, or undefined for automatic discovery. */
  get configFiles(): string[] | undefined {
    const explicit = this.inspectNew<string[]>('configFiles');
    const legacyPath = this.inspectLegacy<string>('playwrightConfigPath');
    return resolveConfigFilesSetting(explicit, legacyPath);
  }

  get cliExecutable(): string | undefined {
    const explicit = this.inspectNew<string>('cli.executable');
    const legacy = this.legacyCommandParts();
    return resolveOptionalStringSetting(explicit, legacy?.executable);
  }

  get cliArguments(): string[] {
    const explicit = this.inspectNew<string[]>('cli.arguments');
    if (explicit) {
      return explicit;
    }
    return this.legacyCommandParts()?.args ?? [];
  }

  private legacyCommandParts(): { executable: string; args: string[] } | undefined {
    const legacy = this.inspectLegacy<string>('playwrightCommand');
    if (!legacy || legacy.trim().length === 0) {
      return undefined;
    }
    const parts = legacy.trim().split(/\s+/);
    const executable = parts.shift();
    if (!executable) {
      return undefined;
    }
    return { executable, args: parts };
  }

  /** Working directory override, or undefined for the config directory. */
  get workingDirectory(): string | undefined {
    const explicit = this.inspectNew<string>('workingDirectory');
    if (explicit !== undefined) {
      return explicit.length > 0 ? explicit : undefined;
    }
    const legacyProjectPath = this.inspectLegacy<string>('projectPath');
    if (legacyProjectPath && legacyProjectPath.trim().length > 0 && legacyProjectPath.trim() !== '${packageRoot}') {
      return legacyProjectPath.trim();
    }
    const legacyChdir = this.inspectLegacy<boolean>('changeDirectoryToWorkspaceRoot');
    if (legacyChdir === true) {
      return '${workspaceFolder}';
    }
    return undefined;
  }

  get runOptions(): string[] {
    const explicit = this.inspectNew<string[]>('runOptions');
    if (explicit) {
      return explicit;
    }
    const legacy = this.inspectLegacy<string[]>('playwrightRunOptions');
    if (legacy) {
      return legacy;
    }
    return this.withDefault<string[]>('runOptions', []);
  }

  get environment(): Record<string, string> {
    const explicit = this.inspectNew<Record<string, string>>('environment');
    if (explicit) {
      return explicit;
    }
    const legacy = this.inspectLegacy<string[]>('playwrightEnvironmentVariables');
    if (legacy && legacy.length > 0) {
      const env: Record<string, string> = {};
      for (const entry of legacy) {
        const eq = typeof entry === 'string' ? entry.indexOf('=') : -1;
        if (eq > 0) {
          env[entry.slice(0, eq).trim()] = entry.slice(eq + 1);
        }
      }
      return env;
    }
    return this.withDefault<Record<string, string>>('environment', {});
  }

  get codeLensEnabled(): boolean {
    const explicit = this.inspectNew<boolean>('codeLens.enabled');
    if (explicit !== undefined) {
      return explicit;
    }
    const legacyDisabled = this.inspectLegacy<boolean>('disableCodeLens');
    if (legacyDisabled !== undefined) {
      return !legacyDisabled;
    }
    return this.withDefault<boolean>('codeLens.enabled', true);
  }

  get codeLensPattern(): string {
    const explicit = this.inspectNew<string>('codeLens.pattern');
    const legacy = this.inspectLegacy<string>('codeLensSelector');
    const selected = preferExplicit(explicit, legacy);
    return selected && selected.length > 0 ? selected : DEFAULT_CODE_LENS_PATTERN;
  }

  /** Seeds for the project Quick Pick coming from legacy project settings. */
  legacyProjectSeeds(kind: 'run' | 'debug' | 'inspect'): string[] | undefined {
    switch (kind) {
      case 'run':
        return legacyProjectSeed(this.inspectLegacy<string>('playwrightRunProject'));
      case 'debug':
        return legacyProjectSeed(this.inspectLegacy<string>('playwrightDebugProject'));
      case 'inspect':
        return legacyProjectSeed(this.inspectLegacy<string>('playwrightInspectProject'));
    }
  }
}
