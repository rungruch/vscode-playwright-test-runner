import * as vscode from 'vscode';
import { InspectorBrowser, isInspectorBrowser } from './core/inspectorBrowser';

/** Public configuration namespace for the extension. */
export const SETTINGS_NAMESPACE = 'playwrightCodeLensRunner';

const DEFAULT_CODE_LENS_PATTERN = '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}';

/**
 * Reads `playwrightCodeLensRunner.*` settings. Empty strings, arrays and
 * objects resolve to automatic detection or documented defaults.
 */
export class Settings {
  constructor(private readonly resource?: vscode.Uri) {}

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SETTINGS_NAMESPACE, this.resource);
  }

  /** Explicit config file list, or undefined for automatic discovery. */
  get configFiles(): string[] | undefined {
    const files = this.configuration().get<string[]>('configFiles', []);
    return files.length > 0 ? files : undefined;
  }

  get cliExecutable(): string | undefined {
    const executable = this.configuration().get<string>('cli.executable', '');
    return executable.trim().length > 0 ? executable : undefined;
  }

  get cliArguments(): string[] {
    return this.configuration().get<string[]>('cli.arguments', []);
  }

  /** Working directory override, or undefined for the config directory. */
  get workingDirectory(): string | undefined {
    const directory = this.configuration().get<string>('workingDirectory', '');
    return directory.trim().length > 0 ? directory : undefined;
  }

  get runOptions(): string[] {
    return this.configuration().get<string[]>('runOptions', []);
  }

  /** Browser/project override applied only to Playwright Inspector commands. */
  get inspectorBrowser(): InspectorBrowser {
    const value = this.configuration().get<string>('inspector.browser', 'config');
    return isInspectorBrowser(value) ? value : 'config';
  }

  get environment(): Record<string, string> {
    return this.configuration().get<Record<string, string>>('environment', {});
  }

  get codeLensEnabled(): boolean {
    return this.configuration().get<boolean>('codeLens.enabled', true);
  }

  get codeLensPattern(): string {
    const pattern = this.configuration().get<string>('codeLens.pattern', '');
    return pattern.length > 0 ? pattern : DEFAULT_CODE_LENS_PATTERN;
  }
}
